import frappe
from frappe.model.document import Document


class City(Document):
    def autoname(self):
        if self.state_or_province:
            self.name = f"{self.state_or_province}-{self.city_name}"
        else:
            self.name = f"{self.country}-{self.city_name}"

    def validate(self):
        # If state is set, verify it belongs to the same country
        if self.state_or_province:
            state_country = frappe.db.get_value(
                "State or Province", self.state_or_province, "country"
            )
            if state_country and state_country != self.country:
                frappe.throw(
                    f"State/Province <b>{self.state_or_province}</b> "
                    f"belongs to <b>{state_country}</b>, not <b>{self.country}</b>."
                )
