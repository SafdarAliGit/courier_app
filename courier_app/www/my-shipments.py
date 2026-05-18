import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = 0
    context.title = "My Shipments — CourierApp"
    if not frappe.session.user or frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/my-shipments"
        raise frappe.Redirect
    context.is_system_user = (
        frappe.db.get_value("User", frappe.session.user, "user_type") == "System User"
    )
