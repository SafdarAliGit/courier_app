import frappe

def get_context(context):
    context.no_cache = 1
    context.show_sidebar = 0
    company = frappe.db.get_single_value("Global Defaults", "default_company") or "CourierApp"
    context.company_name = company
    context.company_logo = frappe.db.get_value("Company", company, "company_logo") or ""
    context.title = f"Rate Calculator — {company}"


def has_website_permission(doc, ptype, user, verbose=False):
    return True