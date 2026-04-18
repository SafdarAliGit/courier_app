"""
courier_app/api/approval_api.py
--------------------------------
Approval workflow: Portal shipment → Customer (dedup) → Address (upsert) → Sales Order

Key functions:
  approve_shipment(shipment_id, service_provider=None, item_code=None)
  reject_shipment(shipment_id, reason="")
  get_shipment_detail(shipment_id)   – full detail for desk drawer
  update_customer_address(customer, address_data)
"""

import frappe
from frappe import _
from frappe.utils import now_datetime, flt, today
from frappe.model.mapper import get_mapped_doc


# ─── APPROVE ─────────────────────────────────────────────────────────────────

@frappe.whitelist()
def approve_shipment(shipment_id, service_provider=None, item_code=None):
    """
    1. Validate shipment is in a state that can be approved
    2. Find or create Customer (match by customer_name + mobile_no)
    3. Upsert sender Address on the Customer
    4. Create Sales Order
    5. Update Shipment: approval_status=Approved, customer, sales_order, status=Booked
    Returns dict with customer, sales_order names and summary.
    """
    doc = frappe.get_doc("Courier Shipment", shipment_id)

    if doc.approval_status == "Approved":
        frappe.throw(_(f"Shipment {shipment_id} is already approved"))

    # ── 1. Find / create Customer ────────────────────────────────────────────
    customer_name = _get_or_create_customer(doc)

    # ── 2. Upsert Address ───────────────────────────────────────────────────
    _upsert_address(customer_name, doc)

    # ── 3. Create Sales Order ───────────────────────────────────────────────
    so_name = _create_sales_order(doc, customer_name, service_provider, item_code)

    # ── 4. Update Shipment ──────────────────────────────────────────────────
    doc.approval_status = "Approved"
    doc.status = "Booked"
    doc.customer = customer_name
    doc.sales_order = so_name
    doc.approved_by = frappe.session.user
    doc.approved_on = now_datetime()
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "ok",
        "shipment_id": shipment_id,
        "customer": customer_name,
        "sales_order": so_name,
        "message": f"Approved. Customer: {customer_name}, SO: {so_name}",
    }


# ─── REJECT ──────────────────────────────────────────────────────────────────

@frappe.whitelist()
def reject_shipment(shipment_id, reason=""):
    doc = frappe.get_doc("Courier Shipment", shipment_id)
    if doc.approval_status == "Approved":
        frappe.throw(_("Cannot reject an already-approved shipment"))

    doc.approval_status = "Rejected"
    doc.status = "Cancelled"
    doc.approved_by = frappe.session.user
    doc.approved_on = now_datetime()
    if reason:
        doc.special_instructions = (doc.special_instructions or "") + f"\n[Rejected: {reason}]"
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "ok", "shipment_id": shipment_id}


# ─── FULL DETAIL (for drawer) ─────────────────────────────────────────────────

@frappe.whitelist()
def get_shipment_detail(shipment_id):
    doc = frappe.get_doc("Courier Shipment", shipment_id)
    d = doc.as_dict()

    # Enrich with customer info if linked
    if doc.customer:
        cust = frappe.db.get_value(
            "Customer",
            doc.customer,
            ["customer_name", "mobile_no", "email_id", "customer_group", "territory"],
            as_dict=True,
        )
        d["customer_info"] = cust or {}

        # Get addresses
        addrs = frappe.db.sql(
            """
            SELECT a.name, a.address_type, a.address_line1, a.address_line2,
                   a.city, a.pincode, a.country
            FROM `tabAddress` a
            JOIN `tabDynamic Link` dl ON dl.parent=a.name
            WHERE dl.link_doctype='Customer' AND dl.link_name=%(c)s
            ORDER BY a.is_primary_address DESC, a.creation DESC
            """,
            {"c": doc.customer},
            as_dict=True,
        )
        d["customer_addresses"] = addrs

    return d


# ─── UPDATE ADDRESS ───────────────────────────────────────────────────────────

@frappe.whitelist()
def update_customer_address(customer, address_name, address_data):
    """
    Update an existing Address record linked to a Customer.
    address_data: dict with fields address_line1, address_line2, city, pincode, country
    """
    import json
    if isinstance(address_data, str):
        address_data = json.loads(address_data)

    if not frappe.db.exists("Address", address_name):
        frappe.throw(_(f"Address '{address_name}' not found"))

    doc = frappe.get_doc("Address", address_name)
    allowed = ["address_line1", "address_line2", "city", "state", "pincode", "country", "phone", "email_id"]
    for f in allowed:
        if f in address_data:
            doc.set(f, address_data[f])
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "ok", "address": address_name}


# ─── PORTAL: my shipments ─────────────────────────────────────────────────────

@frappe.whitelist()
def get_my_shipments(email=None, page=1, page_size=15):
    """For portal: list shipments for the current logged-in user."""
    # Always use session user for security; ignore the passed email param
    lookup_email = frappe.session.user
    if not lookup_email or lookup_email == "Guest":
        frappe.throw(_("Authentication required"))

    page = int(page)
    page_size = int(page_size)
    offset = (page - 1) * page_size

    total = frappe.db.sql(
        "SELECT COUNT(*) FROM `tabCourier Shipment` WHERE portal_email=%(e)s AND docstatus<2",
        {"e": lookup_email},
    )[0][0]

    rows = frappe.db.sql(
        """
        SELECT name, status, approval_status, ship_date, service,
               recipient_name, recipient_country, recipient_city,
               total_weight, calculated_rate, tracking_number, customer, sales_order, creation
        FROM `tabCourier Shipment`
        WHERE portal_email=%(e)s AND docstatus<2
        ORDER BY creation DESC
        LIMIT %(lim)s OFFSET %(off)s
        """,
        {"e": lookup_email, "lim": page_size, "off": offset},
        as_dict=True,
    )
    return {
        "rows": rows,
        "total": total,
        "page": page,
        "pages": -(-total // page_size),
    }


# ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

def _get_or_create_customer(doc):
    """
    Phone is the unique identifier for a person (one phone = one customer).
    1. Find Customer whose normalised mobile_no matches sender_phone.
       - If both name AND phone match → reuse as-is.
       - If phone matches but name differs → same person (name change); update name.
    2. If no customer owns this phone → create a new Customer.
    Returns the Customer doc name.
    """
    sender_name = (doc.sender_name or "").strip()
    sender_phone = _normalize_phone(doc.sender_phone or "")

    if not sender_phone:
        # No phone provided – fall back to name-only match
        existing = frappe.db.get_value(
            "Customer", {"customer_name": sender_name}, "name"
        )
        if existing:
            return existing
    else:
        # Primary lookup: phone is unique per person
        existing = frappe.db.sql(
            """
            SELECT name, customer_name FROM `tabCustomer`
            WHERE REPLACE(REPLACE(REPLACE(mobile_no,' ',''),'-',''),'+','')
                = REPLACE(REPLACE(REPLACE(%(p)s,' ',''),'-',''),'+','')
            LIMIT 1
            """,
            {"p": sender_phone},
            as_dict=True,
        )

        if existing:
            cust_doc_name = existing[0]["name"]
            existing_name = existing[0]["customer_name"]
            # Update customer name if it has changed
            if existing_name != sender_name:
                frappe.db.set_value(
                    "Customer", cust_doc_name, "customer_name", sender_name,
                    update_modified=False
                )
            return cust_doc_name

    # No matching customer found – create a new one
    customer = frappe.new_doc("Customer")
    customer.customer_name = sender_name
    customer.customer_type = "Individual"
    customer.customer_group = _get_default_customer_group()
    customer.territory = _get_default_territory()
    customer.mobile_no = doc.sender_phone
    customer.email_id = doc.sender_email or ""
    customer.insert(ignore_permissions=True)
    frappe.db.commit()
    return customer.name


def _upsert_address(customer_name, doc):
    """
    Create or update the sender's Shipping address on the Customer.
    If an address for this customer already exists, update it.
    Otherwise create a new one.
    """
    addr_title = f"{doc.sender_name} - Shipping"

    # Check if address already linked
    existing_addr = frappe.db.sql(
        """
        SELECT a.name FROM `tabAddress` a
        JOIN `tabDynamic Link` dl ON dl.parent = a.name
        WHERE dl.link_doctype='Customer' AND dl.link_name=%(c)s
          AND a.address_type='Shipping'
        ORDER BY a.is_primary_address DESC, a.creation
        LIMIT 1
        """,
        {"c": customer_name},
    )

    if existing_addr:
        addr_name = existing_addr[0][0]
        addr = frappe.get_doc("Address", addr_name)
    else:
        addr = frappe.new_doc("Address")
        addr.address_title = addr_title
        addr.address_type = "Shipping"
        addr.is_primary_address = 1
        addr.append("links", {
            "link_doctype": "Customer",
            "link_name": customer_name,
        })

    addr.address_line1 = doc.sender_address_line1 or ""
    addr.address_line2 = doc.sender_address_line2 or ""
    addr.city = doc.sender_city or ""
    addr.pincode = doc.sender_zip or ""
    addr.country = doc.sender_country or ""
    addr.phone = doc.sender_phone or ""
    addr.email_id = doc.sender_email or ""

    if existing_addr:
        addr.save(ignore_permissions=True)
    else:
        addr.insert(ignore_permissions=True)

    frappe.db.commit()


def _create_sales_order(doc, customer_name, service_provider=None, item_code=None):
    """
    Create a Sales Order from the approved Shipment.

    Child-row mapping:
      qty  = total_weight (KG)
      rate = avg rate per KG  (= total_amount / total_weight)
      amount = qty × rate = total_amount  ✓
    """
    if not item_code:
        item_code = _get_or_create_courier_item()

    total_amount = flt(doc.calculated_rate) or 0
    total_weight = flt(doc.total_weight) or 0

    # Avg rate per KG so that qty × rate = total_amount
    if total_weight > 0:
        avg_rate = round(total_amount / total_weight, 2)
        qty = round(total_weight, 3)
    else:
        avg_rate = total_amount
        qty = 1

    so = frappe.new_doc("Sales Order")
    so.customer = customer_name
    so.transaction_date = doc.ship_date or today()
    so.delivery_date = doc.ship_date or today()
    so.po_no = doc.customer_reference or ""
    so.ignore_pricing_rule = 1          # prevent price-list from overriding the computed rate
    so.remarks = (
        f"Courier Shipment: {doc.name}\n"
        f"Service: {doc.service or 'N/A'} | "
        f"Recipient: {doc.recipient_name} ({doc.recipient_country})\n"
        f"Weight: {total_weight} KG | Total Amount: {total_amount}"
    )

    kg_uom = _get_kg_uom()
    so.append("items", {
        "item_code": item_code,
        "item_name": f"Courier Service – {doc.service or 'Standard'}",
        "description": (
            f"Shipment {doc.name} | "
            f"From: {doc.sender_city}, {doc.sender_country} → "
            f"To: {doc.recipient_city}, {doc.recipient_country} | "
            f"Weight: {total_weight} KG | Rate/KG: {avg_rate} | Total: {total_amount}"
        ),
        "qty": qty,
        "rate": avg_rate,
        "price_list_rate": avg_rate,    # pin so ERPNext doesn't recalculate
        "discount_percentage": 0,
        "uom": kg_uom,
        "stock_uom": kg_uom,
        "conversion_factor": 1,
        "delivery_date": doc.ship_date or today(),
    })

    so.insert(ignore_permissions=True)
    so.submit()
    frappe.db.commit()
    return so.name


def _normalize_phone(phone):
    import re
    return re.sub(r"[\s\-\(\)\+]", "", phone)


def _get_default_customer_group():
    default = frappe.db.get_single_value("Selling Settings", "customer_group") or ""
    if default and frappe.db.exists("Customer Group", default):
        return default
    first = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    return first or "All Customer Groups"


def _get_default_territory():
    default = frappe.db.get_single_value("Selling Settings", "territory") or ""
    if default and frappe.db.exists("Territory", default):
        return default
    first = frappe.db.get_value("Territory", {"is_group": 0}, "name")
    return first or "All Territories"


def _get_or_create_courier_item():
    """Return the item code for courier service, creating it if not present."""
    item_code = "COURIER-SERVICE"
    if frappe.db.exists("Item", item_code):
        return item_code

    item = frappe.new_doc("Item")
    item.item_code = item_code
    item.item_name = "Courier Service"
    item.item_group = _get_default_item_group()
    item.stock_uom = "Nos"
    item.is_stock_item = 0
    item.is_sales_item = 1
    item.is_service_item = 1
    item.description = "International courier shipment service"
    item.insert(ignore_permissions=True)
    frappe.db.commit()
    return item_code


def _get_default_item_group():
    if frappe.db.exists("Item Group", "Services"):
        return "Services"
    first = frappe.db.get_value("Item Group", {"is_group": 0}, "name")
    return first or "All Item Groups"


def _get_kg_uom():
    """Return the 'Kg' UOM name; fall back to 'Nos' if not present."""
    for candidate in ("Kg", "KG", "kg"):
        if frappe.db.exists("UOM", candidate):
            return candidate
    return "Nos"
