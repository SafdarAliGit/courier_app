"""
courier_app/api/invoice_api.py
Server-side shipment label — HTML (print) + PDF (download).
"""

import frappe
from frappe.utils import flt, format_date


# ─── Barcode helper ──────────────────────────────────────────────────────────

def _barcode_settings():
    """Return (show_barcode, barcode_type, barcode_height) from Courier Settings."""
    try:
        show    = frappe.db.get_single_value("Courier Settings", "barcode_on_invoice")
        btype   = frappe.db.get_single_value("Courier Settings", "barcode_type") or "Code 128"
        bheight = int(frappe.db.get_single_value("Courier Settings", "barcode_height") or 60)
        return bool(show), btype, max(40, bheight)
    except Exception:
        return True, "Code 128", 60


def _make_barcode_html(shipment_name, barcode_type, bar_height):
    """Return an HTML snippet containing the inline SVG barcode."""
    try:
        from courier_app.api.barcode_api import generate_barcode_svg
        svg = generate_barcode_svg(shipment_name, barcode_type=barcode_type, bar_height=bar_height)
        return svg
    except Exception:
        return ""


# ─── Helpers ────────────────────────────────────────────────────────────────

def _company_ctx():
    try:
        from courier_app.website_settings import get_website_context
        ctx = get_website_context()
        return {
            "company_name":    ctx.company_name    or "",
            "company_logo":    ctx.company_logo    or "",
            "contact_email":   ctx.contact_email   or "",
            "contact_phone":   ctx.contact_phone   or "",
            "contact_address": ctx.contact_address or "",
            "currency":        ctx.currency        or "PKR",
        }
    except Exception:
        _company = frappe.db.get_single_value("Global Defaults", "default_company") or ""
        _currency = (frappe.db.get_value("Company", _company, "default_currency") or
                     frappe.db.get_single_value("Global Defaults", "default_currency") or "PKR")
        return {
            "company_name":    _company or "Company",
            "company_logo":    "",
            "contact_email":   "",
            "contact_phone":   "",
            "contact_address": "",
            "currency":        _currency,
        }


def _esc(val):
    return frappe.utils.escape_html(str(val or ""))


def _kv_addr_html(doc, prefix):
    """Build a KV table for sender/recipient — label left, value right."""
    def g(f): return (getattr(doc, f, "") or "").strip()
    rows = []
    if g(f"{prefix}_name"):          rows.append(("Full Name:",    g(f"{prefix}_name")))
    if g(f"{prefix}_company"):       rows.append(("Company:",      g(f"{prefix}_company")))
    if g(f"{prefix}_phone"):         rows.append(("Phone:",        g(f"{prefix}_phone")))
    if g(f"{prefix}_email"):         rows.append(("Email:",        g(f"{prefix}_email")))
    if g(f"{prefix}_address_line1"): rows.append(("Address:",      g(f"{prefix}_address_line1")))
    if g(f"{prefix}_address_line2"): rows.append(("",              g(f"{prefix}_address_line2")))
    city_state = ", ".join(filter(None, [g(f"{prefix}_city"), g(f"{prefix}_state")]))
    if city_state:                   rows.append(("City / State:", city_state))
    if g(f"{prefix}_country"):       rows.append(("Country:",      g(f"{prefix}_country")))
    if g(f"{prefix}_zip"):           rows.append(("ZIP / Postal:", g(f"{prefix}_zip")))

    if not rows:
        return '<table class="kv"><tr><td colspan="2" style="color:#aaa;font-style:italic;padding:8pt;">—</td></tr></table>'
    html = '<table class="kv">'
    for label, val in rows:
        html += f'<tr><td>{_esc(label)}</td><td>{_esc(val)}</td></tr>'
    html += '</table>'
    return html


# ─── HTML builder ────────────────────────────────────────────────────────────

def _build_html(name, for_print=False, for_pdf=False):
    doc = frappe.get_doc("Courier Shipment", name)
    co  = _company_ctx()
    cur = co["currency"]

    # Barcode
    # show_barcode, barcode_type, bar_height = _barcode_settings()
    # barcode_html = _make_barcode_html(name, barcode_type, bar_height) if show_barcode else ""
    barcode_html = ""

    # Service provider display name
    sp_name = ""
    if doc.service_provider:
        try:
            sp = frappe.get_doc("Service Provider", doc.service_provider)
            sp_name = sp.provider_name or sp.name
        except Exception:
            sp_name = doc.service_provider

    service_val  = (getattr(doc, "services", "") or getattr(doc, "service", "") or "").strip() or "—"
    ship_date_str = format_date(doc.ship_date, "d MMM yyyy") if doc.ship_date else "—"
    now_str = frappe.utils.now_datetime().strftime("%-d %b %Y, %H:%M")

    # ── Packages rows ────────────────────────────────────────────────────────
    pkg_rows   = ""
    pkg_wt_tot = 0.0
    pkg_am_tot = 0.0
    for i, p in enumerate(doc.packages or [], 1):
        w   = flt(p.weight)
        aw  = flt(p.actual_weight)
        amt = flt(p.amount)
        dims = f"{p.length} × {p.width} × {p.height}" if (p.length and p.width and p.height) else "—"
        aw_str = f"{aw:.3f} kg" if aw else "—"
        amt_str = f"{amt:,.2f}" if amt else "—"
        pkg_wt_tot += aw if aw else w
        pkg_am_tot += amt
        pkg_rows += f"""
      <tr>
        <td class="tc">{i}</td>
        <td class="tr">{w:.3f}</td>
        <td>{_esc(p.weight_unit or "kg")}</td>
        <td>{dims}</td>
        <td class="tr">{aw_str}</td>
        <td class="tr">{amt_str}</td>
      </tr>"""

    pkg_rows += f"""
      <tr class="sum-row">
        <td colspan="4" class="tr"><strong>Totals</strong></td>
        <td class="tr"><strong>{pkg_wt_tot:.3f} kg</strong></td>
        <td class="tr"><strong>{pkg_am_tot:,.2f}</strong></td>
      </tr>"""

    # ── Commodities rows ─────────────────────────────────────────────────────
    comm_rows   = ""
    comm_am_tot = 0.0
    comm_wt_tot = 0.0
    for i, c in enumerate(doc.commodities or [], 1):
        units = flt(c.units)
        price = flt(c.price)
        amt   = flt(c.amount)
        wt    = flt(c.weight)
        wt_u  = (getattr(c, "wt_unit", "") or "kgs").lower()
        wt_kg = wt * 0.453592 if wt_u == "lbs" else wt
        comm_am_tot += amt
        comm_wt_tot += wt_kg
        comm_rows += f"""
      <tr>
        <td class="tc">{i}</td>
        <td class="tr">{f"{units:g}" if units else "—"}</td>
        <td>{_esc(c.uom or "—")}</td>
        <td class="tr">{f"{wt:.3f}" if wt else "—"}</td>
        <td>{_esc(wt_u)}</td>
        <td>{_esc(c.description or "—")}</td>
        <td>{_esc(c.hs_code or "—")}</td>
        <td class="tr">{f"{price:,.2f}" if price else "—"}</td>
        <td class="tr">{f"{amt:,.2f}" if amt else "—"}</td>
      </tr>"""

    comm_rows += f"""
      <tr class="sum-row">
        <td colspan="7" class="tr"><strong>Totals</strong></td>
        <td class="tr"><strong>{comm_wt_tot:.3f} kg</strong></td>
        <td class="tr"><strong>{comm_am_tot:,.2f}</strong></td>
      </tr>"""

    # ── Company logo ─────────────────────────────────────────────────────────
    logo_html = ""
    if co["company_logo"]:
        logo_html = f'<img src="{co["company_logo"]}" alt="{_esc(co["company_name"])}" style="width:60pt;height:60pt;object-fit:contain;flex-shrink:0;">'

    # Sender / Recipient
    sender_html    = _kv_addr_html(doc, "sender")
    recipient_html = _kv_addr_html(doc, "recipient")

    # Auto-print JS (popup print only — not for server-side PDF)
    auto_print = '<script>window.addEventListener("load",function(){window.focus();window.print();});</script>' if (for_print and not for_pdf) else ""

    inv_total = pkg_am_tot  # package total is the label amount

    # ── CSS ──────────────────────────────────────────────────────────────────
    accent = "#2C1A3E"
    css = f"""
@page {{ size: A4 portrait; margin: 0 6mm 4mm; }}
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  margin: 0; padding: 0; width: 100%;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 7.5pt;
  color: #1a1a1a;
  background: #fff;
  line-height: 1.35;
}}
.page {{ width:100%; background:#fff; }}

/* ── Header ── */
.inv-header {{
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:14pt; padding-bottom:7pt; margin-bottom:7pt;
  border-bottom:2pt solid {accent};
}}
.inv-brand {{ display:flex; gap:10pt; align-items:flex-start; }}
.inv-company {{ font-size:16pt; font-weight:800; letter-spacing:-0.02em; color:{accent}; margin-bottom:2pt; }}
.inv-co-line {{ font-size:7pt; color:#555; line-height:1.6; }}
.inv-right {{ text-align:right; flex-shrink:0; max-width:55%; }}
.inv-right .barcode-strip {{ border:0.5pt solid #e8e8e8; border-radius:3pt; margin-top:6pt; padding:5pt 8pt; }}
.inv-right .barcode-strip svg {{ max-width:200pt; height:auto; }}
.inv-title {{
  font-size:17pt; font-weight:800; letter-spacing:-0.04em;
  color:{accent}; margin-bottom:5pt; text-transform:uppercase;
}}
.meta-tbl {{ border-collapse:collapse; margin-left:auto; font-size:7pt; }}
.meta-tbl td {{ padding:1.5pt 0; vertical-align:top; }}
.meta-tbl td:first-child {{ color:#222; padding-right:12pt; white-space:nowrap; font-size:6.5pt; font-weight:700; }}
.meta-tbl td:last-child {{ font-family:'Courier New',monospace; font-weight:700; color:#1a1a1a; }}

/* ── Blocks ── */
.block {{ border:1.5pt solid #bbb; border-radius:3pt; overflow:hidden; break-inside:avoid; page-break-inside:avoid; margin-bottom:5pt; }}
.block-title {{
  display:flex; align-items:center;
  background:#fff; border-bottom:1.5pt solid #bbb;
  padding:4pt 10pt; font-size:6.5pt; font-weight:700;
  text-transform:uppercase; letter-spacing:0.09em; color:#333;
}}
.num {{
  display:inline-flex; align-items:center; justify-content:center;
  width:12pt; height:12pt; border-radius:50%;
  background:{accent}; color:#fff; font-size:5.5pt; font-weight:700; flex-shrink:0;
  margin-right:9pt;
}}

/* ── Party strip (Sender | Recipient side-by-side) ── */
.party-strip {{ display:flex; margin-bottom:5pt; }}
.party-strip .block {{ flex:1; min-width:0; margin-bottom:0; }}
.party-strip .block:first-child {{ margin-right:5pt; }}

/* ── KV table ── */
.kv {{ width:100%; border-collapse:collapse; font-size:7.5pt; }}
.kv tr {{ border-bottom:1pt solid #e0e0e0; }}
.kv tr:last-child {{ border-bottom:none; }}
.kv td {{ padding:2.5pt 8pt; line-height:1.3; }}
.kv td:first-child {{ color:#222; width:44%; font-size:6.5pt; font-weight:700; white-space:nowrap; }}
.kv td:last-child {{ font-weight:600; text-align:right; font-family:'Courier New',monospace; font-size:7pt; color:#111; }}

/* ── Shipment details: 2-up KV (two label/value pairs per row) ── */
.kv2 {{ width:100%; border-collapse:collapse; font-size:7.5pt; }}
.kv2 tr {{ border-bottom:1pt solid #e0e0e0; }}
.kv2 tr:last-child {{ border-bottom:none; }}
.kv2 td {{ padding:2.5pt 8pt; line-height:1.3; width:25%; }}
.kv2 td.lbl {{ color:#222; font-size:6.5pt; font-weight:700; white-space:nowrap; width:18%; }}
.kv2 td.val {{ font-weight:600; font-family:'Courier New',monospace; font-size:7pt; color:#111; }}

/* ── Data tables ── */
.dt {{ width:100%; border-collapse:collapse; font-size:7pt; }}
.dt th {{
  background:#fff; border-bottom:1.5pt solid #bbb;
  padding:2.5pt 5pt; font-size:5.5pt; font-weight:700;
  text-transform:uppercase; letter-spacing:0.07em;
  color:#333; text-align:left; white-space:nowrap;
}}
.dt th.tr {{ text-align:right; }}
.dt td {{
  padding:2.5pt 5pt; border-bottom:1pt solid #e0e0e0;
  font-family:'Courier New',monospace; font-size:6.5pt; vertical-align:middle;
}}
.dt tbody tr:last-child td {{ border-bottom:none; }}
.sum-row td {{
  background:#fff; border-top:1.5pt solid #bbb !important; border-bottom:none !important;
  font-size:6.5pt; padding:2.5pt 5pt; font-family:'Helvetica Neue',Arial,sans-serif;
  color:{accent}; font-weight:700;
}}

/* ── label Total strip ── */
.inv-total {{
  display:flex; justify-content:space-between; align-items:center;
  background:#fff; border-top:1.5pt solid {accent};
  padding:5pt 10pt; margin-bottom:5pt;
}}
.inv-total-label {{ font-size:7.5pt; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; color:{accent}; }}
.inv-total-val {{ font-size:11pt; font-weight:800; font-family:'Courier New',monospace; letter-spacing:-0.01em; color:{accent}; }}

/* ── Footer ── */
.inv-footer {{
  display:flex; justify-content:space-between;
  font-size:6pt; color:#aaa; border-top:1pt solid #ccc; padding-top:2pt;
  margin-top:2pt;
}}
.tc {{ text-align:center; }}
.tr {{ text-align:right; }}

/* ── Barcode strip ── */
.barcode-strip {{
  display:flex; align-items:center; justify-content:center; flex-direction:column;
  padding:6pt 10pt;
  background:#fff; border-top:1pt solid #ccc;
  page-break-inside:avoid;
}}
.barcode-strip svg {{ display:block; max-width:100%; height:auto; }}

/* ── Copy label & separator ── */
.copy {{ page-break-inside:avoid; margin-top:2pt; padding-top:2pt; }}
.copy + .copy {{ margin-top:3pt; }}
.cut-line {{
  display:flex; align-items:center; margin:4pt 0; color:#bbb;
  font-size:9pt; line-height:1;
}}
.cut-line::before, .cut-line::after {{
  content:''; flex:1; border-top:1pt dashed #bbb;
}}
.cut-line::before {{ margin-right:5pt; }}
.cut-line::after  {{ margin-left:5pt; }}
.inv-header {{ flex-wrap:wrap; }}
.copy-label {{
  width:100%; text-align:center;
  font-size:6.5pt; font-weight:700; letter-spacing:0.1em;
  color:#555; padding-top:1pt; padding-bottom:0;
}}
@media print {{
  * {{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
}}
"""

    # ── Inner copy content (shared; __COPY_LABEL__ replaced per copy) ──────────
    copy_content = f"""
  <!-- HEADER -->
  <div class="inv-header">
    <div class="inv-brand">
      {logo_html}
      <div>
        <div class="inv-company">{_esc(co["company_name"])}</div>
        {('<div class="inv-co-line">' + _esc(co["contact_address"]) + '</div>') if co["contact_address"] else ''}
        {('<div class="inv-co-line">Tel: ' + _esc(co["contact_phone"]) + '</div>') if co["contact_phone"] else ''}
        {('<div class="inv-co-line">' + _esc(co["contact_email"]) + '</div>') if co["contact_email"] else ''}
      </div>
    </div>
    <div class="inv-right">
      <div class="inv-title">Shipment Label</div>
      <table class="meta-tbl">
        <tr><td>Shipment ID:</td><td>{_esc(name)}</td></tr>
        <tr><td>Ship Date:</td><td>{ship_date_str}</td></tr>
        <tr><td>Label Date:</td><td>{now_str}</td></tr>
      </table>
      {(f'<div class="barcode-strip">{barcode_html}</div>') if barcode_html else ''}
    </div>
    <div class="copy-label">__COPY_LABEL__</div>
  </div>

  <!-- 01 SHIPMENT DETAILS — full width, 2-up KV -->
  <div class="block">
    <div class="block-title"><span class="num">01</span>Shipment Details</div>
    <table class="kv2">
      <tr>
        <td class="lbl">Type:</td><td class="val">{_esc(doc.shipment_type or "—")}</td>
        <td class="lbl">Service Provider:</td><td class="val">{_esc(sp_name or "—")}</td>
      </tr>
      <tr>
        <td class="lbl">Ship Date:</td><td class="val">{ship_date_str}</td>
        <td class="lbl">Service:</td><td class="val">{_esc(service_val)}</td>
      </tr>
      <tr>
        <td class="lbl">Packaging:</td><td class="val">{_esc(doc.packaging_type or "—")}</td>
        <td class="lbl">Party/Client:</td><td class="val">{_esc(doc.party_name or "—")}</td>
      </tr>
    </table>
  </div>

  <!-- 02 SENDER | 03 RECIPIENT — side by side -->
  <div class="party-strip">
    <div class="block">
      <div class="block-title"><span class="num">02</span>Sender Details</div>
      {sender_html}
    </div>
    <div class="block">
      <div class="block-title"><span class="num">03</span>Recipient Details</div>
      {recipient_html}
    </div>
  </div>

  <!-- 04 COMMODITIES — full width -->
  <div class="block">
    <div class="block-title"><span class="num">04</span>Commodities</div>
    <table class="dt">
      <thead>
        <tr>
          <th class="tc">#</th><th class="tr">Units</th><th>UOM</th>
          <th class="tr">Weight</th><th>Unit</th>
          <th>Description of Goods</th><th>HS Code</th>
          <th class="tr">Value ({_esc(cur)})</th>
          <th class="tr">Total Value ({_esc(cur)})</th>
        </tr>
      </thead>
      <tbody>{comm_rows}</tbody>
    </table>
  </div>

  <!-- 05 PACKAGES — full width, at bottom; total = label amount -->
  <div class="block" style="margin-bottom:0;">
    <div class="block-title"><span class="num">05</span>Package Details</div>
    <table class="dt">
      <thead>
        <tr>
          <th class="tc">#</th><th class="tr">Weight</th><th>Unit</th>
          <th>L &times; W &times; H (cm)</th>
          <th class="tr">Actual Wt</th>
          <th class="tr">Amount ({_esc(cur)})</th>
        </tr>
      </thead>
      <tbody>{pkg_rows}</tbody>
    </table>
    <div class="inv-total">
      <span class="inv-total-label">Total Amount</span>
      <span class="inv-total-val">{_esc(cur)}&nbsp;{inv_total:,.2f}</span>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="inv-footer">
    <span>Generated by {_esc(co["company_name"])}</span>
    <span>{now_str}</span>
  </div>"""

    # ── Full HTML (two copies) ────────────────────────────────────────────────
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Label — {_esc(name)}</title>
<style>{css}</style>
</head>
<body>
<div class="page">

  <div class="copy">
    {copy_content.replace("__COPY_LABEL__", "(Office Copy)")}
  </div>

  <div class="cut-line">&#9986;</div>

  <div class="copy">
    {copy_content.replace("__COPY_LABEL__", "(Client Copy)")}
  </div>

</div>
{auto_print}
</body>
</html>"""
    return html


# ─── Public endpoints ────────────────────────────────────────────────────────

@frappe.whitelist()
def get_invoice_html(name):
    """Returns complete self-contained label HTML (for popup print)."""
    return _build_html(name, for_print=True)


@frappe.whitelist()
def get_invoice_pdf(name):
    """Generates Label PDF and streams it as a file download."""
    html = _build_html(name, for_pdf=True)
    from frappe.utils.pdf import get_pdf
    # Margins set to 0 so the @page CSS (margin: 8mm 10mm 8mm) drives layout
    # exactly as it does in the browser print view — same design as Print button.
    pdf_bytes = get_pdf(
        html,
        options={
            "orientation":              "Portrait",
            "page-size":                "A4",
            "margin-top":               "0",
            "margin-bottom":            "4mm",
            "margin-left":              "6mm",
            "margin-right":             "6mm",
            "no-outline":               None,
            "enable-local-file-access": None,
            "print-media-type":         None,
        }
    )
    frappe.local.response.filename    = f"Label-{name}.pdf"
    frappe.local.response.filecontent = pdf_bytes
    frappe.local.response.type        = "download"
