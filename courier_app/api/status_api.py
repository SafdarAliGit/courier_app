import json

import frappe


@frappe.whitelist()
def list_statuses():
    frappe.only_for(["System Manager", "Courier Manager", "Courier User"])
    return frappe.get_all(
        "Shipment Status",
        fields=["name", "status", "location_option", "sequence", "color"],
        order_by="sequence asc, status asc",
    )


@frappe.whitelist()
def add_status(status, location_option):
    frappe.only_for("System Manager")
    max_seq = frappe.db.sql(
        "SELECT IFNULL(MAX(sequence), 0) FROM `tabShipment Status`"
    )[0][0]
    doc = frappe.get_doc({
        "doctype": "Shipment Status",
        "status": status.strip(),
        "location_option": location_option,
        "sequence": int(max_seq) + 1,
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name, "status": doc.status, "location_option": doc.location_option}


@frappe.whitelist()
def update_status(name, location_option):
    frappe.only_for("System Manager")
    doc = frappe.get_doc("Shipment Status", name)
    doc.location_option = location_option
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name, "status": doc.status, "location_option": doc.location_option}


@frappe.whitelist()
def reorder_statuses(order):
    frappe.only_for("System Manager")
    items = json.loads(order) if isinstance(order, str) else order
    for i, name in enumerate(items, start=1):
        frappe.db.set_value("Shipment Status", name, "sequence", i, update_modified=False)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def delete_status(name):
    frappe.only_for("System Manager")
    used = frappe.db.count("Courier Shipment", {"status": name})
    if used:
        frappe.throw(
            f'Cannot delete "{name}" — it is used by {used} shipment(s). '
            "Change their status first."
        )
    frappe.delete_doc("Shipment Status", name, ignore_permissions=True)
    frappe.db.commit()
    return {"deleted": name}
