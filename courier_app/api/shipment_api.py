"""
courier_app/api/shipment_api.py
All @frappe.whitelist() endpoints used by portal + desk page.
"""

import frappe
from frappe import _
from frappe.utils import today, flt, nowdate
from courier_app.api.geo_data import _STATES, _STATE_CITIES, _CITIES, _CITY_POSTAL_CODES


# ─── PORTAL: Submit new shipment ────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def submit_shipment(data):
    """Called by public portal. Creates a Draft Shipment doc."""
    import json
    if isinstance(data, str):
        data = json.loads(data)

    _validate_portal_data(data)

    # If the session user has a linked Customer, their party_name is authoritative —
    # ignore whatever was submitted to prevent tampering via DOM manipulation.
    party_name = data.get("party_name") or ""
    session_user = frappe.session.user
    if session_user and session_user != "Guest":
        locked_name = frappe.db.get_value(
            "Customer", {"user_id": session_user}, "customer_name"
        )
        if locked_name:
            party_name = locked_name

    doc = frappe.new_doc("Courier Shipment")
    doc.update({
        "shipment_type":        data.get("shipment_type", "Outbound"),
        "ship_date":            data.get("ship_date") or today(),
        "services":             data.get("service") or data.get("services") or "",
        "packaging_type":       data.get("packaging_type") or "Others",
        "sender_name":          data.get("sender_name"),
        "sender_company":       data.get("sender_company"),
        "sender_phone":         data.get("sender_phone"),
        "sender_email":         (data.get("sender_email") or "").strip() or None,
        "sender_address_line1": data.get("sender_address_line1"),
        "sender_address_line2": data.get("sender_address_line2"),
        "sender_city":          data.get("sender_city"),
        "sender_state":         data.get("sender_state") or "",
        "sender_country":       data.get("sender_country"),
        "sender_zip":           data.get("sender_zip"),
        "recipient_name":       data.get("recipient_name"),
        "recipient_company":    data.get("recipient_company"),
        "recipient_phone":      data.get("recipient_phone"),
        "recipient_email":      (data.get("recipient_email") or "").strip() or None,
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
        "party_name":           party_name,
        "service_provider":     data.get("service_provider") or None,
        "submitted_by_portal":  1,
        "portal_email": (
            frappe.session.user
            if frappe.session.user and frappe.session.user != "Guest"
            else (data.get("sender_email") or "").strip() or None
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
def get_rates_all_providers(country, weight, service_provider=None):
    """
    Returns shipping rates for a given country + weight.

    Validates strictly in order:
      1. Weight  – must be present and > 0
      2. Country – must be present
      3. Service Provider – if specified, must exist and be active

    If service_provider is given, only that provider's rate is returned.
    Otherwise all active providers are compared.

    Returns:
      {
        country, weight_kg,
        rates: [{ provider_name, provider_code, provider_id,
                  zone_code, zone_label, rate, note,
                  country_name, country_code }],
        best_provider_id   – provider_id with lowest rate (or None)
      }
    """
    # ── 1. Weight ────────────────────────────────────────────────────────────
    weight = flt(weight)
    if not weight or weight <= 0:
        return {"rates": [], "error": "Weight is required and must be greater than 0"}

    # ── 2. Country ───────────────────────────────────────────────────────────
    country = (country or "").strip()
    if not country:
        return {"rates": [], "error": "Country is required"}

    # ── 3. Service Provider ──────────────────────────────────────────────────
    service_provider = (service_provider or "").strip()
    sp_filter = None   # None → all active providers

    if service_provider:
        # Accept doc name or provider_code
        sp_doc = (
            frappe.db.get_value(
                "Service Provider",
                {"name": service_provider, "is_active": 1},
                ["name", "provider_name", "provider_code"],
                as_dict=True,
            )
            or frappe.db.get_value(
                "Service Provider",
                {"provider_code": service_provider.upper(), "is_active": 1},
                ["name", "provider_name", "provider_code"],
                as_dict=True,
            )
        )
        if not sp_doc:
            return {
                "rates": [],
                "error": f"Service Provider '{service_provider}' not found or inactive",
            }
        sp_filter = sp_doc["name"]

    # ── Fetch providers ──────────────────────────────────────────────────────
    from courier_app.shipping_rates import _resolve_country_zone, _calculate_rate

    prov_filters = {"is_active": 1}
    if sp_filter:
        prov_filters["name"] = sp_filter

    providers = frappe.get_all(
        "Service Provider",
        filters=prov_filters,
        fields=["name", "provider_name", "provider_code"],
        order_by="provider_name",
    )

    # ── If a specific SP was requested but has no countries configured,
    #    return a clear error rather than a silent empty list.
    if sp_filter and not providers:
        return {
            "rates": [],
            "error": f"Service Provider '{service_provider}' is not active",
        }

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

    # If a specific SP was requested but the country isn't configured for it,
    # surface a meaningful error instead of "No rates available".
    if sp_filter and not rates:
        sp_label = sp_doc.get("provider_name") or sp_filter
        return {
            "rates": [],
            "error": (
                f"Country '{country}' has no rates configured "
                f"for provider '{sp_label}'"
            ),
        }

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
            s.special_instructions, s.party_name,
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
            s.special_instructions, s.party_name,
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
    """
    App Defaults countries only — for RECIPIENT country dropdowns.
    Returns countries configured in Country Zone for active providers (109 UPS countries).
    Each row: { name, country_name }
    """
    rows = frappe.db.sql(
        """
        SELECT DISTINCT cz.country_name
        FROM `tabCountry Zone` cz
        INNER JOIN `tabService Provider` sp ON sp.name = cz.service_provider
        WHERE sp.is_active = 1
        ORDER BY cz.country_name
        """,
        as_dict=True,
    )
    return [{"name": r.country_name, "country_name": r.country_name} for r in rows if r.country_name]


@frappe.whitelist(allow_guest=True)
def get_countries_standard():
    """
    Standard Frappe countries — for SENDER country dropdowns.
    Returns all countries from the Country doctype (200+ standard names).
    Each row: { name, country_name }
    """
    return frappe.db.sql(
        "SELECT country_name, name FROM `tabCountry` ORDER BY country_name",
        as_dict=True,
    )


@frappe.whitelist(allow_guest=True)
def get_countries_all():
    """
    Merged list of standard + App Defaults countries — for Data Manager location management.
    Deduplicates by name, sorted A→Z.
    Each row: { name, country_name }
    """
    standard = frappe.db.sql(
        "SELECT country_name, name FROM `tabCountry` ORDER BY country_name",
        as_dict=True,
    )
    provider_rows = frappe.db.sql(
        """
        SELECT DISTINCT cz.country_name
        FROM `tabCountry Zone` cz
        INNER JOIN `tabService Provider` sp ON sp.name = cz.service_provider
        WHERE sp.is_active = 1
        ORDER BY cz.country_name
        """,
        as_dict=True,
    )
    seen = {r.name for r in standard}
    merged = list(standard)
    for row in provider_rows:
        cname = row.country_name
        if cname and cname not in seen:
            merged.append({"name": cname, "country_name": cname})
            seen.add(cname)
    merged.sort(key=lambda r: r["country_name"].lower())
    return merged


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
        "is_residential","special_instructions","party_name","packaging_type",
    ]
    email_fields = {"sender_email", "recipient_email"}
    for field in editable:
        if field in data:
            val = data[field]
            if field in email_fields:
                val = val or None
            doc.set(field, val)

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


@frappe.whitelist(allow_guest=True)
def check_party_name(name, shipment=None):
    """Check for a duplicate customer name.

    If a shipment name is supplied, the shipment owner's user_id is matched
    against Customer.user_id first.  When a match is found the customer already
    belongs to this user — no new customer is needed and no duplicate warning
    should be raised, so we return exists=False immediately.
    """
    name = (name or "").strip()
    if not name or len(name) < 2:
        return {"exists": False, "matches": []}

    # Check by user_id when a shipment context is available
    if shipment:
        owner = frappe.db.get_value("Courier Shipment", shipment, "owner")
        if owner and owner != "Guest":
            existing = frappe.db.get_value("Customer", {"user_id": owner}, "name")
            if existing:
                # Customer is already linked to this user — proceed to Sales Invoice only
                return {"exists": False, "matches": [], "customer": existing}

    # Fallback: check for an exact name collision
    matches = frappe.db.sql(
        "SELECT name, customer_name FROM `tabCustomer` WHERE LOWER(customer_name) = LOWER(%s) LIMIT 1",
        name,
        as_dict=True,
    )
    exact = bool(matches)
    return {
        "exists": exact,
        "matches": [{"id": m.name, "label": m.customer_name} for m in matches],
    }
