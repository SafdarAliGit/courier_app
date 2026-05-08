import frappe
from courier_app.website_settings import get_website_context


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = 0
    ctx = get_website_context("about")
    context.update(ctx)
    context.title = f"About Us — {ctx.company_name}"


def has_website_permission(doc, ptype, user, verbose=False):
    return True
