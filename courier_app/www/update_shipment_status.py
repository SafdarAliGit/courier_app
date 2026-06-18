import frappe
from courier_app.website_settings import get_website_context


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/update-shipment-status"
        raise frappe.Redirect

    user_type = frappe.db.get_value("User", frappe.session.user, "user_type")
    if user_type == "Website User":
        frappe.throw("You do not have permission to access this page.", frappe.PermissionError)

    context.no_cache = 1
    context.show_sidebar = 0
    ctx = get_website_context("update-shipment-status")
    context.update(ctx)
    context.title = f"Update Shipment Status — {ctx.company_name}"


def has_website_permission(doc, ptype, user, verbose=False):
    return True
