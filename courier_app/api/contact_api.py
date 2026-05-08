import frappe


@frappe.whitelist(allow_guest=True)
def submit_contact_form(full_name, email, phone="", subject="", message=""):
    if not full_name or not email or not message:
        return {"success": False, "error": "Name, email and message are required."}

    try:
        to_email = frappe.db.get_single_value("System Settings", "email_footer_address") or "info@aaagloballogistics.co.uk"

        frappe.sendmail(
            recipients=[to_email],
            subject=f"Contact Form: {subject or 'New enquiry from website'}",
            message=f"""
<h3>New Website Contact Enquiry</h3>
<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;font-weight:600;width:120px">Name</td><td style="padding:8px">{frappe.utils.escape_html(full_name)}</td></tr>
  <tr><td style="padding:8px;font-weight:600">Email</td><td style="padding:8px"><a href="mailto:{frappe.utils.escape_html(email)}">{frappe.utils.escape_html(email)}</a></td></tr>
  <tr><td style="padding:8px;font-weight:600">Phone</td><td style="padding:8px">{frappe.utils.escape_html(phone or "—")}</td></tr>
  <tr><td style="padding:8px;font-weight:600">Subject</td><td style="padding:8px">{frappe.utils.escape_html(subject or "—")}</td></tr>
  <tr><td style="padding:8px;font-weight:600;vertical-align:top">Message</td><td style="padding:8px;white-space:pre-wrap">{frappe.utils.escape_html(message)}</td></tr>
</table>
""",
            now=True,
        )
        return {"success": True}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Contact Form Error")
        return {"success": False, "error": str(e)}
