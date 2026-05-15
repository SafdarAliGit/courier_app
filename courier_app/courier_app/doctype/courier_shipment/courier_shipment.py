import frappe
from frappe.model.document import Document
from frappe.utils import today, add_days, flt


class CourierShipment(Document):

    def autoname(self):
        """Format: JB{YY}{MM}{DD}-{####}  — sequence resets to 0001 each new year."""
        from frappe.utils import now_datetime
        now = now_datetime()
        yy = now.strftime("%y")
        mm = now.strftime("%m")
        dd = now.strftime("%d")
        series_key = f"JB{yy}-"

        # Row-level lock ensures no two inserts get the same sequence number.
        current = frappe.db.sql(
            "SELECT current FROM `tabSeries` WHERE name=%s FOR UPDATE", (series_key,)
        )
        if current:
            seq = current[0][0] + 1
            frappe.db.sql(
                "UPDATE `tabSeries` SET current=%s WHERE name=%s", (seq, series_key)
            )
        else:
            frappe.db.sql(
                "INSERT INTO `tabSeries` (name, current) VALUES (%s, %s)", (series_key, 1)
            )
            seq = 1

        self.name = f"JB{yy}{mm}{dd}-{str(seq).zfill(4)}"

    def before_insert(self):
        _sync_customer(self)

    def before_save(self):
        self._compute_totals()
        self._set_package_numbers()
        self._compute_commodity_total()

    def before_submit(self):
        self._validate_required()
        self._generate_tracking_number()
        self._set_estimated_delivery()

    def _set_package_numbers(self):
        for i, pkg in enumerate(self.packages, start=1):
            pkg.package_no = i

    def _compute_totals(self):
        # Build per-package actual (chargeable) weight in KG.
        # If user manually set actual_weight, respect it; otherwise compute
        # max(input_kg, volumetric_kg) where vol = (L * W * H) / 5000.
        pkg_weights = []    # input weight in kg
        pkg_actual  = []    # chargeable weight in kg (used for rating)
        total = 0.0
        for pkg in self.packages:
            w = flt(pkg.weight)
            if pkg.weight_unit == "lb":
                w = w * 0.453592
            w = round(w, 3)
            if flt(pkg.actual_weight) > 0:
                actual = round(flt(pkg.actual_weight), 3)
            else:
                l = flt(pkg.length)
                ww = flt(pkg.width)
                h = flt(pkg.height)
                vol_kg = round((l * ww * h) / 5000, 3) if (l > 0 and ww > 0 and h > 0) else 0.0
                actual = round(max(w, vol_kg), 3)
            pkg_weights.append(w)
            pkg_actual.append(actual)
            total += w
        self.total_weight = round(total, 3)

        # Look up rate per package. If user manually entered an amount, use it directly.
        pkg_amounts = []
        total_amount = 0.0
        sp = self.service_provider or _get_first_active_provider()
        if self.recipient_country and self.total_weight > 0 and sp:
            try:
                from courier_app.shipping_rates import get_shipping_rate
                for pkg, act_kg in zip(self.packages, pkg_actual):
                    if flt(pkg.amount) > 0:
                        pkg_rate = flt(pkg.amount)
                    elif act_kg > 0:
                        result = get_shipping_rate(self.recipient_country, act_kg, sp)
                        pkg_rate = flt(result.get("rate", 0))
                    else:
                        pkg_rate = 0.0
                    pkg_amounts.append(pkg_rate)
                    total_amount += pkg_rate
                self.calculated_rate = round(total_amount, 2)
                self.rate_per_kg = round(total_amount / self.total_weight, 2) if self.total_weight > 0 else 0
            except Exception:
                total_amount = flt(self.calculated_rate) or 0.0

        # Sync actual_weight and amount back to each package row
        for i, (pkg, w_kg, act_kg) in enumerate(zip(self.packages, pkg_weights, pkg_actual)):
            pkg.actual_weight = act_kg
            if pkg_amounts and i < len(pkg_amounts):
                pkg.amount = pkg_amounts[i]
            elif self.total_weight > 0 and total_amount > 0:
                pkg.amount = round(total_amount * w_kg / self.total_weight, 2)
            else:
                pkg.amount = 0


    def _compute_commodity_total(self):
        total = sum(flt(row.units) * flt(row.price) for row in (self.commodities or []))
        for row in (self.commodities or []):
            row.amount = round(flt(row.units) * flt(row.price), 2)
        self.total_commodity_amount = round(total, 2)

    def _validate_required(self):
        if not self.packages:
            frappe.throw("At least one package is required before submitting.")
        for pkg in self.packages:
            if not flt(pkg.weight):
                frappe.throw(f"Package {pkg.package_no}: Weight is required.")

    def _generate_tracking_number(self):
        if not self.tracking_number:
            import random, string
            prefix = "CA"
            rand_part = "".join(random.choices(string.digits, k=12))
            self.tracking_number = f"{prefix}{rand_part}"

    def _set_estimated_delivery(self):
        service_days = {
            "Express Plus": 1,
            "Express": 2,
            "Express Saver": 3,
            "Ground": 5,
            "Ground Economy": 7,
        }
        days = service_days.get(self.service, 3)
        self.estimated_delivery = add_days(today(), days)


def _get_first_active_provider():
    """Return the first active Service Provider name, or None."""
    return frappe.db.get_value("Service Provider", {"is_active": 1}, "name")


# ─── Customer sync ────────────────────────────────────────────────────────────

def _sync_customer(doc):
    """Find-or-create a Customer from sender fields and link it to the shipment."""
    sender_name = (doc.sender_name or "").strip()
    sender_phone = (doc.sender_phone or "").strip()

    if not sender_name:
        return

    existing = _find_customer(sender_name, sender_phone)

    if existing:
        doc.customer = existing
        _update_customer_address(existing, doc)
    else:
        customer = _create_customer(sender_name, sender_phone, doc.sender_email)
        doc.customer = customer
        if doc.sender_address_line1:
            _create_customer_address(customer, sender_name, doc)


def _find_customer(sender_name, sender_phone):
    """Return Customer name if a matching record exists, else None."""
    filters = {"customer_name": sender_name}
    if sender_phone:
        filters["mobile_no"] = sender_phone
    return frappe.db.get_value("Customer", filters, "name")


def _resolve_customer_group():
    """Return a valid leaf Customer Group, never a group-node that ERPNext rejects."""
    default = frappe.db.get_single_value("Selling Settings", "customer_group") or ""
    if default and frappe.db.exists("Customer Group", {"name": default, "is_group": 0}):
        return default
    leaf = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    return leaf or "All Customer Groups"


def _resolve_territory():
    """Return a valid leaf Territory."""
    default = frappe.db.get_single_value("Selling Settings", "territory") or ""
    if default and frappe.db.exists("Territory", {"name": default, "is_group": 0}):
        return default
    leaf = frappe.db.get_value("Territory", {"is_group": 0}, "name")
    return leaf or "All Territories"


def _create_customer(sender_name, sender_phone, sender_email):
    """Create a new Customer and optionally a Contact with the phone number."""
    customer = frappe.get_doc({
        "doctype": "Customer",
        "customer_name": sender_name,
        "customer_type": "Individual",
        "customer_group": _resolve_customer_group(),
        "territory": _resolve_territory(),
    })
    customer.insert(ignore_permissions=True)

    if sender_phone:
        _create_customer_contact(customer.name, sender_name, sender_phone, sender_email)

    return customer.name


def _create_customer_contact(customer_name, sender_name, mobile_no, email=None):
    """Create a Contact linked to Customer, then set Customer.mobile_no."""
    # Split sender_name into first/last for Contact
    parts = sender_name.split(" ", 1)
    contact = frappe.get_doc({
        "doctype": "Contact",
        "first_name": parts[0],
        "last_name": parts[1] if len(parts) > 1 else "",
        "mobile_no": mobile_no,
        "links": [{"link_doctype": "Customer", "link_name": customer_name}],
    })
    if email:
        contact.append("email_ids", {"email_id": email, "is_primary": 1})
    contact.insert(ignore_permissions=True)

    frappe.db.set_value("Customer", customer_name, {
        "customer_primary_contact": contact.name,
        "mobile_no": mobile_no,
    })


def _create_customer_address(customer_name, address_title, doc):
    """Create a primary billing Address linked to Customer."""
    addr = frappe.get_doc({
        "doctype": "Address",
        "address_title": address_title,
        "address_type": "Billing",
        "address_line1": doc.sender_address_line1 or "",
        "address_line2": doc.sender_address_line2 or "",
        "city": doc.sender_city or "",
        "country": doc.sender_country or "",
        "pincode": doc.sender_zip or "",
        "phone": doc.sender_phone or "",
        "is_primary_address": 1,
        "links": [{"link_doctype": "Customer", "link_name": customer_name}],
    })
    addr.insert(ignore_permissions=True)
    frappe.db.set_value("Customer", customer_name, "customer_primary_address", addr.name)


def _update_customer_address(customer_name, doc):
    """Update existing primary address from shipment sender fields."""
    addr_name = frappe.db.get_value("Customer", customer_name, "customer_primary_address")
    if addr_name:
        frappe.db.set_value("Address", addr_name, {
            "address_line1": doc.sender_address_line1 or "",
            "address_line2": doc.sender_address_line2 or "",
            "city": doc.sender_city or "",
            "country": doc.sender_country or "",
            "pincode": doc.sender_zip or "",
            "phone": doc.sender_phone or "",
        })
    elif doc.sender_address_line1:
        addr_title = frappe.db.get_value("Customer", customer_name, "customer_name") or customer_name
        _create_customer_address(customer_name, addr_title, doc)
