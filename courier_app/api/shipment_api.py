"""
courier_app/api/shipment_api.py
All @frappe.whitelist() endpoints used by portal + desk page.
"""

import frappe
from frappe import _
from frappe.utils import today, flt, nowdate


# ─── PORTAL: Submit new shipment ────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def submit_shipment(data):
    """Called by public portal. Creates a Draft Shipment doc."""
    import json
    if isinstance(data, str):
        data = json.loads(data)

    _validate_portal_data(data)

    doc = frappe.new_doc("Courier Shipment")
    doc.update({
        "shipment_type":        data.get("shipment_type", "Outbound"),
        "ship_date":            data.get("ship_date") or today(),
        "services":             data.get("service") or data.get("services") or "",
        "packaging_type":       data.get("packaging_type") or "Others",
        "sender_name":          data.get("sender_name"),
        "sender_company":       data.get("sender_company"),
        "sender_phone":         data.get("sender_phone"),
        "sender_email":         data.get("sender_email"),
        "sender_address_line1": data.get("sender_address_line1"),
        "sender_address_line2": data.get("sender_address_line2"),
        "sender_city":          data.get("sender_city"),
        "sender_state":         data.get("sender_state") or "",
        "sender_country":       data.get("sender_country"),
        "sender_zip":           data.get("sender_zip"),
        "recipient_name":       data.get("recipient_name"),
        "recipient_company":    data.get("recipient_company"),
        "recipient_phone":      data.get("recipient_phone"),
        "recipient_email":      data.get("recipient_email"),
        "recipient_address_line1": data.get("recipient_address_line1"),
        "recipient_address_line2": data.get("recipient_address_line2"),
        "recipient_city":       data.get("recipient_city"),
        "recipient_state":      data.get("recipient_state") or "",
        "recipient_country":    data.get("recipient_country"),
        "recipient_zip":        data.get("recipient_zip"),
        "is_residential":       data.get("is_residential", 0),
        "bill_transportation_to": data.get("bill_transportation_to", "My Account"),
        "bill_duties_to":       data.get("bill_duties_to", "Recipient"),
        "signature_required":   data.get("signature_required", 0),
        "hold_at_location":     data.get("hold_at_location", 0),
        "email_label":          data.get("email_label", 0),
        "special_instructions": data.get("special_instructions"),
        "customer_reference":   data.get("customer_reference"),
        "service_provider":     data.get("service_provider") or None,
        "submitted_by_portal":  1,
        "portal_email": (
            frappe.session.user
            if frappe.session.user and frappe.session.user != "Guest"
            else data.get("sender_email") or ""
        ),
    })

    for pkg in (data.get("packages") or []):
        doc.append("packages", {
            "weight":         flt(pkg.get("weight")),
            "weight_unit":    pkg.get("weight_unit", "kg"),
            "length":         flt(pkg.get("length")),
            "width":          flt(pkg.get("width")),
            "height":         flt(pkg.get("height")),
            "description":    pkg.get("description"),
            "declared_value": flt(pkg.get("declared_value")),
            "actual_weight":  flt(pkg.get("actual_weight")),
            "amount":         flt(pkg.get("amount")),
        })

    for comm in (data.get("commodities") or []):
        if not flt(comm.get("units")) and not comm.get("desc") and not comm.get("price"):
            continue
        doc.append("commodities", {
            "units":       flt(comm.get("units")),
            "uom":         comm.get("uom") or "Kg",
            "weight":      flt(comm.get("weight")),
            "wt_unit":     comm.get("wt_unit") or "kgs",
            "description": comm.get("desc") or "",
            "hs_code":     comm.get("hs_code") or "",
            "price":       flt(comm.get("price")),
            "amount":      flt(comm.get("amount")),
        })

    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "success",
        "shipment_id": doc.name,
        "tracking_number": doc.tracking_number or "",
        "total_weight": doc.total_weight or 0,
        "rate_per_kg": doc.rate_per_kg or 0,
        "calculated_rate": doc.calculated_rate or 0,
        "packages": [
            {
                "package_no": p.package_no,
                "weight": p.weight,
                "weight_unit": p.weight_unit,
                "length": p.length,
                "width": p.width,
                "height": p.height,
                "actual_weight": p.actual_weight or 0,
                "amount": p.amount or 0,
            }
            for p in doc.packages
        ],
    }


# ─── PORTAL: Get live rate ───────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_live_rate(country, weight, service=None, service_provider=None):
    """Returns shipping rate for portal rate calculator."""
    weight = flt(weight)
    if weight <= 0:
        return {"rate": 0, "error": "Weight must be > 0"}
    if not country:
        return {"rate": 0, "error": "Country required"}

    try:
        from courier_app.shipping_rates import get_shipping_rate
        result = get_shipping_rate(country=country, weight=weight, service_provider=service_provider or None)
        return {
            "rate":               result.get("rate", 0),
            # new model fields
            "zone":               result.get("zone", ""),
            "zone_code":          result.get("zone_code", ""),
            "zone_label":         result.get("zone_label", ""),
            "service_provider":   result.get("service_provider", ""),
            # legacy fields (still present when no provider given)
            "rate_card":          result.get("rate_card", ""),
            "express_saver_code": result.get("express_saver_code", ""),
            "note":               result.get("note", ""),
        }
    except Exception as e:
        return {"rate": 0, "error": str(e)}


# ─── RATE CALCULATOR: public endpoints ──────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_calculator_providers():
    """Returns all active service providers for the rate calculator."""
    try:
        return frappe.get_all(
            "Service Provider",
            filters={"is_active": 1},
            fields=["name", "provider_name", "provider_code"],
            order_by="provider_name"
        )
    except Exception:
        return []


@frappe.whitelist(allow_guest=True)
def get_countries_for_provider(query, service_provider):
    """Public country autocomplete for rate calculator."""
    if not service_provider:
        return []
    try:
        return frappe.db.sql(
            """
            SELECT country_name, country_code, zone_code
            FROM `tabCountry Zone`
            WHERE service_provider = %(sp)s
              AND (country_name LIKE %(q)s OR country_code LIKE %(q)s)
            ORDER BY country_name LIMIT 30
            """,
            {"sp": service_provider, "q": f"%{query}%"},
            as_dict=True,
        )
    except Exception:
        return []


@frappe.whitelist(allow_guest=True)
def get_zone_rate_table(country, service_provider):
    """Returns the full rate slab table for a country's zone (for rate calculator)."""
    if not country or not service_provider:
        return {"error": "Country and service provider are required"}
    try:
        from courier_app.shipping_rates import _resolve_provider, _resolve_country_zone

        sp_name = _resolve_provider(service_provider)
        if not sp_name:
            return {"error": f"Service provider '{service_provider}' not found or inactive"}

        cz = _resolve_country_zone(country, sp_name)
        if not cz:
            return {"error": f"Country '{country}' is not configured for this provider"}

        zone_name = cz.get("shipping_zone") or frappe.db.get_value(
            "Rate Zone",
            {"service_provider": sp_name, "zone_code": cz["zone_code"], "is_active": 1},
            "name",
        )
        if not zone_name:
            return {"error": f"Rate zone (code {cz['zone_code']}) not found for this provider"}

        zone = frappe.get_doc("Rate Zone", zone_name)

        normal_slabs = sorted(
            [s for s in zone.rate_slabs if not s.is_per_kg_above_max],
            key=lambda s: flt(s.max_weight_kg),
        )
        per_kg_slab = next((s for s in zone.rate_slabs if s.is_per_kg_above_max), None)

        slabs = [
            {"max_weight_kg": flt(s.max_weight_kg), "rate": flt(s.rate), "is_per_kg_above_max": False}
            for s in normal_slabs
        ]
        if per_kg_slab:
            slabs.append({
                "max_weight_kg": None,
                "rate": flt(per_kg_slab.rate),
                "is_per_kg_above_max": True,
                "base_weight_kg": flt(normal_slabs[-1].max_weight_kg) if normal_slabs else 0,
                "base_rate": flt(normal_slabs[-1].rate) if normal_slabs else 0,
            })

        return {
            "zone_name":    zone_name,
            "zone_code":    zone.zone_code,
            "zone_label":   zone.zone_label or "",
            "country_name": cz["country_name"],
            "country_code": cz["country_code"],
            "slabs":        slabs,
        }
    except Exception as e:
        return {"error": str(e)}


# ─── RATE CALCULATOR: All-provider comparison ───────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_rates_all_providers(country, weight):
    """
    Returns shipping rates from ALL active service providers for a given
    country + weight. Used by the portal rate comparison calculator.

    Returns:
      {
        country, weight_kg,
        rates: [{ provider_name, provider_code, provider_id,
                  zone_code, zone_label, rate, note,
                  country_name, country_code }],
        best_provider_id   – provider_id with lowest rate (or None)
      }
    """
    weight = flt(weight)
    if weight <= 0:
        return {"rates": [], "error": "Weight must be greater than 0"}
    if not country:
        return {"rates": [], "error": "Country is required"}

    from courier_app.shipping_rates import _resolve_country_zone, _calculate_rate

    providers = frappe.get_all(
        "Service Provider",
        filters={"is_active": 1},
        fields=["name", "provider_name", "provider_code"],
        order_by="provider_name",
    )

    rates = []
    for provider in providers:
        try:
            sp_name = provider["name"]
            cz = _resolve_country_zone(country, sp_name)
            if not cz:
                continue

            zone_name = cz.get("shipping_zone") or frappe.db.get_value(
                "Rate Zone",
                {"service_provider": sp_name, "zone_code": cz["zone_code"], "is_active": 1},
                "name",
            )
            if not zone_name:
                continue

            zone = frappe.get_doc("Rate Zone", zone_name)
            if not zone.is_active:
                continue

            rate, note = _calculate_rate(zone.rate_slabs, weight)
            rates.append({
                "provider_name": provider.get("provider_name") or provider["name"],
                "provider_code": provider.get("provider_code") or "",
                "provider_id":   sp_name,
                "zone_code":     zone.zone_code,
                "zone_label":    zone.zone_label or "",
                "rate":          round(rate, 2),
                "note":          note,
                "country_name":  cz["country_name"],
                "country_code":  cz.get("country_code", ""),
            })
        except Exception:
            pass  # No rate for this country/provider — omit silently

    # Sort cheapest first
    rates.sort(key=lambda x: (x.get("rate") is None, x.get("rate") or 0))

    return {
        "country":          country,
        "weight_kg":        weight,
        "rates":            rates,
        "best_provider_id": rates[0]["provider_id"] if rates else None,
    }


# ─── RATE CALCULATOR: Country search across all providers ───────────────────

@frappe.whitelist(allow_guest=True)
def get_countries_for_calc(query):
    """Country autocomplete across all active service providers (for 'All Providers' mode)."""
    if not query:
        return []
    try:
        return frappe.db.sql(
            """
            SELECT DISTINCT country_name, country_code
            FROM `tabCountry Zone`
            WHERE country_name LIKE %(q)s OR country_code LIKE %(q)s
            ORDER BY country_name LIMIT 30
            """,
            {"q": f"%{query}%"},
            as_dict=True,
        )
    except Exception:
        return []


# ─── PORTAL: Track shipment ──────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def track_shipment(tracking_number):
    """Public tracking lookup."""
    if not tracking_number:
        frappe.throw(_("Tracking number required"))

    # Try by tracking number first, then by shipment ID
    doc = frappe.db.get_value(
        "Courier Shipment",
        {"tracking_number": tracking_number},
        ["name", "tracking_number", "status", "ship_date", "estimated_delivery",
         "service", "recipient_name", "recipient_city", "recipient_country",
         "total_weight", "calculated_rate"],
        as_dict=True
    )
    if not doc and frappe.db.exists("Courier Shipment", tracking_number):
        doc = frappe.db.get_value(
            "Courier Shipment",
            tracking_number,
            ["name", "tracking_number", "status", "ship_date", "estimated_delivery",
             "service", "recipient_name", "recipient_city", "recipient_country",
             "total_weight", "calculated_rate"],
            as_dict=True
        )
    if not doc:
        return {"found": False}

    doc["found"] = True
    return doc


# ─── PORTAL: Track via AfterShip API ────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def track_aftership(tracking_id):
    """Fetch live tracking data from AfterShip using the API key stored in Courier Settings."""
    import requests

    if not tracking_id:
        return {"found": False, "error": "Tracking ID is required"}

    try:
        settings = frappe.get_single("Courier Settings")
        api_key = settings.get_password("api_key") if settings.api_key else None
    except Exception:
        return {"found": False, "error": "Courier Settings not configured"}

    if not api_key:
        return {"found": False, "error": "AfterShip API key not set in Courier Settings"}

    url = "https://api.aftership.com/tracking/2024-10/trackings"
    headers = {
        "as-api-key": api_key,
        "Content-Type": "application/json",
    }
    params = {"id": tracking_id}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        data = resp.json()
    except Exception as e:
        frappe.log_error(str(e), "AfterShip Track Error")
        return {"found": False, "error": "Could not connect to the tracking service"}

    meta_code = data.get("meta", {}).get("code")
    if meta_code != 200:
        return {
            "found": False,
            "error": data.get("meta", {}).get("message", f"API returned code {meta_code}"),
        }

    trackings = data.get("data", {}).get("trackings", [])
    if not trackings:
        return {"found": False}

    return {"found": True, "tracking": trackings[0]}


# ─── DESK: List shipments ────────────────────────────────────────────────────

@frappe.whitelist()
def get_shipments(filters=None, page=1, page_size=20, sort_by="creation", sort_order="desc"):
    import json
    if isinstance(filters, str):
        filters = json.loads(filters)
    filters = filters or {}

    conditions = "WHERE 1=1"
    values = {}

    if filters.get("status"):
        conditions += " AND s.status = %(status)s"
        values["status"] = filters["status"]
    if filters.get("shipment_type"):
        conditions += " AND s.shipment_type = %(shipment_type)s"
        values["shipment_type"] = filters["shipment_type"]
    if filters.get("search"):
        conditions += """ AND (
            s.name LIKE %(search)s OR
            s.tracking_number LIKE %(search)s OR
            s.recipient_name LIKE %(search)s OR
            s.recipient_country LIKE %(search)s
        )"""
        values["search"] = f"%{filters['search']}%"
    if filters.get("date_from"):
        conditions += " AND s.ship_date >= %(date_from)s"
        values["date_from"] = filters["date_from"]
    if filters.get("date_to"):
        conditions += " AND s.ship_date <= %(date_to)s"
        values["date_to"] = filters["date_to"]
    if filters.get("approval_status"):
        conditions += " AND s.approval_status = %(approval_status)s"
        values["approval_status"] = filters["approval_status"]
    if filters.get("portal") is not None and filters["portal"] != "":
        conditions += " AND s.submitted_by_portal = %(portal)s"
        values["portal"] = int(filters["portal"])

    allowed_sort = {"creation", "ship_date", "recipient_name", "status", "calculated_rate", "total_weight"}
    sort_by = sort_by if sort_by in allowed_sort else "creation"
    sort_order = "ASC" if sort_order.lower() == "asc" else "DESC"

    offset = (int(page) - 1) * int(page_size)

    total = frappe.db.sql(
        f"SELECT COUNT(*) FROM `tabCourier Shipment` s {conditions}",
        values
    )[0][0]

    rows = frappe.db.sql(f"""
        SELECT
            s.name, s.status, s.approval_status, s.shipment_type, s.ship_date,
            s.services, s.service_provider, s.tracking_number,
            s.total_weight, s.rate_per_kg, s.calculated_rate,
            s.estimated_delivery, s.total_commodity_amount,
            s.sender_name, s.sender_company, s.sender_phone, s.sender_email,
            s.sender_country, s.sender_state, s.sender_city, s.sender_zip,
            s.sender_address_line1, s.sender_address_line2,
            s.recipient_name, s.recipient_company, s.recipient_phone, s.recipient_email,
            s.recipient_country, s.recipient_state, s.recipient_city, s.recipient_zip,
            s.recipient_address_line1, s.recipient_address_line2,
            s.is_residential, s.packaging_type,
            s.bill_transportation_to, s.bill_duties_to,
            s.signature_required, s.hold_at_location,
            s.special_instructions, s.customer_reference,
            s.submitted_by_portal, s.portal_email,
            s.customer, s.sales_order, s.approved_by, s.approved_on,
            s.docstatus, s.creation,
            (SELECT ROUND(SUM(IFNULL(p.actual_weight, 0)), 3)
             FROM `tabShipment Package` p
             WHERE p.parent = s.name) AS total_actual_weight
        FROM `tabCourier Shipment` s
        {conditions}
        ORDER BY s.{sort_by} {sort_order}
        LIMIT %(limit)s OFFSET %(offset)s
    """, {**values, "limit": int(page_size), "offset": offset}, as_dict=True)

    return {
        "rows": rows,
        "total": total,
        "page": int(page),
        "page_size": int(page_size),
        "pages": -(-total // int(page_size)),
    }


# ─── DESK: Export shipments (CSV or PDF) ─────────────────────────────────────

@frappe.whitelist()
def export_shipments(filters=None, fields=None, sort_by="creation", sort_order="desc", export_format="csv"):
    import json, csv, io
    from datetime import datetime

    if isinstance(filters, str): filters = json.loads(filters)
    if isinstance(fields, str):  fields  = json.loads(fields)
    filters = filters or {}
    fields  = fields  or []

    conditions = "WHERE 1=1"
    values = {}

    if filters.get("status"):
        conditions += " AND s.status = %(status)s"
        values["status"] = filters["status"]
    if filters.get("shipment_type"):
        conditions += " AND s.shipment_type = %(shipment_type)s"
        values["shipment_type"] = filters["shipment_type"]
    if filters.get("search"):
        conditions += """ AND (
            s.name LIKE %(search)s OR s.tracking_number LIKE %(search)s OR
            s.recipient_name LIKE %(search)s OR s.recipient_country LIKE %(search)s
        )"""
        values["search"] = f"%{filters['search']}%"
    if filters.get("date_from"):
        conditions += " AND s.ship_date >= %(date_from)s"
        values["date_from"] = filters["date_from"]
    if filters.get("date_to"):
        conditions += " AND s.ship_date <= %(date_to)s"
        values["date_to"] = filters["date_to"]
    if filters.get("approval_status"):
        conditions += " AND s.approval_status = %(approval_status)s"
        values["approval_status"] = filters["approval_status"]
    if filters.get("portal") is not None and filters["portal"] != "":
        conditions += " AND s.submitted_by_portal = %(portal)s"
        values["portal"] = int(filters["portal"])

    allowed_sort = {"creation", "ship_date", "recipient_name", "status", "calculated_rate", "total_weight"}
    sort_by    = sort_by if sort_by in allowed_sort else "creation"
    sort_order = "ASC" if sort_order.lower() == "asc" else "DESC"

    rows = frappe.db.sql(f"""
        SELECT
            s.name, s.status, s.approval_status, s.shipment_type, s.ship_date,
            s.services, s.service_provider, s.tracking_number,
            s.total_weight, s.rate_per_kg, s.calculated_rate,
            s.estimated_delivery, s.total_commodity_amount,
            s.sender_name, s.sender_company, s.sender_phone, s.sender_email,
            s.sender_country, s.sender_state, s.sender_city, s.sender_zip,
            s.sender_address_line1, s.sender_address_line2,
            s.recipient_name, s.recipient_company, s.recipient_phone, s.recipient_email,
            s.recipient_country, s.recipient_state, s.recipient_city, s.recipient_zip,
            s.recipient_address_line1, s.recipient_address_line2,
            s.is_residential, s.packaging_type,
            s.bill_transportation_to, s.bill_duties_to,
            s.signature_required, s.hold_at_location,
            s.special_instructions, s.customer_reference,
            s.submitted_by_portal, s.portal_email,
            s.customer, s.sales_order, s.approved_by, s.approved_on,
            s.creation,
            (SELECT ROUND(SUM(IFNULL(p.actual_weight, 0)), 3)
             FROM `tabShipment Package` p
             WHERE p.parent = s.name) AS total_actual_weight
        FROM `tabCourier Shipment` s
        {conditions}
        ORDER BY s.{sort_by} {sort_order}
    """, values, as_dict=True)

    BOOL_FIELDS = {"is_residential", "signature_required", "hold_at_location", "submitted_by_portal"}

    def cell_val(r, k):
        v = r.get(k)
        if k in BOOL_FIELDS:       return "Yes" if v else "No"
        if k == "approval_status": return v or "Pending"
        if k == "total_weight":    return f"{float(v):.2f}" if v is not None else ""
        if k == "total_actual_weight": return f"{float(v):.3f}" if v and float(v) > 0 else ""
        if k in ("calculated_rate", "total_commodity_amount"):
            return str(round(float(v))) if v is not None else ""
        if k == "rate_per_kg":     return f"{float(v):.2f}" if v is not None else ""
        return str(v) if v is not None else ""

    now      = datetime.now()
    date_str = now.strftime("%-d %b %Y")
    time_str = now.strftime("%H:%M")
    try:
        company = frappe.get_single("Global Defaults").default_company or ""
    except Exception:
        company = ""

    if export_format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([f["l"] for f in fields])
        for r in rows:
            writer.writerow([cell_val(r, f["k"]) for f in fields])

        frappe.response["type"]         = "download"
        frappe.response["filename"]     = f"shipments_{now.strftime('%Y-%m-%d')}.csv"
        frappe.response["filecontent"]  = output.getvalue().encode("utf-8-sig")
        frappe.response["content_type"] = "text/csv; charset=utf-8"

    elif export_format == "pdf":
        landscape = len(fields) > 7

        STATUS_STYLE = {
            "Draft": "background:#f1f5f9;color:#475569",
            "Pending": "background:#fef9c3;color:#854d0e",
            "Booked": "background:#dbeafe;color:#1d4ed8",
            "In Transit": "background:#ede9fe;color:#5b21b6",
            "Out for Delivery": "background:#e0f2fe;color:#0369a1",
            "Delivered": "background:#d1fae5;color:#065f46",
            "Cancelled": "background:#fee2e2;color:#991b1b",
        }
        APPR_STYLE  = {
            "Approved": "background:#d1fae5;color:#065f46",
            "Rejected": "background:#fee2e2;color:#991b1b",
            "Pending":  "background:#fef9c3;color:#854d0e",
        }
        TYPE_STYLE  = {
            "Outbound": "background:#dbeafe;color:#1d4ed8",
            "Inbound":  "background:#d1fae5;color:#065f46",
            "Return":   "background:#fce7f3;color:#9d174d",
        }

        def pdf_cell(r, k):
            raw = r.get(k)
            v   = raw if raw is not None and raw != "" else "—"
            if k in BOOL_FIELDS:
                return "Yes" if raw else "No"
            if k == "status":
                st = STATUS_STYLE.get(str(raw), "background:#f1f5f9;color:#475569")
                return f'<span style="{st};padding:2px 8px;border-radius:100px;font-size:9px;font-weight:700;white-space:nowrap;display:inline-block">{v}</span>'
            if k == "approval_status":
                st = APPR_STYLE.get(str(raw), "background:#fef9c3;color:#854d0e")
                return f'<span style="{st};padding:2px 8px;border-radius:100px;font-size:9px;font-weight:700;white-space:nowrap;display:inline-block">{raw or "Pending"}</span>'
            if k == "shipment_type":
                st = TYPE_STYLE.get(str(raw), "background:#f1f5f9;color:#475569")
                return f'<span style="{st};padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;display:inline-block">{v}</span>'
            if k == "name":
                return f'<span style="font-family:monospace;font-weight:700;font-size:10px;color:#0f172a">{v}</span>'
            if k == "tracking_number":
                return f'<span style="font-family:monospace;font-size:9px;color:#475569">{v}</span>'
            if k == "total_weight":
                return f'<span style="font-family:monospace">{float(raw):.2f}</span>' if raw is not None else "—"
            if k == "total_actual_weight":
                return f'<span style="font-family:monospace;color:#64748b">{float(raw):.3f}</span>' if raw and float(raw) > 0 else "—"
            if k == "rate_per_kg":
                return f'<span style="font-family:monospace">{float(raw):.2f}</span>' if raw is not None else "—"
            if k in ("calculated_rate", "total_commodity_amount"):
                return f'<span style="font-family:monospace;font-weight:700;color:#0f172a">{round(float(raw)):,}</span>' if raw is not None else "—"
            return str(v)

        margin      = "8mm" if landscape else "10mm"
        orientation = "landscape" if landscape else "portrait"

        rows_html = "\n".join(
            "<tr>" + "".join(f"<td>{pdf_cell(r, f['k'])}</td>" for f in fields) + "</tr>"
            for r in rows
        )

        html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;color:#1e293b;background:#fff;padding:18px 20px}}
.rpt-head{{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:12px;border-bottom:2.5px solid #0f172a}}
.rpt-title{{font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em}}
.rpt-sub{{font-size:10.5px;color:#64748b;margin-top:5px}}
.rpt-right{{text-align:right}}
.rpt-company{{font-size:11px;font-weight:600;color:#334155}}
.rpt-count{{font-size:10px;color:#64748b;margin-top:3px}}
table{{width:100%;border-collapse:collapse}}
thead tr{{background:#0f172a}}
thead th{{padding:7px 9px;text-align:left;color:#fff;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;border-right:1px solid rgba(255,255,255,0.08)}}
thead th:last-child{{border-right:none}}
tbody tr{{border-bottom:1px solid #f1f5f9}}
tbody tr:nth-child(even){{background:#f8fafc}}
tbody td{{padding:6px 9px;vertical-align:middle;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-right:1px solid #f1f5f9}}
tbody td:last-child{{border-right:none}}
.rpt-foot{{margin-top:14px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}}
@page{{margin:{margin};size:A4 {orientation}}}
</style></head><body>
<div class="rpt-head">
  <div>
    <div class="rpt-title">Shipment Report</div>
    <div class="rpt-sub">Generated {date_str} at {time_str}</div>
  </div>
  <div class="rpt-right">
    {f'<div class="rpt-company">{company}</div>' if company else ""}
    <div class="rpt-count">{len(rows)} shipment{"s" if len(rows) != 1 else ""}</div>
  </div>
</div>
<table>
  <thead><tr>{"".join(f"<th>{f['l']}</th>" for f in fields)}</tr></thead>
  <tbody>{rows_html}</tbody>
</table>
<div class="rpt-foot">
  <span>Courier App &middot; Shipment Manager</span>
  <span>{len(rows)} records &middot; {len(fields)} fields</span>
</div>
</body></html>"""

        from frappe.utils.pdf import get_pdf
        pdf_content = get_pdf(html, {
            "orientation": orientation,
            "margin-top": margin, "margin-bottom": margin,
            "margin-left": margin, "margin-right": margin,
        })

        frappe.response["type"]         = "download"
        frappe.response["filename"]     = f"shipments_{now.strftime('%Y-%m-%d')}.pdf"
        frappe.response["filecontent"]  = pdf_content
        frappe.response["content_type"] = "application/pdf"


# ─── DESK: Shipment stats ────────────────────────────────────────────────────

@frappe.whitelist()
def get_dashboard_stats():
    stats = frappe.db.sql("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status='Draft'            THEN 1 ELSE 0 END) AS draft,
            SUM(CASE WHEN status='Pending'          THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status='Booked'           THEN 1 ELSE 0 END) AS booked,
            SUM(CASE WHEN status='In Transit'       THEN 1 ELSE 0 END) AS in_transit,
            SUM(CASE WHEN status='Out for Delivery' THEN 1 ELSE 0 END) AS out_for_delivery,
            SUM(CASE WHEN status='Delivered'        THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status='Cancelled'        THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN submitted_by_portal=1     THEN 1 ELSE 0 END) AS portal_count,
            SUM(CASE WHEN approval_status='Pending' THEN 1 ELSE 0 END) AS pending_approval,
            SUM(CASE WHEN approval_status='Approved'THEN 1 ELSE 0 END) AS approved_count,
            SUM(IFNULL(calculated_rate,0))                             AS total_revenue,
            SUM(IFNULL(total_weight,0))                                AS total_weight,
            SUM(CASE WHEN DATE(creation) = CURDATE() THEN 1 ELSE 0 END) AS today_count
        FROM `tabCourier Shipment`
        WHERE docstatus < 2
    """, as_dict=True)
    return stats[0] if stats else {}


# ─── DESK: Update shipment status ───────────────────────────────────────────

@frappe.whitelist()
def update_status(shipment_id, new_status):
    allowed = ["Pending", "Booked", "In Transit", "Out for Delivery", "Delivered", "Cancelled"]
    if new_status not in allowed:
        frappe.throw(_(f"Invalid status: {new_status}"))
    frappe.db.set_value("Courier Shipment", shipment_id, "status", new_status)
    frappe.db.commit()
    return {"status": "ok", "new_status": new_status}


# ─── DESK: Delete shipment ───────────────────────────────────────────────────

@frappe.whitelist()
def delete_shipment(shipment_id):
    doc = frappe.get_doc("Courier Shipment", shipment_id)
    if doc.docstatus == 1:
        frappe.throw(_("Cannot delete a submitted shipment. Cancel it first."))
    doc.delete(ignore_permissions=False)
    frappe.db.commit()
    return {"status": "ok"}


# ─── SHARED: Countries list ──────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_countries():
    rows = frappe.db.sql(
        "SELECT country_name, name FROM `tabCountry` ORDER BY country_name",
        as_dict=True
    )
    return rows


# ─── PORTAL: Service Providers ───────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_service_providers():
    """Return active service providers for portal rate calculator."""
    try:
        providers = frappe.get_all(
            "Service Provider",
            filters={"is_active": 1},
            fields=["name", "provider_name", "provider_code"],
            order_by="provider_name"
        )
        return providers
    except Exception:
        return []


# ─── PORTAL/DESK: States/Provinces by country ────────────────────────────────

_STATES = {
    "Pakistan": [
        "Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan",
        "Islamabad Capital Territory", "Azad Jammu & Kashmir", "Gilgit-Baltistan"
    ],
    "United States": [
        "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
        "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
        "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
        "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
        "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
        "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
        "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
        "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
        "District of Columbia"
    ],
    "Canada": [
        "Alberta","British Columbia","Manitoba","New Brunswick",
        "Newfoundland and Labrador","Northwest Territories","Nova Scotia","Nunavut",
        "Ontario","Prince Edward Island","Quebec","Saskatchewan","Yukon"
    ],
    "Australia": [
        "New South Wales","Victoria","Queensland","Western Australia",
        "South Australia","Tasmania","Australian Capital Territory","Northern Territory"
    ],
    "India": [
        "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa",
        "Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala",
        "Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland",
        "Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura",
        "Uttar Pradesh","Uttarakhand","West Bengal",
        "Delhi","Jammu and Kashmir","Ladakh","Puducherry","Chandigarh"
    ],
    "United Arab Emirates": [
        "Abu Dhabi","Dubai","Sharjah","Ajman","Ras Al Khaimah","Fujairah","Umm Al Quwain"
    ],
    "Saudi Arabia": [
        "Riyadh","Makkah","Madinah","Eastern Province","Asir","Tabuk","Hail",
        "Northern Borders","Jazan","Najran","Al Bahah","Al Jawf","Qassim"
    ],
    "United Kingdom": ["England","Scotland","Wales","Northern Ireland"],
    "Germany": [
        "Baden-Württemberg","Bavaria","Berlin","Brandenburg","Bremen","Hamburg",
        "Hesse","Lower Saxony","Mecklenburg-Vorpommern","North Rhine-Westphalia",
        "Rhineland-Palatinate","Saarland","Saxony","Saxony-Anhalt",
        "Schleswig-Holstein","Thuringia"
    ],
    "China": [
        "Beijing","Shanghai","Tianjin","Chongqing","Guangdong","Zhejiang","Jiangsu",
        "Shandong","Henan","Sichuan","Hubei","Hunan","Anhui","Fujian","Liaoning",
        "Shaanxi","Jiangxi","Yunnan","Heilongjiang","Guizhou","Shanxi","Inner Mongolia",
        "Xinjiang","Tibet","Guangxi","Ningxia","Hainan","Jilin","Gansu","Qinghai"
    ],
    "Turkey": [
        "Istanbul","Ankara","Izmir","Bursa","Antalya","Adana","Konya","Gaziantep",
        "Mersin","Diyarbakır","Kayseri","Eskişehir","Samsun","Denizli","Şanlıurfa"
    ],
    "Afghanistan": [
        "Kabul","Herat","Kandahar","Balkh","Nangarhar","Kunduz","Ghazni",
        "Helmand","Badakhshan","Takhar","Baghlan","Parwan","Logar","Wardak"
    ],
    "Bangladesh": [
        "Dhaka","Chittagong","Rajshahi","Khulna","Sylhet","Barisal","Rangpur","Mymensingh"
    ],
    "Malaysia": [
        "Selangor","Kuala Lumpur","Penang","Johor","Perak","Sabah","Sarawak",
        "Negeri Sembilan","Pahang","Kelantan","Terengganu","Kedah","Perlis","Malacca","Labuan","Putrajaya"
    ],
    "Indonesia": [
        "Aceh","North Sumatra","West Sumatra","Riau","Jambi","South Sumatra",
        "Bengkulu","Lampung","Jakarta","West Java","Central Java","East Java",
        "Yogyakarta","Banten","Bali","West Nusa Tenggara","East Nusa Tenggara",
        "West Kalimantan","Central Kalimantan","South Kalimantan","East Kalimantan",
        "North Kalimantan","North Sulawesi","Central Sulawesi","South Sulawesi",
        "Southeast Sulawesi","Maluku","North Maluku","West Papua","Papua"
    ],
    "Philippines": [
        "Metro Manila","Luzon","Visayas","Mindanao",
        "Ilocos","Cagayan Valley","Central Luzon","CALABARZON","MIMAROPA",
        "Bicol","Western Visayas","Central Visayas","Eastern Visayas",
        "Zamboanga Peninsula","Northern Mindanao","Davao","SOCCSKSARGEN","Caraga","BARMM"
    ],
    "Japan": [
        "Tokyo","Kanagawa","Osaka","Aichi","Saitama","Chiba","Hyogo","Hokkaido",
        "Fukuoka","Shizuoka","Ibaraki","Hiroshima","Kyoto","Miyagi","Niigata",
        "Nagano","Tochigi","Gunma","Fukushima","Okayama","Okinawa","Kumamoto",
        "Kagoshima","Mie","Ehime","Nara","Yamaguchi","Nagasaki","Shiga","Tokushima",
        "Yamagata","Iwate","Aomori","Akita","Saga","Toyama","Ishikawa","Fukui",
        "Wakayama","Gifu","Tottori","Shimane","Kochi","Kagawa","Yamanashi"
    ],
    "South Korea": [
        "Seoul","Busan","Incheon","Daegu","Daejeon","Gwangju","Ulsan","Sejong",
        "Gyeonggi","Gangwon","North Chungcheong","South Chungcheong",
        "North Jeolla","South Jeolla","North Gyeongsang","South Gyeongsang","Jeju"
    ],
    "France": [
        "Île-de-France","Auvergne-Rhône-Alpes","Nouvelle-Aquitaine","Occitanie",
        "Hauts-de-France","Grand Est","Provence-Alpes-Côte d'Azur","Pays de la Loire",
        "Normandie","Bretagne","Bourgogne-Franche-Comté","Centre-Val de Loire",
        "Corse"
    ],
    "Italy": [
        "Lombardy","Lazio","Campania","Veneto","Sicily","Emilia-Romagna","Piedmont",
        "Apulia","Tuscany","Calabria","Sardinia","Liguria","Marche","Abruzzo",
        "Umbria","Basilicata","Friuli-Venezia Giulia","Trentino-South Tyrol",
        "Valle d'Aosta","Molise"
    ],
    "Spain": [
        "Madrid","Catalonia","Andalusia","Valencia","Galicia","Castile and León",
        "Basque Country","Castile-La Mancha","Canary Islands","Murcia","Aragon",
        "Extremadura","Asturias","Balearic Islands","Navarre","Cantabria","La Rioja",
        "Ceuta","Melilla"
    ],
    "Netherlands": [
        "North Holland","South Holland","Utrecht","North Brabant","Gelderland",
        "Overijssel","Groningen","Friesland","Drenthe","Flevoland","Zeeland","Limburg"
    ],
    "Egypt": [
        "Cairo","Alexandria","Giza","Qalyubia","Port Said","Suez","Luxor",
        "Dakahlia","Gharbeya","Sharkia","Menoufia","Beheira","Ismailia","Fayyum",
        "Beni Suef","Minya","Asyut","Sohag","Qena","Aswan","Red Sea","North Sinai",
        "South Sinai","Marsa Matruh","New Valley","Kafr El Sheikh","Damietta"
    ],
    "South Africa": [
        "Gauteng","KwaZulu-Natal","Western Cape","Eastern Cape","Limpopo",
        "Mpumalanga","North West","Free State","Northern Cape"
    ],
    "Nigeria": [
        "Lagos","Kano","Rivers","Oyo","Katsina","Kaduna","Anambra","Imo","Ogun",
        "Borno","Akwa Ibom","Benue","Edo","Delta","Ondo","Osun","Kwara","Enugu",
        "Plateau","Abia","Adamawa","Cross River","Bauchi","Sokoto","Taraba","Gombe",
        "Kebbi","Zamfara","Jigawa","Ekiti","Ebonyi","Nasarawa","Niger","Bayelsa","FCT"
    ],
    "Kenya": [
        "Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Kiambu","Machakos",
        "Meru","Nyeri","Kakamega","Kisii","Uasin Gishu","Trans-Nzoia","Laikipia",
        "Muranga","Embu","Bungoma","Kilifi","Kwale","Taita Taveta"
    ],
    "Sri Lanka": [
        "Western","Central","Southern","Northern","Eastern","North Western",
        "North Central","Uva","Sabaragamuwa"
    ],
    "Nepal": [
        "Bagmati","Madhesh","Gandaki","Lumbini","Karnali","Sudurpashchim","Koshi","Province No. 1"
    ],
    "Iraq": [
        "Baghdad","Basra","Nineveh","Erbil","Sulaymaniyah","Kirkuk","Najaf",
        "Karbala","Anbar","Dhi Qar","Babylon","Diyala","Maysan","Wasit",
        "Muthanna","Qadisiyyah","Saladin","Duhok"
    ],
    "Iran": [
        "Tehran","Isfahan","Khorasan Razavi","Fars","Khuzestan","East Azerbaijan",
        "Mazandaran","Kerman","Alborz","West Azerbaijan","Sistan and Baluchestan",
        "Gilan","Hormozgan","Lorestan","Hamadan","Markazi","Yazd","Kurdistan",
        "Golestan","Zanjan","Semnan","Ardabil","Qazvin","Chaharmahal and Bakhtiari",
        "North Khorasan","Qom","Kohgiluyeh and Boyer-Ahmad","South Khorasan",
        "Bushehr","Ilam"
    ],
    "Kuwait": [
        "Al Asimah","Hawalli","Farwaniya","Mubarak Al-Kabeer","Ahmadi","Jahra"
    ],
    "Bahrain": [
        "Capital","Muharraq","Northern","Southern"
    ],
    "Qatar": [
        "Doha","Al Rayyan","Al Wakrah","Al Khor","Al Shamal","Al Daayen","Umm Salal","Al Sheehaniya"
    ],
    "Oman": [
        "Muscat","Dhofar","Al Batinah North","Al Batinah South","Al Dakhiliyah",
        "Al Sharqiyah North","Al Sharqiyah South","Al Buraymi","Al Dhahirah",
        "Al Wusta","Musandam"
    ],
    "Jordan": [
        "Amman","Zarqa","Irbid","Aqaba","Balqa","Mafraq","Jerash","Ajloun",
        "Madaba","Karak","Tafilah","Maan"
    ],
}

_STATE_CITIES = {
    "Pakistan": {
        "Punjab": [
            "Lahore","Faisalabad","Rawalpindi","Gujranwala","Multan","Sialkot",
            "Bahawalpur","Sargodha","Sheikhupura","Gujrat","Kasur","Sahiwal",
            "Okara","Khanewal","Khushab","Chiniot","Bahawalnagar","Mianwali",
            "Vehari","Lodhran","Dera Ghazi Khan","Muzaffargarh","Sadiqabad",
            "Rahim Yar Khan","Wah Cantonment","Attock","Jhelum","Hafizabad",
            "Nankana Sahib","Narowal","Pakpattan","Toba Tek Singh","Bhakkar",
            "Layyah","Rajanpur","Chakwal","Mandi Bahauddin","Khairpur Tamewali",
            "Kamalia","Daska","Muridke","Wazirabad","Sambrial","Renala Khurd",
            "Jaranwala","Chichawatni","Burewala","Mailsi","Arifwala","Harappa",
            "Chunian","Phalia","Kot Addu","Khanpur","Hasilpur","Ahmadpur East",
            "Fort Abbas","Yazman","Minchinabad","Liaquatpur","Jampur","Rojhan",
            "Murree","Taxila","Hasan Abdal","Pind Dadan Khan","Talagang",
            "Kharian","Lala Musa","Kamoke","Muridke","Ferozewala","Raiwind",
            "Bhalwal","Kot Momin","Sillanwali","Shahpur","Bhera"
        ],
        "Sindh": [
            "Karachi","Hyderabad","Sukkur","Larkana","Nawabshah","Mirpur Khas",
            "Khairpur","Jacobabad","Shahdadkot","Shikarpur","Dadu","Kotri",
            "Thatta","Badin","Sanghar","Tando Adam","Tando Allah Yar",
            "Ghotki","Kashmore","Kambar","Kandhkot","Umerkot","Tharparkar",
            "Matiari","Jamshoro","Qambar","Naushahro Feroze","Shaheed Benazirabad",
            "Tando Muhammad Khan","Mithi","Diplo","Digri","Mirpur Bathoro",
            "Hala","Matli","Bulri Shah Karim","Sehwan","Mehar","Daharki",
            "Rohri","Pano Aqil","Gambat","Ratodero","Dokri","Warah"
        ],
        "Khyber Pakhtunkhwa": [
            "Peshawar","Abbottabad","Mardan","Swat","Kohat","Mansehra",
            "Haripur","Dera Ismail Khan","Nowshera","Charsadda","Bannu",
            "Malakand","Battagram","Buner","Chitral","Dir Upper","Dir Lower",
            "Hangu","Karak","Lakki Marwat","Tank","Shangla","Swabi","Torghar",
            "Mingora","Saidu Sharif","Timergara","Daggar","Alpuri","Parachinar",
            "Dera Ismail Khan City","Wana","Miranshah","Sararogha","Kulachi",
            "Takht-i-Nasrati","Dargai","Risalpur","Pabbi","Akora Khattak"
        ],
        "Balochistan": [
            "Quetta","Gwadar","Turbat","Khuzdar","Hub","Chaman","Zhob",
            "Dera Murad Jamali","Kharan","Panjgur","Mastung","Kalat",
            "Loralai","Sibi","Nushki","Washuk","Dera Allah Yar","Sui",
            "Dalbandin","Khuzdar","Bela","Pasni","Ormara","Jiwani",
            "Mand","Tump","Hoshab","Awaran","Kharan","Washuk","Naushki"
        ],
        "Islamabad Capital Territory": [
            "Islamabad","F-6","F-7","F-8","G-9","G-10","G-11","I-8","I-9",
            "Blue Area","Bahria Town","DHA Islamabad","Gulberg","Margalla Hills"
        ],
        "Azad Jammu & Kashmir": [
            "Muzaffarabad","Mirpur","Bhimber","Kotli","Rawalakot","Bagh",
            "Haveli","Neelum","Hattian","Sudhnoti","Plandri","Pallandri",
            "Jhelum Valley","Athmuqam","Chakothi","Dhirkot","Chinari"
        ],
        "Gilgit-Baltistan": [
            "Gilgit","Skardu","Chilas","Ghanche","Khaplu","Hunza","Gojal",
            "Nagar","Ghizer","Astore","Diamer","Shigar","Roundu","Dasu"
        ],
    },
    "United States": {
        "New York": ["New York City","Buffalo","Rochester","Yonkers","Syracuse","Albany","New Rochelle","Mount Vernon","Schenectady","Utica"],
        "California": ["Los Angeles","San Diego","San Jose","San Francisco","Fresno","Sacramento","Long Beach","Oakland","Bakersfield","Anaheim","Santa Ana","Riverside","Stockton","Irvine","Chula Vista"],
        "Texas": ["Houston","San Antonio","Dallas","Austin","Fort Worth","El Paso","Arlington","Corpus Christi","Plano","Laredo","Lubbock","Garland","Irving","Amarillo","Frisco"],
        "Florida": ["Jacksonville","Miami","Tampa","Orlando","St. Petersburg","Hialeah","Port St. Lucie","Tallahassee","Cape Coral","Fort Lauderdale","Pembroke Pines","Hollywood","Miramar","Gainesville","Coral Springs"],
        "Illinois": ["Chicago","Aurora","Joliet","Naperville","Rockford","Springfield","Elgin","Peoria","Champaign","Waukegan"],
        "Pennsylvania": ["Philadelphia","Pittsburgh","Allentown","Erie","Reading","Scranton","Bethlehem","Lancaster","Harrisburg","York"],
        "Ohio": ["Columbus","Cleveland","Cincinnati","Toledo","Akron","Dayton","Parma","Canton","Youngstown","Lorain"],
        "Georgia": ["Atlanta","Augusta","Columbus","Macon","Savannah","Athens","Sandy Springs","Roswell","Johns Creek","Albany"],
        "Michigan": ["Detroit","Grand Rapids","Warren","Sterling Heights","Ann Arbor","Lansing","Flint","Dearborn","Livonia","Troy"],
        "Washington": ["Seattle","Spokane","Tacoma","Vancouver","Bellevue","Kent","Everett","Renton","Kirkland","Bellingham"],
    },
    "United Kingdom": {
        "England": ["London","Birmingham","Manchester","Liverpool","Leeds","Sheffield","Bristol","Coventry","Leicester","Nottingham","Newcastle","Brighton","Hull","Plymouth","Stoke-on-Trent","Wolverhampton","Derby","Southampton","Portsmouth","York","Oxford","Cambridge","Reading","Milton Keynes","Luton","Sunderland","Middlesbrough","Preston","Blackpool","Norwich","Peterborough","Northampton","Gloucester","Exeter","Bath","Cheltenham","Bournemouth","Swindon","Warrington","Wigan","Bolton","Bradford"],
        "Scotland": ["Glasgow","Edinburgh","Aberdeen","Dundee","Inverness","Stirling","Perth","Paisley","Kilmarnock","Hamilton"],
        "Wales": ["Cardiff","Swansea","Newport","Wrexham","Barry","Neath","Cwmbran","Bridgend","Llanelli","Port Talbot"],
        "Northern Ireland": ["Belfast","Derry","Lisburn","Armagh","Newry","Omagh","Enniskillen","Ballymena","Coleraine","Bangor"],
    },
    "Canada": {
        "Ontario": ["Toronto","Ottawa","Mississauga","Brampton","Hamilton","London","Markham","Vaughan","Kitchener","Windsor","Richmond Hill","Burlington","Oakville","Oshawa","Sudbury"],
        "Quebec": ["Montreal","Quebec City","Laval","Gatineau","Longueuil","Sherbrooke","Saguenay","Trois-Rivières","Terrebonne","Saint-Jean-sur-Richelieu"],
        "British Columbia": ["Vancouver","Surrey","Burnaby","Richmond","Kelowna","Abbotsford","Coquitlam","Langley","Saanich","Delta"],
        "Alberta": ["Calgary","Edmonton","Red Deer","Lethbridge","St. Albert","Medicine Hat","Grande Prairie","Airdrie","Spruce Grove","Leduc"],
        "Manitoba": ["Winnipeg","Brandon","Steinbach","Thompson","Portage la Prairie"],
        "Saskatchewan": ["Saskatoon","Regina","Prince Albert","Moose Jaw","Swift Current"],
        "Nova Scotia": ["Halifax","Cape Breton","Truro","New Glasgow","Kentville"],
        "New Brunswick": ["Moncton","Saint John","Fredericton","Miramichi","Bathurst"],
    },
    "Australia": {
        "New South Wales": ["Sydney","Newcastle","Wollongong","Canberra","Central Coast","Albury","Wagga Wagga","Maitland","Orange","Dubbo","Tamworth","Lismore","Bathurst","Port Macquarie","Coffs Harbour"],
        "Victoria": ["Melbourne","Geelong","Ballarat","Bendigo","Shepparton","Latrobe","Wodonga","Mildura","Traralgon","Warnambool"],
        "Queensland": ["Brisbane","Gold Coast","Sunshine Coast","Townsville","Cairns","Toowoomba","Mackay","Rockhampton","Bundaberg","Hervey Bay"],
        "Western Australia": ["Perth","Bunbury","Geraldton","Albany","Kalgoorlie","Mandurah","Broome","Fremantle"],
        "South Australia": ["Adelaide","Mount Gambier","Whyalla","Murray Bridge","Port Augusta"],
        "Tasmania": ["Hobart","Launceston","Devonport","Burnie"],
    },
    "India": {
        "Maharashtra": ["Mumbai","Pune","Nagpur","Nashik","Aurangabad","Solapur","Kolhapur","Amravati","Nanded","Akola"],
        "Delhi": ["New Delhi","North Delhi","South Delhi","East Delhi","West Delhi","Central Delhi","North East Delhi","North West Delhi","South West Delhi","Dwarka","Noida Extension"],
        "Karnataka": ["Bangalore","Mysore","Hubli","Mangalore","Belgaum","Dharwad","Shimoga","Tumkur","Gulbarga","Davanagere"],
        "Tamil Nadu": ["Chennai","Coimbatore","Madurai","Tiruchirappalli","Salem","Tirunelveli","Tiruppur","Erode","Vellore","Thanjavur"],
        "Gujarat": ["Ahmedabad","Surat","Vadodara","Rajkot","Bhavnagar","Jamnagar","Junagadh","Gandhinagar","Anand","Bharuch"],
        "Uttar Pradesh": ["Lucknow","Kanpur","Agra","Varanasi","Allahabad","Ghaziabad","Noida","Meerut","Aligarh","Moradabad"],
        "West Bengal": ["Kolkata","Asansol","Siliguri","Durgapur","Bardhaman","Malda","Baharampur","Habra","Kharagpur","Shantipur"],
        "Rajasthan": ["Jaipur","Jodhpur","Kota","Bikaner","Ajmer","Udaipur","Bhilwara","Alwar","Bharatpur","Sikar"],
    },
    "United Arab Emirates": {
        "Dubai": ["Dubai","Jebel Ali","Deira","Bur Dubai","Jumeirah","Business Bay","Al Qusais","Karama","Satwa"],
        "Abu Dhabi": ["Abu Dhabi","Al Ain","Ruwais","Madinat Zayed","Bida Zayed"],
        "Sharjah": ["Sharjah","Khor Fakkan","Kalba","Dhaid"],
        "Ajman": ["Ajman"],
        "Ras Al Khaimah": ["Ras Al Khaimah","Al Nakheel","Al Hamra"],
        "Fujairah": ["Fujairah","Dibba Al-Fujairah"],
        "Umm Al Quwain": ["Umm Al Quwain"],
    },
}


@frappe.whitelist(allow_guest=True)
def get_states(country):
    """Return states/provinces for a country.
    Queries the State or Province doctype first; falls back to hardcoded dict."""
    try:
        rows = frappe.get_all(
            "State or Province",
            filters={"country": country, "is_active": 1},
            fields=["state_name"],
            order_by="state_name asc",
        )
        if rows:
            return [r.state_name for r in rows]
    except Exception:
        pass
    return _STATES.get(country, [])


# ─── PORTAL/DESK: Cities by country ────────────────────────────────────────

_CITIES = {
    "Pakistan": ["Karachi","Lahore","Islamabad","Rawalpindi","Faisalabad","Multan","Hyderabad","Peshawar","Quetta","Sialkot","Gujranwala","Sargodha","Bahawalpur","Sukkur","Rahim Yar Khan","Sheikhupura","Larkana","Gujrat","Kasur","Mardan","Nawabshah","Dera Ghazi Khan","Sahiwal","Okara","Abbottabad","Muzaffarabad","Haripur","Mansehra","Attock","Khanewal","Kohat","Jhelum","Sadiqabad","Muzaffargarh","Bahawalnagar","Mianwali","Vehari","Lodhran","Khushab","Chiniot","Wah Cantonment","Dera Ismail Khan"],
    "United States": ["New York","Los Angeles","Chicago","Houston","Phoenix","Philadelphia","San Antonio","San Diego","Dallas","San Jose","Austin","Jacksonville","Fort Worth","Columbus","Charlotte","Indianapolis","San Francisco","Seattle","Denver","Nashville","Oklahoma City","El Paso","Washington DC","Boston","Portland","Las Vegas","Memphis","Louisville","Baltimore","Milwaukee","Albuquerque","Tucson","Fresno","Mesa","Sacramento","Kansas City","Atlanta","Omaha","Colorado Springs","Raleigh","Miami","Cleveland","Minneapolis","Tampa","New Orleans","Pittsburgh","Anchorage","Orlando","Cincinnati","St. Louis","Buffalo","Richmond","Boise","Spokane","Des Moines","Salt Lake City","Hartford","Birmingham","Grand Rapids","Huntsville","Tucson","Aurora","Bakersfield","Anaheim","Riverside","Santa Ana","Corpus Christi","Lexington","Henderson","Stockton","Greensboro","Newark","Plano","Chandler","Fort Wayne","St. Petersburg","Laredo","Madison","Durham","Lubbock","Winston-Salem","Garland","Glendale","Hialeah","Reno","Baton Rouge","Irvine","Chesapeake","Scottsdale","Fremont","Gilbert","San Bernardino"],
    "United Kingdom": ["London","Birmingham","Manchester","Glasgow","Liverpool","Leeds","Sheffield","Edinburgh","Bristol","Cardiff","Coventry","Belfast","Leicester","Nottingham","Newcastle","Brighton","Hull","Plymouth","Stoke-on-Trent","Wolverhampton","Derby","Swansea","Southampton","Aberdeen","Portsmouth","York","Oxford","Cambridge","Reading","Milton Keynes","Luton","Sunderland","Dundee","Middlesbrough","Preston","Blackpool","Norwich","Peterborough","Northampton","Gloucester","Exeter","Bath","Cheltenham","Bournemouth","Swindon","Warrington","Wigan","Bolton","Bradford"],
    "United Arab Emirates": ["Dubai","Abu Dhabi","Sharjah","Al Ain","Ajman","Ras Al Khaimah","Fujairah","Umm Al Quwain","Khor Fakkan","Kalba","Jebel Ali","Dhaid","Madinat Zayed","Ruwais"],
    "Saudi Arabia": ["Riyadh","Jeddah","Mecca","Medina","Dammam","Khobar","Taif","Tabuk","Buraydah","Abha","Jubail","Hafar Al-Batin","Najran","Yanbu","Al Hasa","Al Qatif","Hail","Al Kharj","Jazan","Arar","Sakaka","Al Jubail"],
    "Canada": ["Toronto","Montreal","Vancouver","Calgary","Edmonton","Ottawa","Winnipeg","Quebec City","Hamilton","Kitchener","London","Victoria","Halifax","Oshawa","Windsor","Saskatoon","Regina","St. Catharines","Kelowna","Barrie","Abbotsford","Sudbury","Kingston","Sherbrooke","Guelph","Moncton","Brantford","Thunder Bay","Nanaimo","Kamloops","Lethbridge","Red Deer","Burlington","Burnaby","Surrey","Richmond"],
    "Australia": ["Sydney","Melbourne","Brisbane","Perth","Adelaide","Gold Coast","Canberra","Newcastle","Wollongong","Sunshine Coast","Geelong","Townsville","Cairns","Darwin","Toowoomba","Ballarat","Bendigo","Launceston","Mackay","Rockhampton","Bunbury","Hobart","Albury","Mildura"],
    "Germany": ["Berlin","Hamburg","Munich","Cologne","Frankfurt","Stuttgart","Düsseldorf","Leipzig","Dortmund","Essen","Bremen","Dresden","Hanover","Nuremberg","Duisburg","Bochum","Wuppertal","Bielefeld","Bonn","Münster","Karlsruhe","Mannheim","Augsburg","Wiesbaden","Gelsenkirchen","Braunschweig","Kiel","Aachen","Chemnitz","Halle","Magdeburg","Krefeld","Freiburg","Lübeck","Oberhausen","Erfurt","Mainz","Rostock","Kassel"],
    "France": ["Paris","Marseille","Lyon","Toulouse","Nice","Nantes","Montpellier","Strasbourg","Bordeaux","Lille","Rennes","Reims","Le Havre","Saint-Étienne","Toulon","Grenoble","Dijon","Angers","Nîmes","Le Mans","Aix-en-Provence","Clermont-Ferrand","Brest","Tours","Limoges","Amiens","Perpignan","Metz","Besançon","Orléans","Mulhouse","Rouen","Caen","Nancy"],
    "Netherlands": ["Amsterdam","Rotterdam","The Hague","Utrecht","Eindhoven","Tilburg","Groningen","Almere","Breda","Nijmegen","Enschede","Haarlem","Arnhem","Zaanstad","Amersfoort","Apeldoorn","s-Hertogenbosch","Dordrecht","Leiden","Zoetermeer","Zwolle","Maastricht","Alkmaar","Delft","Leeuwarden"],
    "Italy": ["Rome","Milan","Naples","Turin","Palermo","Genoa","Bologna","Florence","Bari","Catania","Venice","Verona","Messina","Padua","Trieste","Taranto","Brescia","Parma","Prato","Modena","Reggio Calabria","Reggio Emilia","Perugia","Livorno","Ravenna","Cagliari","Foggia","Rimini","Salerno","Ferrara"],
    "Spain": ["Madrid","Barcelona","Valencia","Seville","Zaragoza","Málaga","Murcia","Palma","Las Palmas","Bilbao","Alicante","Córdoba","Valladolid","Vigo","Gijón","A Coruña","Granada","Vitoria","Elche","Oviedo","Badalona","Cartagena","Terrassa","Jerez","Sabadell","Santa Cruz de Tenerife","Pamplona","Almería"],
    "China": ["Shanghai","Beijing","Guangzhou","Shenzhen","Tianjin","Chengdu","Chongqing","Wuhan","Xi'an","Hangzhou","Shenyang","Harbin","Nanjing","Jinan","Changchun","Zhengzhou","Hefei","Kunming","Fuzhou","Dalian","Qingdao","Nanchang","Changsha","Urumqi","Guiyang","Lanzhou","Nanning","Taiyuan","Hohhot","Shijiazhuang","Wenzhou","Ningbo","Suzhou"],
    "India": ["Mumbai","Delhi","Bangalore","Hyderabad","Ahmedabad","Chennai","Kolkata","Pune","Jaipur","Surat","Lucknow","Kanpur","Nagpur","Indore","Thane","Bhopal","Visakhapatnam","Patna","Vadodara","Ghaziabad","Ludhiana","Agra","Nashik","Faridabad","Meerut","Rajkot","Varanasi","Srinagar","Aurangabad","Amritsar","Allahabad","Ranchi","Howrah","Coimbatore","Jabalpur","Gwalior","Vijayawada","Jodhpur","Madurai","Raipur","Kota","Chandigarh","Guwahati","Solapur","Hubli","Bareilly","Mysore","Moradabad","Gurgaon","Aligarh","Jalandhar","Thiruvananthapuram","Bhiwandi","Kochi","Noida"],
    "Bangladesh": ["Dhaka","Chittagong","Sylhet","Rajshahi","Khulna","Comilla","Mymensingh","Narayanganj","Gazipur","Rangpur","Barisal","Bogra","Jessore","Tangail","Dinajpur","Cox's Bazar","Faridpur","Noakhali"],
    "Turkey": ["Istanbul","Ankara","Izmir","Bursa","Antalya","Adana","Gaziantep","Konya","Mersin","Kayseri","Eskişehir","Diyarbakır","Samsun","Denizli","Şanlıurfa","Trabzon","Kocaeli","Malatya","Erzurum","Van","Batman","Elazığ","Sivas","Kahramanmaraş","Ordu","Manisa"],
    "Egypt": ["Cairo","Alexandria","Giza","Shubra El-Kheima","Port Said","Suez","Luxor","Mansoura","El-Mahalla El-Kubra","Tanta","Asyut","Ismailia","Fayyum","Zagazig","Aswan","Damietta","Damanhur","Al-Minya","Beni Suef","Hurghada","Qena","Sohag"],
    "South Africa": ["Johannesburg","Cape Town","Durban","Pretoria","Port Elizabeth","Bloemfontein","East London","Nelspruit","Kimberley","Polokwane","Rustenburg","George","Pietermaritzburg","Vanderbijlpark","Vereeniging","Welkom","Newcastle","Boksburg"],
    "Nigeria": ["Lagos","Abuja","Kano","Ibadan","Kaduna","Port Harcourt","Benin City","Maiduguri","Zaria","Aba","Jos","Ilorin","Oyo","Enugu","Abeokuta","Onitsha","Warri","Calabar","Uyo","Katsina","Akure","Bauchi","Sokoto","Owerri","Gombe","Yola","Minna","Makurdi"],
    "Kenya": ["Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Thika","Malindi","Kitale","Garissa","Kakamega","Nyeri","Meru","Ruiru","Kisii","Embu","Nanyuki"],
    "Malaysia": ["Kuala Lumpur","Johor Bahru","Ipoh","Shah Alam","Petaling Jaya","George Town","Subang Jaya","Malacca","Kuching","Kota Kinabalu","Seremban","Klang","Kota Bharu","Kuala Terengganu","Alor Setar","Miri","Sibu","Batu Pahat","Taiping"],
    "Singapore": ["Singapore","Jurong","Woodlands","Tampines","Ang Mo Kio","Bedok","Yishun","Toa Payoh","Hougang","Geylang","Bukit Batok","Sengkang","Punggol","Choa Chu Kang"],
    "Japan": ["Tokyo","Yokohama","Osaka","Nagoya","Sapporo","Fukuoka","Kobe","Kyoto","Kawasaki","Saitama","Hiroshima","Sendai","Kitakyushu","Chiba","Sakai","Kumamoto","Okayama","Sagamihara","Hamamatsu","Niigata","Shizuoka","Utsunomiya","Matsuyama","Kagoshima","Kanazawa","Oita","Nagasaki","Toyama","Naha"],
    "South Korea": ["Seoul","Busan","Incheon","Daegu","Daejeon","Gwangju","Suwon","Ulsan","Changwon","Goyang","Yongin","Seongnam","Bucheon","Cheongju","Jeonju","Ansan","Cheonan","Hwaseong","Jeju","Pohang","Gimhae"],
    "Thailand": ["Bangkok","Chiang Mai","Chiang Rai","Nakhon Ratchasima","Khon Kaen","Hat Yai","Udon Thani","Pak Kret","Surat Thani","Ubon Ratchathani","Nonthaburi","Pattaya","Nakhon Sawan","Rayong","Phuket","Chonburi"],
    "Indonesia": ["Jakarta","Surabaya","Bandung","Bekasi","Medan","Tangerang","Depok","Semarang","Palembang","Makassar","Batam","Pekanbaru","Bogor","Bandar Lampung","Padang","Malang","Samarinda","Tasikmalaya","Pontianak","Balikpapan","Manado","Denpasar","Banjarmasin","Serang","Jambi"],
    "Philippines": ["Manila","Quezon City","Davao","Caloocan","Cebu City","Zamboanga","Taguig","Antipolo","Pasig","Cagayan de Oro","Parañaque","Dasmarinas","Valenzuela","Bacoor","General Santos","Las Piñas","Makati","Bacolod","Marikina","Muntinlupa","Mandaluyong","Iloilo City","Baguio","Pasay","Butuan","Lapu-Lapu","Calamba"],
    "Sri Lanka": ["Colombo","Kandy","Galle","Jaffna","Negombo","Batticaloa","Trincomalee","Matara","Ratnapura","Badulla","Anuradhapura","Polonnaruwa","Kurunegala","Puttalam","Kalmunai"],
    "Nepal": ["Kathmandu","Pokhara","Lalitpur","Bhaktapur","Biratnagar","Birgunj","Bharatpur","Janakpur","Hetauda","Butwal","Dharan","Siddharthanagar"],
    "Afghanistan": ["Kabul","Kandahar","Herat","Mazar-i-Sharif","Kunduz","Jalalabad","Ghazni","Balkh","Baghlan","Lashkar Gah","Taloqan","Pul-e-Khumri"],
    "Iraq": ["Baghdad","Basra","Mosul","Erbil","Najaf","Karbala","Kirkuk","Sulaymaniyah","Fallujah","Tikrit","Ramadi","Baqubah","Samawah","Nassiriya"],
    "Iran": ["Tehran","Mashhad","Isfahan","Shiraz","Tabriz","Ahvaz","Qom","Kermanshah","Urmia","Zahedan","Rasht","Hamadan","Kerman","Yazd","Ardabil","Bandar Abbas","Qazvin","Zanjan","Sanandaj","Khorramabad"],
    "Kuwait": ["Kuwait City","Hawalli","Salmiya","Farwaniya","Al Ahmadi","Al Jahra","Sabah Al Salem","Mangaf","Fahaheel"],
    "Bahrain": ["Manama","Riffa","Muharraq","Hamad Town","A'ali","Isa Town","Sitra","Budaiya","Jidhafs"],
    "Qatar": ["Doha","Al Wakrah","Al Khor","Al Rayyan","Umm Salal","Al Shamal","Mesaieed"],
    "Oman": ["Muscat","Salalah","Sohar","Nizwa","Sur","Ibri","Barka","Rustaq","Bahla","Ibra"],
    "Jordan": ["Amman","Zarqa","Irbid","Aqaba","Al-Salt","Russeifa","Mafraq","Madaba","Al-Karak","Jerash"],
    "Lebanon": ["Beirut","Tripoli","Sidon","Tyre","Nabatieh","Jounieh","Zahle","Baalbek","Byblos","Aley"],
}

# Postal / ZIP codes keyed by country → city name
_CITY_POSTAL_CODES = {
    "Pakistan": {
        # Punjab
        "Lahore":"54000","Faisalabad":"38000","Rawalpindi":"46000","Gujranwala":"52250",
        "Multan":"60000","Sialkot":"51310","Bahawalpur":"63100","Sargodha":"40100",
        "Sheikhupura":"39350","Gujrat":"50700","Kasur":"55050","Sahiwal":"57000",
        "Okara":"56300","Khanewal":"58150","Khushab":"41350","Chiniot":"35400",
        "Bahawalnagar":"62300","Mianwali":"42200","Vehari":"59050","Lodhran":"59200",
        "Dera Ghazi Khan":"32200","Muzaffargarh":"34200","Sadiqabad":"64350",
        "Rahim Yar Khan":"64200","Wah Cantonment":"47040","Attock":"43600",
        "Jhelum":"49600","Hafizabad":"52800","Nankana Sahib":"39100","Narowal":"51600",
        "Pakpattan":"57400","Toba Tek Singh":"36050","Bhakkar":"30000","Layyah":"31200",
        "Rajanpur":"33350","Chakwal":"48800","Mandi Bahauddin":"50400","Kamalia":"36350",
        "Daska":"51020","Muridke":"39100","Wazirabad":"52000","Jaranwala":"37200",
        "Chichawatni":"57100","Burewala":"61010","Mailsi":"59800","Arifwala":"57450",
        "Taxila":"47080","Hasan Abdal":"43320","Kharian":"50800","Lala Musa":"50660",
        "Kamoke":"39100","Ferozewala":"39250","Raiwind":"54770","Bhalwal":"40550",
        "Renala Khurd":"55030","Phalia":"50400","Sambrial":"51040","Harappa":"57400",
        "Chunian":"55300","Kot Addu":"32200","Khanpur":"64150","Hasilpur":"63350",
        "Ahmadpur East":"63350","Fort Abbas":"62400","Yazman":"63100",
        "Minchinabad":"62400","Liaquatpur":"64450","Jampur":"32800","Rojhan":"33200",
        "Murree":"47150","Pind Dadan Khan":"49760","Talagang":"48030",
        "Sillanwali":"40600","Shahpur":"40100","Bhera":"40100","Kot Momin":"40450",
        # Sindh
        "Karachi":"74000","Hyderabad":"71000","Sukkur":"65200","Larkana":"77150",
        "Nawabshah":"67450","Mirpur Khas":"69000","Khairpur":"66020",
        "Jacobabad":"79000","Shahdadkot":"77700","Shikarpur":"78100","Dadu":"76100",
        "Kotri":"71000","Thatta":"71600","Badin":"71900","Sanghar":"70060",
        "Tando Adam":"70230","Tando Allah Yar":"70060","Ghotki":"65050",
        "Kashmore":"79020","Kambar":"76600","Kandhkot":"79020","Umerkot":"69540",
        "Matiari":"72500","Jamshoro":"76090","Naushahro Feroze":"67400",
        "Shaheed Benazirabad":"67450","Tando Muhammad Khan":"70030","Mithi":"99040",
        "Hala":"72300","Matli":"73200","Sehwan":"76020","Mehar":"76350",
        "Daharki":"65060","Rohri":"65300","Pano Aqil":"65050","Gambat":"66020",
        "Ratodero":"77040","Warah":"76400",
        # Khyber Pakhtunkhwa
        "Peshawar":"25000","Abbottabad":"22010","Mardan":"23200","Swat":"19200",
        "Kohat":"26000","Mansehra":"21300","Haripur":"22620",
        "Dera Ismail Khan":"29050","Dera Ismail Khan City":"29050",
        "Nowshera":"24100","Charsadda":"24420","Bannu":"28100","Battagram":"21600",
        "Chitral":"17200","Dir Upper":"18000","Dir Lower":"18200","Hangu":"25300",
        "Karak":"27200","Lakki Marwat":"28420","Tank":"26500","Shangla":"19300",
        "Swabi":"23430","Mingora":"19200","Saidu Sharif":"19100","Timergara":"18200",
        "Daggar":"19200","Alpuri":"19300","Parachinar":"25050","Wana":"29500",
        "Miranshah":"28700","Dargai":"23080","Risalpur":"24090","Pabbi":"24100",
        "Akora Khattak":"24110",
        # Balochistan
        "Quetta":"87300","Gwadar":"92600","Turbat":"92100","Khuzdar":"89100",
        "Hub":"89100","Chaman":"83600","Zhob":"85200","Dera Murad Jamali":"77300",
        "Kharan":"89100","Panjgur":"89600","Mastung":"87750","Kalat":"88000",
        "Loralai":"84800","Sibi":"85100","Nushki":"87450","Sui":"86100",
        "Dalbandin":"89200","Bela":"90100","Pasni":"92300","Ormara":"92400",
        "Jiwani":"92700","Washuk":"89100","Dera Allah Yar":"77300",
        # Islamabad Capital Territory
        "Islamabad":"44000","Blue Area":"44000","Bahria Town":"46000",
        "DHA Islamabad":"44000",
        # Azad Jammu & Kashmir
        "Muzaffarabad":"13100","Mirpur":"10250","Bhimber":"10300","Kotli":"11100",
        "Rawalakot":"12000","Bagh":"12500","Hattian":"13150","Plandri":"12400",
        "Pallandri":"12400","Athmuqam":"13200","Neelum":"13200",
        # Gilgit-Baltistan
        "Gilgit":"15100","Skardu":"16100","Chilas":"14100","Ghanche":"16200",
        "Khaplu":"16200","Hunza":"15000","Nagar":"15100","Ghizer":"15700",
        "Astore":"16300","Roundu":"16000","Dasu":"14100",
    },
    "United States": {
        "New York City":"10001","Los Angeles":"90001","Chicago":"60601",
        "Houston":"77001","Phoenix":"85001","Philadelphia":"19101",
        "San Antonio":"78201","San Diego":"92101","Dallas":"75201",
        "San Jose":"95101","Austin":"78701","Jacksonville":"32099",
        "Fort Worth":"76101","Columbus":"43085","Charlotte":"28201",
        "Indianapolis":"46201","San Francisco":"94102","Seattle":"98101",
        "Denver":"80201","Nashville":"37201","Oklahoma City":"73101",
        "El Paso":"79901","Washington DC":"20001","Boston":"02101",
        "Portland":"97201","Las Vegas":"89101","Memphis":"38101",
        "Louisville":"40201","Baltimore":"21201","Milwaukee":"53201",
        "Albuquerque":"87101","Tucson":"85701","Fresno":"93701",
        "Sacramento":"94201","Kansas City":"64101","Atlanta":"30301",
        "Omaha":"68101","Colorado Springs":"80901","Raleigh":"27601",
        "Miami":"33101","Cleveland":"44101","Minneapolis":"55401",
        "Tampa":"33601","New Orleans":"70112","Pittsburgh":"15201",
        "Orlando":"32801","Cincinnati":"45201","St. Louis":"63101",
        "Buffalo":"14201","Rochester":"14601","Yonkers":"10701",
        "Syracuse":"13201","Albany":"12201","Richmond":"23219",
        "Boise":"83701","Spokane":"99201","Salt Lake City":"84101",
        "Hartford":"06101","Birmingham":"35201","Grand Rapids":"49501",
        "Huntsville":"35801","Aurora":"80010","Bakersfield":"93301",
        "Anaheim":"92801","Riverside":"92501","Santa Ana":"92701",
        "Corpus Christi":"78401","Lexington":"40501","Henderson":"89002",
        "Stockton":"95201","Greensboro":"27401","Plano":"75023",
        "Fort Wayne":"46801","St. Petersburg":"33701","Laredo":"78040",
        "Madison":"53701","Durham":"27701","Lubbock":"79401",
        "Winston-Salem":"27101","Garland":"75040","Glendale":"85301",
        "Hialeah":"33010","Reno":"89501","Baton Rouge":"70801",
        "Irvine":"92601","Chesapeake":"23320","Scottsdale":"85251",
        "Fremont":"94538","Gilbert":"85233","San Bernardino":"92401",
        "Long Beach":"90801","Oakland":"94601","New Rochelle":"10801",
        "Mount Vernon":"10550","Schenectady":"12301","Utica":"13501",
    },
    "United Kingdom": {
        "London":"EC1A 1BB","Birmingham":"B1 1BB","Manchester":"M1 1AE",
        "Liverpool":"L1 0AA","Leeds":"LS1 1BA","Sheffield":"S1 1DA",
        "Bristol":"BS1 1AA","Coventry":"CV1 1AA","Leicester":"LE1 1AA",
        "Nottingham":"NG1 1AA","Newcastle":"NE1 1SE","Brighton":"BN1 1AE",
        "Hull":"HU1 1AB","Plymouth":"PL1 1AB","Southampton":"SO14 0AA",
        "Portsmouth":"PO1 1AA","York":"YO1 7AA","Oxford":"OX1 1AA",
        "Cambridge":"CB1 1AA","Reading":"RG1 1AA","Milton Keynes":"MK9 1AA",
        "Glasgow":"G1 1AA","Edinburgh":"EH1 1AA","Aberdeen":"AB10 1AA",
        "Dundee":"DD1 1AA","Cardiff":"CF10 1AA","Swansea":"SA1 1AA",
        "Newport":"NP20 1AA","Belfast":"BT1 1AA","Derry":"BT48 6AA",
        "Inverness":"IV1 1AA","Stirling":"FK8 1AA","Luton":"LU1 1AA",
        "Sunderland":"SR1 1AA","Middlesbrough":"TS1 1AA","Preston":"PR1 1AA",
        "Blackpool":"FY1 1AA","Norwich":"NR1 1AA","Peterborough":"PE1 1AA",
        "Northampton":"NN1 1AA","Exeter":"EX1 1AA","Bath":"BA1 1AA",
        "Bournemouth":"BH1 1AA","Bradford":"BD1 1AA","Bolton":"BL1 1AA",
    },
    "United Arab Emirates": {
        "Dubai":"00000","Abu Dhabi":"00000","Sharjah":"00000","Al Ain":"00000",
        "Ajman":"00000","Ras Al Khaimah":"00000","Fujairah":"00000",
        "Umm Al Quwain":"00000","Khor Fakkan":"00000","Kalba":"00000",
        "Jebel Ali":"00000","Deira":"00000","Bur Dubai":"00000",
    },
    "Saudi Arabia": {
        "Riyadh":"11564","Jeddah":"21589","Mecca":"24231","Medina":"42312",
        "Dammam":"32424","Khobar":"31952","Tabuk":"71491","Taif":"21944",
        "Buraydah":"51452","Abha":"61413","Jubail":"31951","Najran":"66251",
        "Yanbu":"41912","Hail":"55425","Arar":"91431","Jazan":"45142",
        "Al Hasa":"31982","Al Kharj":"11942","Hafar Al-Batin":"31991",
        "Al Qatif":"31911","Al Jubail":"31951","Sakaka":"72321",
    },
    "Canada": {
        "Toronto":"M5H 2N2","Montreal":"H2Y 1C6","Vancouver":"V6B 4N6",
        "Calgary":"T2P 5C5","Edmonton":"T5J 3N4","Ottawa":"K1A 0A6",
        "Winnipeg":"R3C 0T4","Quebec City":"G1R 4S9","Hamilton":"L8P 3B6",
        "Kitchener":"N2G 4L2","London":"N6A 1M8","Halifax":"B3H 3J5",
        "Victoria":"V8W 1Z1","Oshawa":"L1H 1A7","Windsor":"N8X 1G7",
        "Saskatoon":"S7K 0J5","Regina":"S4P 4B3","Burnaby":"V5H 4M2",
        "Surrey":"V3T 1V8","Richmond":"V6X 1X5","Laval":"H7A 1A1",
        "Mississauga":"L5A 1E9","Brampton":"L6Y 1G8","Markham":"L3P 7P3",
        "Vaughan":"L4H 3A8","Longueuil":"J4H 2B8","Gatineau":"J8P 1H3",
        "Sherbrooke":"J1H 1A1","Kelowna":"V1Y 6S4","Abbotsford":"V2S 6N6",
        "Lethbridge":"T1J 3L4","Red Deer":"T4N 1L9","Airdrie":"T4B 2C9",
    },
    "Australia": {
        "Sydney":"2000","Melbourne":"3000","Brisbane":"4000","Perth":"6000",
        "Adelaide":"5000","Gold Coast":"4217","Canberra":"2600",
        "Newcastle":"2300","Wollongong":"2500","Geelong":"3220",
        "Townsville":"4810","Cairns":"4870","Hobart":"7000","Darwin":"0800",
        "Toowoomba":"4350","Ballarat":"3350","Bendigo":"3550",
        "Launceston":"7250","Mackay":"4740","Rockhampton":"4700",
        "Bunbury":"6230","Mandurah":"6210","Fremantle":"6160",
        "Albury":"2640","Wagga Wagga":"2650","Dubbo":"2830",
    },
    "Germany": {
        "Berlin":"10115","Hamburg":"20095","Munich":"80331","Cologne":"50667",
        "Frankfurt":"60306","Stuttgart":"70173","Düsseldorf":"40213",
        "Leipzig":"04109","Dortmund":"44135","Essen":"45127","Bremen":"28195",
        "Dresden":"01067","Hanover":"30159","Nuremberg":"90402",
        "Duisburg":"47051","Bochum":"44787","Wuppertal":"42103",
        "Bielefeld":"33602","Bonn":"53111","Münster":"48143",
        "Karlsruhe":"76131","Mannheim":"68161","Augsburg":"86150",
        "Wiesbaden":"65185","Erfurt":"99084","Rostock":"18055",
        "Kassel":"34117","Freiburg":"79098","Mainz":"55116",
        "Aachen":"52062","Kiel":"24103","Chemnitz":"09111",
    },
    "France": {
        "Paris":"75001","Marseille":"13001","Lyon":"69001","Toulouse":"31000",
        "Nice":"06000","Nantes":"44000","Montpellier":"34000",
        "Strasbourg":"67000","Bordeaux":"33000","Lille":"59000",
        "Rennes":"35000","Reims":"51100","Le Havre":"76600",
        "Saint-Étienne":"42000","Toulon":"83000","Grenoble":"38000",
        "Dijon":"21000","Angers":"49000","Nîmes":"30000",
        "Aix-en-Provence":"13100","Clermont-Ferrand":"63000","Brest":"29200",
        "Tours":"37000","Limoges":"87000","Amiens":"80000",
        "Perpignan":"66000","Metz":"57000","Besançon":"25000",
        "Orléans":"45000","Mulhouse":"68100","Rouen":"76000","Caen":"14000",
    },
    "Netherlands": {
        "Amsterdam":"1011 AB","Rotterdam":"3011 AD","The Hague":"2511 DM",
        "Utrecht":"3511 CE","Eindhoven":"5611 AJ","Tilburg":"5037 DB",
        "Groningen":"9711 GG","Almere":"1315 HB","Breda":"4811 XD",
        "Nijmegen":"6511 PN","Haarlem":"2011 RH","Arnhem":"6811 LD",
        "Maastricht":"6211 CR","Leiden":"2312 DJ","Zaanstad":"1506 LG",
        "Amersfoort":"3811 AP","Apeldoorn":"7311 GN","Dordrecht":"3311 GS",
        "Zwolle":"8011 AB","Delft":"2611 GL","Leeuwarden":"8911 AK",
    },
    "Italy": {
        "Rome":"00187","Milan":"20121","Naples":"80134","Turin":"10121",
        "Palermo":"90133","Genoa":"16121","Bologna":"40121","Florence":"50123",
        "Bari":"70121","Venice":"30124","Verona":"37121","Padua":"35121",
        "Trieste":"34121","Catania":"95131","Brescia":"25121","Parma":"43121",
        "Prato":"59100","Modena":"41121","Salerno":"84123","Cagliari":"09124",
        "Taranto":"74121","Perugia":"06121","Livorno":"57123","Ferrara":"44121",
    },
    "Spain": {
        "Madrid":"28001","Barcelona":"08001","Valencia":"46001","Seville":"41001",
        "Zaragoza":"50001","Málaga":"29001","Murcia":"30001","Palma":"07001",
        "Las Palmas":"35001","Bilbao":"48001","Alicante":"03001","Córdoba":"14001",
        "Valladolid":"47001","Vigo":"36201","Granada":"18001","Vitoria":"01001",
        "Oviedo":"33001","Pamplona":"31001","Almería":"04001",
        "Santa Cruz de Tenerife":"38001","Gijón":"33201","A Coruña":"15001",
        "Cartagena":"30201","Terrassa":"08221","Jerez":"11401","Sabadell":"08201",
        "Elche":"03201","Badalona":"08911",
    },
    "India": {
        "Mumbai":"400001","Delhi":"110001","Bangalore":"560001",
        "Hyderabad":"500001","Ahmedabad":"380001","Chennai":"600001",
        "Kolkata":"700001","Pune":"411001","Jaipur":"302001","Surat":"395001",
        "Lucknow":"226001","Kanpur":"208001","Nagpur":"440001",
        "Indore":"452001","Bhopal":"462001","Visakhapatnam":"530001",
        "Patna":"800001","Vadodara":"390001","Ghaziabad":"201001",
        "Ludhiana":"141001","Agra":"282001","Nashik":"422001",
        "Faridabad":"121001","Meerut":"250001","Rajkot":"360001",
        "Varanasi":"221001","Aurangabad":"431001","Amritsar":"143001",
        "Ranchi":"834001","Allahabad":"211001","Howrah":"711101",
        "Coimbatore":"641001","Gwalior":"474001","Jodhpur":"342001",
        "Madurai":"625001","Kota":"324001","Chandigarh":"160001",
        "Gurgaon":"122001","Noida":"201301","New Delhi":"110001",
        "Thiruvananthapuram":"695001","Kochi":"682001","Jabalpur":"482001",
        "Vijayawada":"520001","Mysore":"570001","Hubli":"580020",
    },
    "China": {
        "Beijing":"100000","Shanghai":"200000","Guangzhou":"510000",
        "Shenzhen":"518000","Tianjin":"300000","Chengdu":"610000",
        "Chongqing":"400000","Wuhan":"430000","Xi'an":"710000",
        "Hangzhou":"310000","Nanjing":"210000","Harbin":"150000",
        "Shenyang":"110000","Qingdao":"266000","Dalian":"116000",
        "Suzhou":"215000","Ningbo":"315000","Zhengzhou":"450000",
        "Kunming":"650000","Fuzhou":"350000","Changsha":"410000",
        "Jinan":"250000","Hefei":"230000","Guiyang":"550000",
        "Lanzhou":"730000","Nanning":"530000","Taiyuan":"030000",
    },
    "Japan": {
        "Tokyo":"100-0001","Yokohama":"231-0023","Osaka":"530-0001",
        "Nagoya":"460-0001","Sapporo":"060-0001","Fukuoka":"810-0001",
        "Kobe":"650-0001","Kyoto":"600-8001","Kawasaki":"210-0001",
        "Sendai":"980-0811","Hiroshima":"730-0011","Saitama":"330-0843",
        "Chiba":"260-0013","Kumamoto":"860-0001","Okayama":"700-0901",
        "Kagoshima":"890-0001","Kanazawa":"920-0001","Niigata":"950-0001",
        "Oita":"870-0001","Nagasaki":"850-0001","Naha":"900-0001",
    },
    "South Korea": {
        "Seoul":"04524","Busan":"48933","Incheon":"22364","Daegu":"41911",
        "Daejeon":"35208","Gwangju":"61633","Suwon":"16488","Ulsan":"44675",
        "Changwon":"51442","Goyang":"10101","Jeju":"63154","Pohang":"37601",
        "Gimhae":"50801","Jeonju":"54994","Cheongju":"28644",
    },
    "Bangladesh": {
        "Dhaka":"1000","Chittagong":"4000","Sylhet":"3100","Rajshahi":"6000",
        "Khulna":"9000","Comilla":"3500","Mymensingh":"2200",
        "Narayanganj":"1400","Gazipur":"1700","Rangpur":"5400",
        "Barisal":"8200","Bogra":"5800","Cox's Bazar":"4700",
        "Jessore":"7400","Tangail":"1900","Dinajpur":"5200",
    },
    "Malaysia": {
        "Kuala Lumpur":"50000","Johor Bahru":"80000","Ipoh":"30000",
        "Shah Alam":"40000","Petaling Jaya":"46000","George Town":"10000",
        "Subang Jaya":"47500","Malacca":"75000","Kuching":"93000",
        "Kota Kinabalu":"88000","Seremban":"70000","Klang":"41000",
        "Kota Bharu":"15000","Kuala Terengganu":"20000","Alor Setar":"05000",
        "Miri":"98000","Sibu":"96000","Batu Pahat":"83000","Taiping":"34000",
    },
    "Singapore": {
        "Singapore":"018989","Jurong":"608530","Woodlands":"730888",
        "Tampines":"520001","Ang Mo Kio":"560001","Bedok":"460001",
        "Yishun":"760001","Hougang":"530001","Sengkang":"540001",
    },
    "Turkey": {
        "Istanbul":"34000","Ankara":"06000","Izmir":"35000","Bursa":"16000",
        "Antalya":"07000","Adana":"01000","Gaziantep":"27000","Konya":"42000",
        "Mersin":"33000","Kayseri":"38000","Diyarbakır":"21000",
        "Samsun":"55000","Eskişehir":"26000","Trabzon":"61000",
        "Kocaeli":"41000","Malatya":"44000","Erzurum":"25000",
        "Van":"65000","Şanlıurfa":"63000","Manisa":"45000",
    },
    "Egypt": {
        "Cairo":"11511","Alexandria":"21515","Giza":"12556","Suez":"43511",
        "Luxor":"85951","Mansoura":"35516","Aswan":"81515",
        "Port Said":"42511","Ismailia":"41511","Tanta":"31512",
        "Asyut":"71511","Zagazig":"44511","Fayyum":"63511",
        "Hurghada":"84511","Qena":"83511","Sohag":"82511",
    },
    "South Africa": {
        "Johannesburg":"2000","Cape Town":"8001","Durban":"4001",
        "Pretoria":"0001","Port Elizabeth":"6001","Bloemfontein":"9301",
        "East London":"5201","Nelspruit":"1200","Kimberley":"8300",
        "Polokwane":"0700","Rustenburg":"0300","George":"6530",
    },
    "Nigeria": {
        "Lagos":"100001","Abuja":"900001","Kano":"700001","Ibadan":"200001",
        "Port Harcourt":"500001","Benin City":"300001","Kaduna":"800001",
        "Enugu":"400001","Maiduguri":"600001","Onitsha":"434001",
        "Warri":"330001","Aba":"450001","Jos":"930001",
    },
    "Kenya": {
        "Nairobi":"00100","Mombasa":"80100","Kisumu":"40100",
        "Nakuru":"20100","Eldoret":"30100","Thika":"01000","Kitale":"30200",
        "Meru":"60200","Nyeri":"10100","Garissa":"70100",
    },
    "Qatar": {
        "Doha":"00974","Al Wakrah":"00974","Al Khor":"00974",
        "Al Rayyan":"00974","Umm Salal":"00974","Mesaieed":"00974",
    },
    "Kuwait": {
        "Kuwait City":"13001","Hawalli":"32001","Salmiya":"22001",
        "Farwaniya":"80001","Al Ahmadi":"65000","Al Jahra":"90001",
        "Sabah Al Salem":"22010","Fahaheel":"65000",
    },
    "Bahrain": {
        "Manama":"317","Riffa":"934","Muharraq":"245",
        "Hamad Town":"702","Isa Town":"704","A'ali":"811","Sitra":"607",
    },
    "Oman": {
        "Muscat":"100","Salalah":"211","Sohar":"311","Nizwa":"611",
        "Sur":"411","Ibri":"511","Barka":"320","Rustaq":"329",
    },
    "Jordan": {
        "Amman":"11118","Zarqa":"13110","Irbid":"21110","Aqaba":"77110",
        "Al-Salt":"19110","Madaba":"17110","Mafraq":"25110","Jerash":"26110",
        "Russeifa":"13310","Balqa":"19151","Al-Karak":"61110",
    },
    "Iraq": {
        "Baghdad":"10001","Basra":"61001","Mosul":"41002","Erbil":"44001",
        "Najaf":"54001","Karbala":"56001","Kirkuk":"36001",
        "Sulaymaniyah":"46001","Tikrit":"34001","Ramadi":"31001",
        "Fallujah":"31001","Baqubah":"32001","Nasiriyah":"64001",
    },
    "Iran": {
        "Tehran":"1111111111","Mashhad":"9188888888","Isfahan":"8188888888",
        "Shiraz":"7188888888","Tabriz":"5188888888","Ahvaz":"6188888888",
        "Qom":"3718888888","Karaj":"3154888888","Rasht":"4193888888",
        "Hamadan":"6518888888","Bandar Abbas":"7918888888","Yazd":"8918888888",
    },
    "Afghanistan": {
        "Kabul":"1001","Kandahar":"3001","Herat":"3001",
        "Mazar-i-Sharif":"2001","Jalalabad":"2601","Kunduz":"3601",
        "Ghazni":"2401","Lashkar Gah":"4001","Taloqan":"3801",
    },
    "Sri Lanka": {
        "Colombo":"00100","Kandy":"20000","Galle":"80000","Jaffna":"40000",
        "Negombo":"11500","Matara":"81000","Trincomalee":"31000",
        "Batticaloa":"30000","Ratnapura":"70000","Badulla":"90000",
        "Anuradhapura":"50000","Kurunegala":"60000",
    },
    "Nepal": {
        "Kathmandu":"44600","Pokhara":"33700","Lalitpur":"44700",
        "Bhaktapur":"44800","Biratnagar":"56613","Birgunj":"44300",
        "Bharatpur":"44200","Janakpur":"45600","Dharan":"56700",
        "Butwal":"32907","Hetauda":"44100",
    },
    "Indonesia": {
        "Jakarta":"10110","Surabaya":"60175","Bandung":"40111",
        "Bekasi":"17111","Medan":"20111","Tangerang":"15111",
        "Depok":"16411","Semarang":"50111","Palembang":"30111",
        "Makassar":"90111","Denpasar":"80111","Bogor":"16111",
        "Malang":"65111","Batam":"29111","Samarinda":"75111",
        "Balikpapan":"76111","Manado":"95111","Pekanbaru":"28111",
    },
    "Philippines": {
        "Manila":"1000","Quezon City":"1100","Davao":"8000",
        "Caloocan":"1400","Cebu City":"6000","Zamboanga":"7000",
        "Taguig":"1630","Pasig":"1600","Cagayan de Oro":"9000",
        "Makati":"1200","Bacolod":"6100","Iloilo City":"5000",
        "Baguio":"2600","Antipolo":"1870","Dasmarinas":"4114",
        "Lapu-Lapu":"6015","Butuan":"8600",
    },
    "Thailand": {
        "Bangkok":"10100","Chiang Mai":"50000","Chiang Rai":"57000",
        "Phuket":"83000","Pattaya":"20150","Udon Thani":"41000",
        "Nakhon Ratchasima":"30000","Hat Yai":"90110","Surat Thani":"84000",
        "Ubon Ratchathani":"34000","Khon Kaen":"40000","Rayong":"21000",
        "Nonthaburi":"11000","Pak Kret":"11120","Chonburi":"20000",
    },
    "Lebanon": {
        "Beirut":"1107 2080","Tripoli":"1300","Sidon":"1601","Tyre":"1701",
        "Jounieh":"1200","Zahle":"1801","Baalbek":"1901","Byblos":"1000",
    },
}


@frappe.whitelist(allow_guest=True)
def get_cities(country, state=None):
    """Return cities for a country, optionally filtered by state/province.
    Queries the City doctype first; falls back to hardcoded dicts."""
    try:
        filters = {"country": country, "is_active": 1}
        if state:
            state_doc = f"{country}-{state}"
            if frappe.db.exists("State or Province", state_doc):
                filters["state_or_province"] = state_doc
        rows = frappe.get_all(
            "City",
            filters=filters,
            fields=["city_name"],
            order_by="city_name asc",
        )
        if rows:
            return [r.city_name for r in rows]
    except Exception:
        pass
    # Hardcoded fallback
    if state and country in _STATE_CITIES:
        state_cities = _STATE_CITIES[country].get(state)
        if state_cities:
            return state_cities
    return _CITIES.get(country, [])


# ─── DESK: Update shipment ───────────────────────────────────────────────────

@frappe.whitelist()
def update_shipment(name, data):
    """Custom update to avoid frappe.client.save creation-timestamp conflicts."""
    import json
    if isinstance(data, str):
        data = json.loads(data)

    doc = frappe.get_doc("Courier Shipment", name)
    if doc.docstatus == 1:
        frappe.throw(_("Cannot edit a submitted shipment. Cancel it first."))

    editable = [
        "shipment_type","ship_date","service","service_provider",
        "sender_name","sender_company","sender_phone","sender_email",
        "sender_address_line1","sender_address_line2","sender_country","sender_state","sender_city","sender_zip",
        "recipient_name","recipient_company","recipient_phone","recipient_email",
        "recipient_address_line1","recipient_address_line2","recipient_country","recipient_state","recipient_city","recipient_zip",
        "is_residential","special_instructions","customer_reference","packaging_type",
    ]
    for field in editable:
        if field in data:
            doc.set(field, data[field])

    if "packages" in data:
        doc.set("packages", [])
        for pkg in (data.get("packages") or []):
            doc.append("packages", {k: v for k, v in pkg.items() if k != "name"})

    if "commodities" in data:
        doc.set("commodities", [])
        for comm in (data.get("commodities") or []):
            if not comm.get("description") and not flt(comm.get("units")) and not flt(comm.get("price")):
                continue
            doc.append("commodities", {
                "description": comm.get("description") or "",
                "units":       flt(comm.get("units")),
                "uom":         comm.get("uom") or "Kg",
                "price":       flt(comm.get("price")),
                "hs_code":     comm.get("hs_code") or "",
                "amount":      flt(comm.get("amount")),
            })

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "ok", "name": doc.name}


# ─── PRIVATE helper ─────────────────────────────────────────────────────────

def _validate_portal_data(data):
    required = [
        ("sender_name", "Sender name"),
        ("sender_phone", "Sender phone"),
        ("sender_address_line1", "Sender address"),
        ("sender_city", "Sender city"),
        ("sender_country", "Sender country"),
        ("recipient_name", "Recipient name"),
        ("recipient_phone", "Recipient phone"),
        ("recipient_address_line1", "Recipient address"),
        ("recipient_city", "Recipient city"),
        ("recipient_country", "Recipient country"),
    ]
    for field, label in required:
        if not data.get(field):
            frappe.throw(_(f"{label} is required"))
    if not data.get("packages"):
        frappe.throw(_("At least one package is required"))
    for i, pkg in enumerate(data["packages"], 1):
        if not flt(pkg.get("weight")):
            frappe.throw(_(f"Package {i}: weight is required"))


# ─── HTS CODE LOOKUP (proxy — browser blocked by CORS) ──────────────────────

@frappe.whitelist(allow_guest=True)
def search_hs_codes(keyword):
    """Proxy the USITC HTS search API to avoid browser CORS restriction."""
    import urllib.request, urllib.parse, json as _json

    keyword = (keyword or "").strip()
    if not keyword:
        return []

    try:
        url = f"https://hts.usitc.gov/reststop/search?keyword={urllib.parse.quote(keyword)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read().decode())
    except Exception:
        return []

    results = []
    for it in (data if isinstance(data, list) else []):
        htsno = (it.get("htsno") or "").strip()
        if "." not in htsno:          # skip category headers
            continue
        desc    = (it.get("description") or "").strip()
        general = (it.get("general") or "").strip()
        results.append({"htsno": htsno, "description": desc, "general": general})
    return results
