import frappe
from frappe import _
from frappe.model.document import Document


class CountryZone(Document):
    def validate(self):
        # Enforce unique (service_provider + country_code + country_name)
        existing = frappe.db.get_value(
            "Country Zone",
            {
                "service_provider": self.service_provider,
                "country_code": self.country_code,
                "country_name": self.country_name,
            },
            "name",
        )
        if existing and existing != self.name:
            frappe.throw(
                _(
                    "Mapping for '{0}' ({1}) under provider '{2}' already exists: {3}"
                ).format(
                    self.country_name,
                    self.country_code,
                    self.service_provider,
                    existing,
                )
            )

        # Auto-resolve shipping_zone link
        if self.zone_code and self.service_provider:
            zone = frappe.db.get_value(
                "Rate Zone",
                {"service_provider": self.service_provider, "zone_code": self.zone_code},
                "name",
            )
            self.shipping_zone = zone or ""

    def autoname(self):
        self.name = f"{self.country_name}-{self.service_provider}"