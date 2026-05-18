import frappe


def get_boot_info(bootinfo):
    company = frappe.db.get_single_value("Global Defaults", "default_company") or ""
    if company:
        bootinfo.company_logo = frappe.db.get_value("Company", company, "company_logo") or ""
        bootinfo.company_name = company
        bootinfo.default_currency = (frappe.db.get_value("Company", company, "default_currency") or
                                     frappe.db.get_single_value("Global Defaults", "default_currency") or "PKR")
    else:
        bootinfo.company_logo = ""
        bootinfo.company_name = ""
        bootinfo.default_currency = frappe.db.get_single_value("Global Defaults", "default_currency") or "PKR"
