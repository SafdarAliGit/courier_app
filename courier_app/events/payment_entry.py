# my_app/payment_entry.py

import frappe

def set_shipment(doc, method):
    if doc.shipment_id:
        return

    for ref in doc.references:
        if ref.reference_doctype == "Sales Invoice":

            shipment_id = frappe.db.get_value(
                "Sales Invoice",
                ref.reference_name,
                "shipment_id"
            )

            if shipment_id:
                doc.shipment_id = shipment_id

            break