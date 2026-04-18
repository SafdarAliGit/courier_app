import frappe
from frappe import _
from frappe.model.document import Document


class RateZone(Document):
    def validate(self):
        # Enforce unique (service_provider + zone_code) combination
        existing = frappe.db.get_value(
            "Rate Zone",
            {"service_provider": self.service_provider, "zone_code": self.zone_code},
            "name",
        )
        if existing and existing != self.name:
            frappe.throw(
                _(
                    "A Rate Zone for provider '{0}' with zone code '{1}' already exists: {2}"
                ).format(self.service_provider, self.zone_code, existing)
            )

        # Auto-set a label if blank
        if not self.zone_label:
            self.zone_label = f"Zone {self.zone_code}"
