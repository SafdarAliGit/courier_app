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
    context.fetch_hs_code_from_api = frappe.db.get_single_value(
        "Courier Settings", "fetch_hs_code_from_api"
    )

    user_type = frappe.db.get_value("User", frappe.session.user, "user_type")
    is_desk_user = user_type != "Website User"

    if is_desk_user:
        context.is_desk_user = True
        context.portal_party_name = ""
        context.customers_list = frappe.get_all(
            "Customer",
            fields=["name", "customer_name"],
            order_by="customer_name asc",
        )
    else:
        context.is_desk_user = False
        context.customers_list = []
        customer_display_name = frappe.db.get_value(
            "Customer",
            {"user_id": frappe.session.user},
            "customer_name"
        )
        context.portal_party_name = customer_display_name or ""


def has_website_permission(doc, ptype, user, verbose=False):
    return True
