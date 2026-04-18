import frappe
from frappe.model.document import Document


class StateorProvince(Document):
    def autoname(self):
        self.name = f"{self.country}-{self.state_name}"

    def validate(self):
        # Ensure no duplicate state_name within the same country
        existing = frappe.db.get_value(
            "State or Province",
            {"country": self.country, "state_name": self.state_name},
            "name"
        )
        if existing and existing != self.name:
            frappe.throw(
                f"State/Province <b>{self.state_name}</b> already exists for <b>{self.country}</b>."
            )
