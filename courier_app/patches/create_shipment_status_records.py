import frappe


STATUSES = [
    {"status": "Shipment Information Received", "location_option": "Origin",      "sequence": 1},
    {"status": "Collection",                    "location_option": "Origin",      "sequence": 2},
    {"status": "In Transit to Destination",     "location_option": "Origin",      "sequence": 3},
    {"status": "Departed Origin Airport",       "location_option": "Airport",     "sequence": 4},
    {"status": "Arrived at Destination Airport", "location_option": "Airport",    "sequence": 5},
    {"status": "Delivered",                     "location_option": "Destination", "sequence": 6},
    {"status": "Cancelled",                     "location_option": "Origin",      "sequence": 7},
]


def execute():
    for row in STATUSES:
        if not frappe.db.exists("Shipment Status", row["status"]):
            doc = frappe.get_doc({"doctype": "Shipment Status", **row})
            doc.insert(ignore_permissions=True)

    frappe.db.commit()
