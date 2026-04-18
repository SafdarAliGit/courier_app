import frappe
from frappe.model.document import Document


class ServiceProvider(Document):
    def validate(self):
        self.provider_code = self.provider_code.strip().upper()
