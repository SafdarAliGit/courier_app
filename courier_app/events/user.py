import frappe


def after_insert(doc, method=None):
    """Ensure users created from the portal (sign_up or Google OAuth) are Website Users."""
    # If a logged-in admin is creating this user from the desk, don't override their choice
    if frappe.session.user and frappe.session.user != "Guest":
        return

    # Portal context (guest-initiated sign_up or social login callback) — enforce Website User
    if doc.user_type != "Website User":
        frappe.db.set_value("User", doc.name, "user_type", "Website User")
