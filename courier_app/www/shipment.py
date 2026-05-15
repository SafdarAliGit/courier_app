import frappe
from courier_app.website_settings import get_website_context


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/?ca_login=shipment"
        raise frappe.Redirect

    context.no_cache = 1
    context.show_sidebar = 0
    ctx = get_website_context("shipment")
    context.update(ctx)
    context.title = f"Create Shipment — {ctx.company_name}"


def has_website_permission(doc, ptype, user, verbose=False):
    return True
