import frappe


DEFAULT_COLORS = {
    "Shipment Information Received": "Blue",
    "Collection": "Yellow",
    "In Transit to Destination": "Purple",
    "Departed Origin Airport": "Cyan",
    "Arrived at Destination Airport": "Teal",
    "Delivered": "Green",
    "Cancelled": "Red",
}


def execute():
    for status, color in DEFAULT_COLORS.items():
        if frappe.db.exists("Shipment Status", status):
            frappe.db.set_value("Shipment Status", status, "color", color, update_modified=False)

    frappe.db.sql(
        "UPDATE `tabShipment Status` SET color = 'Gray' WHERE color IS NULL OR color = ''"
    )
    frappe.db.commit()
