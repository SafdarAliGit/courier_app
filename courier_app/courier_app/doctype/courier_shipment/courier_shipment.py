import frappe
from frappe.model.document import Document
from frappe.utils import today, add_days, flt


class CourierShipment(Document):

    def before_save(self):
        self._compute_totals()
        self._set_package_numbers()

    def before_submit(self):
        self._validate_required()
        self._generate_tracking_number()
        self._set_estimated_delivery()

    def _set_package_numbers(self):
        for i, pkg in enumerate(self.packages, start=1):
            pkg.package_no = i

    def _compute_totals(self):
        # Build per-package weight in KG
        pkg_weights = []
        total = 0.0
        for pkg in self.packages:
            w = flt(pkg.weight)
            if pkg.weight_unit == "lb":
                w = w * 0.453592
            w = round(w, 3)
            pkg_weights.append(w)
            total += w
        self.total_weight = round(total, 3)

        # Look up rate per package individually — consistent with the live rate
        # preview which calls get_rates_all_providers once per package weight.
        # This ensures the popup total matches what was shown before submission.
        pkg_amounts = []
        total_amount = 0.0
        sp = self.service_provider or _get_first_active_provider()
        if self.recipient_country and self.total_weight > 0 and sp:
            try:
                from courier_app.shipping_rates import get_shipping_rate
                for w_kg in pkg_weights:
                    if w_kg > 0:
                        result = get_shipping_rate(self.recipient_country, w_kg, sp)
                        pkg_rate = flt(result.get("rate", 0))
                    else:
                        pkg_rate = 0.0
                    pkg_amounts.append(pkg_rate)
                    total_amount += pkg_rate
                self.calculated_rate = round(total_amount, 2)
                self.rate_per_kg = round(total_amount / self.total_weight, 2)
            except Exception:
                total_amount = flt(self.calculated_rate) or 0.0

        # Sync rate and amount back to each package row
        for i, (pkg, w_kg) in enumerate(zip(self.packages, pkg_weights)):
            if pkg_amounts and i < len(pkg_amounts):
                # Use the individually-looked-up rate for this package
                pkg.amount = pkg_amounts[i]
                pkg.rate = round(pkg_amounts[i] / w_kg, 2) if w_kg > 0 else 0
            elif self.total_weight > 0 and total_amount > 0:
                # Fallback: distribute proportionally
                pkg_amount = round(total_amount * w_kg / self.total_weight, 2)
                pkg.amount = pkg_amount
                pkg.rate = round(pkg_amount / w_kg, 2) if w_kg > 0 else 0
            else:
                pkg.amount = 0
                pkg.rate = 0


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
