"""
courier_app/api/shipment_api.py
All @frappe.whitelist() endpoints used by portal + desk page.
"""

import os
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

    party_name = data.get("party_name") or ""
    customer_link = None
    session_user = frappe.session.user

    if session_user and session_user != "Guest":
        user_type = frappe.db.get_value("User", session_user, "user_type")
        if user_type != "Website User":
            # Desk user: party_name submitted is a Customer ID — resolve it
            if party_name:
                cust = frappe.db.get_value(
                    "Customer", party_name, ["name", "customer_name"], as_dict=True
                )
                if cust:
                    customer_link = cust.name
                    party_name = cust.customer_name
        else:
            # Web user: override with linked customer name to prevent DOM tampering
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
        "customer":             customer_link,
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


# ─── DESK: Customer list + create ───────────────────────────────────────────

@frappe.whitelist()
def get_customers():
    """Desk users only — returns all customers for the portal party selector."""
    if frappe.db.get_value("User", frappe.session.user, "user_type") == "Website User":
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    return frappe.get_all(
        "Customer",
        fields=["name", "customer_name"],
        order_by="customer_name asc",
    )


@frappe.whitelist(allow_guest=True)
def create_customer_from_portal(customer_name, customer_type="Individual", force=False):
    """Desk user creates a new Customer from the portal party-name selector.

    If a customer with the same name already exists and force is False, returns a
    warning dict instead of raising so the UI can prompt the user to confirm.
    Pass force=True to create despite the duplicate.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    if frappe.db.get_value("User", frappe.session.user, "user_type") == "Website User":
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    customer_name = (customer_name or "").strip()
    if len(customer_name) < 2:
        frappe.throw(_("Customer name must be at least 2 characters"))

    allowed_types = {"Company", "Individual", "Partnership"}
    if customer_type not in allowed_types:
        frappe.throw(_(f"Invalid customer type: {customer_type}"))

    force = frappe.utils.cint(force)
    existing = frappe.db.get_value("Customer", {"customer_name": customer_name}, "name")
    if existing and not force:
        return {"duplicate_warning": True, "existing": existing, "customer_name": customer_name}

    from courier_app.api.approval_api import _get_default_customer_group, _get_default_territory

    doc = frappe.new_doc("Customer")
    doc.customer_name = customer_name
    doc.customer_type = customer_type
    doc.customer_group = _get_default_customer_group()
    doc.territory = _get_default_territory()

    # Snapshot message log before insert so we can capture any auto-rename
    # notes Frappe adds (e.g. "Changed customer name to 'X - 2' as 'X' already
    # exists") and return them to the UI instead of letting them appear as a
    # bottom-of-page notification.
    pre_insert_log_len = len(frappe.message_log)
    doc.insert(ignore_permissions=True)
    insert_notes = frappe.message_log[pre_insert_log_len:]
    del frappe.message_log[pre_insert_log_len:]

    frappe.db.commit()

    note = None
    for entry in insert_notes:
        try:
            parsed = frappe.parse_json(entry) if isinstance(entry, str) else entry
            msg_text = parsed.get("message", "")
            if msg_text:
                import re
                note = re.sub(r"<[^>]+>", "", msg_text).strip()
                break
        except Exception:
            pass

    return {"name": doc.name, "customer_name": doc.customer_name, "note": note}


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

    # If a specific SP was requested but no rate was found, surface a meaningful error.
    if sp_filter and not rates:
        sp_label = sp_doc.get("provider_name") or sp_filter
        # Distinguish: weight exceeds max slab vs country not configured at all
        cz = _resolve_country_zone(country, sp_filter)
        if cz:
            zone_name = cz.get("shipping_zone") or frappe.db.get_value(
                "Rate Zone",
                {"service_provider": sp_filter, "zone_code": cz["zone_code"], "is_active": 1},
                "name",
            )
            if zone_name:
                zone = frappe.get_doc("Rate Zone", zone_name)
                normal_slabs = sorted(
                    [s for s in zone.rate_slabs if not s.is_per_kg_above_max],
                    key=lambda s: flt(s.max_weight_kg),
                )
                if normal_slabs and weight > flt(normal_slabs[-1].max_weight_kg):
                    max_wt = flt(normal_slabs[-1].max_weight_kg)
                    return {
                        "rates": [],
                        "error": (
                            f"'{sp_label}' supports a maximum weight of {max_wt} kg. "
                            f"Please enter {max_wt} kg or less."
                        ),
                    }
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
    """Fetch tracking data. Uses AfterShip when enabled, otherwise returns custom tracking from Courier Shipment."""
    if not tracking_id:
        return {"found": False, "error": "Tracking ID is required"}

    try:
        settings = frappe.get_single("Courier Settings")
    except Exception:
        return {"found": False, "error": "Courier Settings not configured"}

    if settings.use_aftership:
        return _track_via_aftership(tracking_id, settings)
    else:
        return _track_via_custom(tracking_id)


def _track_via_aftership(tracking_id, settings):
    import requests

    api_key = settings.get_password("api_key") if settings.api_key else None
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

    return {"found": True, "mode": "aftership", "tracking": trackings[0]}


def _track_via_custom(tracking_id):
    tracking_id = tracking_id.strip()

    doc = frappe.db.get_value(
        "Courier Shipment",
        {"tracking_number": tracking_id},
        ["name"],
        as_dict=True,
    )
    if not doc:
        doc = frappe.db.get_value(
            "Courier Shipment",
            tracking_id,
            ["name"],
            as_dict=True,
        ) if frappe.db.exists("Courier Shipment", tracking_id) else None

    if not doc:
        return {"found": False}

    shipment = frappe.get_doc("Courier Shipment", doc.name)

    events = []
    for ev in sorted(shipment.tracking_events, key=lambda e: e.tracking_datetime):
        events.append({
            "status": ev.status,
            "datetime": str(ev.tracking_datetime),
            "location": ev.location or "",
        })

    return {
        "found": True,
        "mode": "custom",
        "shipment": {
            "name": shipment.name,
            "tracking_number": shipment.tracking_number or shipment.name,
            "status": shipment.status,
            "sender_name": shipment.sender_name,
            "recipient_name": shipment.recipient_name,
            "sender_country": shipment.sender_country,
            "sender_city": shipment.sender_city,
            "sender_state": shipment.sender_state,
            "recipient_country": shipment.recipient_country,
            "recipient_city": shipment.recipient_city,
            "recipient_state": shipment.recipient_state,
            "ship_date": str(shipment.ship_date) if shipment.ship_date else "",
            "service_provider": shipment.service_provider,
            "services": shipment.services,
        },
        "events": events,
    }


# ─── DESK: List shipments ────────────────────────────────────────────────────

@frappe.whitelist()
def get_shipments(filters=None, page=1, page_size=20, sort_by="creation", sort_order="desc"):
    import json
    if isinstance(filters, str):
        filters = json.loads(filters)
    filters = filters or {}

    page      = max(1, int(page))
    page_size = min(max(1, int(page_size)), 200)
    offset    = (page - 1) * page_size

    conditions = "WHERE 1=1"
    values = {}

    if filters.get("status"):
        conditions += " AND s.status = %(status)s"
        values["status"] = filters["status"]
    if filters.get("shipment_type"):
        conditions += " AND s.shipment_type = %(shipment_type)s"
        values["shipment_type"] = filters["shipment_type"]
    if filters.get("search"):
        raw = filters["search"].strip()
        words = raw.split()
        # Text fields use full wildcard; name/tracking use prefix for index benefit
        _TEXT_FIELDS = [
            "s.recipient_name", "s.recipient_company", "s.recipient_phone", "s.recipient_email",
            "s.recipient_city", "s.recipient_country",
            "s.sender_name", "s.sender_company", "s.sender_phone",
            "s.party_name", "s.portal_email", "s.services",
        ]
        if len(words) > 1:
            # Multi-word: every word must match at least one field (AND logic)
            for i, word in enumerate(words):
                pk = f"sw_p{i}"
                fk = f"sw_f{i}"
                text_conds = " OR ".join(f"{col} LIKE %({fk})s" for col in _TEXT_FIELDS)
                conditions += f" AND (s.name LIKE %({pk})s OR s.tracking_number LIKE %({pk})s OR {text_conds})"
                values[pk] = f"{word}%"
                values[fk] = f"%{word}%"
        else:
            text_conds = " OR ".join(f"{col} LIKE %(search)s" for col in _TEXT_FIELDS)
            conditions += f" AND (s.name LIKE %(search_prefix)s OR s.tracking_number LIKE %(search_prefix)s OR {text_conds})"
            values["search_prefix"] = f"{raw}%"
            values["search"]        = f"%{raw}%"
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

    allowed_sort = {
        "creation", "name", "ship_date", "recipient_name", "recipient_country",
        "status", "approval_status", "calculated_rate", "total_weight",
    }
    sort_by   = sort_by if sort_by in allowed_sort else "creation"
    sort_order = "ASC" if sort_order.lower() == "asc" else "DESC"

    # ── Capped COUNT: stop scanning after COUNT_CAP rows — avoids full-table scan ──
    COUNT_CAP = 100_001
    raw_count = frappe.db.sql(
        f"SELECT COUNT(*) FROM (SELECT 1 FROM `tabCourier Shipment` s {conditions} LIMIT {COUNT_CAP}) AS _cnt",
        values,
    )[0][0]
    total_capped = raw_count >= COUNT_CAP
    total        = raw_count  # exact when < cap; ≥ 100 k when capped

    # ── Deferred-join: inner query fetches only PKs via index, outer fetches full rows ──
    # ── LEFT JOIN aggregates actual_weight for only the fetched page rows            ──
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
            s.customer, s.sales_invoice, s.approved_by, s.approved_on,
            s.docstatus, s.creation,
            ROUND(SUM(IFNULL(p.actual_weight, 0)), 3) AS total_actual_weight
        FROM `tabCourier Shipment` s
        INNER JOIN (
            SELECT s.name
            FROM `tabCourier Shipment` s
            {conditions}
            ORDER BY s.{sort_by} {sort_order}
            LIMIT %(limit)s OFFSET %(offset)s
        ) AS _ids ON s.name = _ids.name
        LEFT JOIN `tabShipment Package` p ON p.parent = s.name
        GROUP BY s.name
        ORDER BY s.{sort_by} {sort_order}
    """, {**values, "limit": page_size, "offset": offset}, as_dict=True)

    return {
        "rows":         rows,
        "total":        total,
        "total_capped": total_capped,
        "page":         page,
        "page_size":    page_size,
        "pages":        -(-total // page_size),
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
        raw = filters["search"].strip()
        words = raw.split()
        _TEXT_FIELDS = [
            "s.recipient_name", "s.recipient_company", "s.recipient_phone", "s.recipient_email",
            "s.recipient_city", "s.recipient_country",
            "s.sender_name", "s.sender_company", "s.sender_phone",
            "s.party_name", "s.portal_email", "s.services",
        ]
        if len(words) > 1:
            for i, word in enumerate(words):
                pk = f"sw_p{i}"
                fk = f"sw_f{i}"
                text_conds = " OR ".join(f"{col} LIKE %({fk})s" for col in _TEXT_FIELDS)
                conditions += f" AND (s.name LIKE %({pk})s OR s.tracking_number LIKE %({pk})s OR {text_conds})"
                values[pk] = f"{word}%"
                values[fk] = f"%{word}%"
        else:
            text_conds = " OR ".join(f"{col} LIKE %(search)s" for col in _TEXT_FIELDS)
            conditions += f" AND (s.name LIKE %(search_prefix)s OR s.tracking_number LIKE %(search_prefix)s OR {text_conds})"
            values["search_prefix"] = f"{raw}%"
            values["search"]        = f"%{raw}%"
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
            s.customer, s.sales_invoice, s.approved_by, s.approved_on,
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
            "Shipment Information Received": "background:#dbeafe;color:#1d4ed8",
            "Collection": "background:#fef3c7;color:#92400e",
            "In Transit to Destination": "background:#ede9fe;color:#5b21b6",
            "Departed Origin Airport": "background:#e0f2fe;color:#0369a1",
            "Arrived at Destination Airport": "background:#d1fae5;color:#065f46",
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
            SUM(CASE WHEN status='Shipment Information Received' THEN 1 ELSE 0 END) AS info_received,
            SUM(CASE WHEN status='Collection'                    THEN 1 ELSE 0 END) AS collection,
            SUM(CASE WHEN status='In Transit to Destination'     THEN 1 ELSE 0 END) AS in_transit,
            SUM(CASE WHEN status='Departed Origin Airport'       THEN 1 ELSE 0 END) AS departed_origin,
            SUM(CASE WHEN status='Arrived at Destination Airport'THEN 1 ELSE 0 END) AS arrived_dest,
            SUM(CASE WHEN status='Delivered'                     THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status='Cancelled'                     THEN 1 ELSE 0 END) AS cancelled,
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


# ─── PORTAL: Shipment status info (for update-shipment-status page) ─────────

@frappe.whitelist()
def get_shipment_status_info(shipment_id):
    """Returns shipment details and tracking events for the status update page."""
    shipment_id = (shipment_id or "").strip()
    if not shipment_id:
        return {"found": False}

    doc = None
    if frappe.db.exists("Courier Shipment", shipment_id):
        doc = frappe.get_doc("Courier Shipment", shipment_id)
    else:
        name = frappe.db.get_value(
            "Courier Shipment", {"tracking_number": shipment_id}, "name"
        )
        if name:
            doc = frappe.get_doc("Courier Shipment", name)

    if not doc:
        return {"found": False}

    events = []
    for ev in sorted(doc.tracking_events, key=lambda e: e.tracking_datetime):
        events.append({
            "status": ev.status,
            "datetime": str(ev.tracking_datetime),
            "location": ev.location or "",
            "updated_by": ev.updated_by or "",
        })

    return {
        "found": True,
        "name": doc.name,
        "status": doc.status,
        "tracking_number": doc.tracking_number or "",
        "ship_date": str(doc.ship_date) if doc.ship_date else "",
        "sender_name": doc.sender_name or "",
        "sender_city": doc.sender_city or "",
        "sender_country": doc.sender_country or "",
        "recipient_name": doc.recipient_name or "",
        "recipient_city": doc.recipient_city or "",
        "recipient_country": doc.recipient_country or "",
        "service_provider": doc.service_provider or "",
        "services": doc.services or "",
        "events": events,
    }


# ─── DESK: Update shipment status ───────────────────────────────────────────

@frappe.whitelist()
def update_status(shipment_id, new_status):
    allowed = [
        "Shipment Information Received", "Collection",
        "In Transit to Destination", "Departed Origin Airport",
        "Arrived at Destination Airport", "Delivered", "Cancelled",
    ]
    if new_status not in allowed:
        frappe.throw(_(f"Invalid status: {new_status}"))

    from frappe.utils import now_datetime
    from courier_app.courier_app.doctype.courier_shipment.courier_shipment import _build_location

    doc = frappe.get_doc("Courier Shipment", shipment_id)
    doc.status = new_status

    location_map = {
        "Shipment Information Received": _build_location(doc.sender_country, doc.sender_city),
        "Collection": _build_location(doc.sender_country, doc.sender_city),
        "In Transit to Destination": _build_location(doc.sender_country, doc.sender_city),
        "Departed Origin Airport": "",
        "Arrived at Destination Airport": "",
        "Delivered": _build_location(doc.recipient_country, doc.recipient_city),
    }
    location = location_map.get(new_status, "")

    doc.append("tracking_events", {
        "status": new_status,
        "tracking_datetime": now_datetime(),
        "location": location,
        "updated_by": frappe.session.user,
    })

    doc.save(ignore_permissions=True)
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
def get_countries(service_provider=None):
    """
    App Defaults countries only — for RECIPIENT country dropdowns.
    Filtered by service_provider when provided; requires one to be selected.
    Each row: { name, country_name }
    """
    if not service_provider:
        return {"error": "Please Select Service Provider First"}

    rows = frappe.db.sql(
        """
        SELECT DISTINCT cz.country_name
        FROM `tabCountry Zone` cz
        INNER JOIN `tabService Provider` sp ON sp.name = cz.service_provider
        WHERE sp.is_active = 1
          AND cz.service_provider = %s
        ORDER BY cz.country_name
        """,
        service_provider,
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

    # Validate HS codes on all commodities for international shipments
    sc = (doc.sender_country or "").strip()
    rc = (doc.recipient_country or "").strip()
    if sc and rc and sc != rc:
        for i, comm in enumerate(doc.commodities, 1):
            if not (comm.hs_code or "").strip():
                frappe.throw(_(f"Commodity {i}: HS code is required for international shipments"))

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

    sender_country    = (data.get("sender_country") or "").strip()
    recipient_country = (data.get("recipient_country") or "").strip()
    if sender_country and recipient_country and sender_country != recipient_country:
        for i, comm in enumerate(data.get("commodities") or [], 1):
            if not flt(comm.get("units")) and not comm.get("desc") and not comm.get("price"):
                continue
            if not (comm.get("hs_code") or "").strip():
                frappe.throw(_(f"Commodity {i}: HS code is required for international shipments"))


# ─── HTS CODE LOOKUP (proxy — browser blocked by CORS) ──────────────────────

@frappe.whitelist(allow_guest=True)
def search_hs_codes(keyword):
    """Search HS codes via USITC API, falling back to local dataset if unavailable."""
    import urllib.request, urllib.parse, json as _json

    keyword = (keyword or "").strip()
    if not keyword:
        return []

    # Primary: USITC API
    try:
        url = f"https://hts.usitc.gov/reststop/search?keyword={urllib.parse.quote(keyword)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read().decode())
        results = []
        for it in (data if isinstance(data, list) else []):
            htsno   = (it.get("htsno") or "").strip()
            if not htsno:
                continue
            desc    = (it.get("description") or "").strip()
            general = (it.get("general") or "").strip()
            results.append({"htsno": htsno, "description": desc, "general": general})
        if results:
            _update_hs_cache(keyword, results)
            return results
    except Exception:
        pass

    # Fallback: local dataset (used when API is unreachable)
    return _search_local_hs_codes(keyword)


_HS_SYNONYMS = {
    "electronics": ["electrical", "electric", "electronic", "apparatus", "machine"],
    "electronic": ["electrical", "electric", "apparatus"],
    "electrical": ["electric", "electronics", "apparatus"],
    "cosmetics": ["make-up", "beauty", "perfume", "shampoo", "deodorant", "toiletries", "lotion", "cream", "skincare"],
    "cosmetic": ["make-up", "beauty", "perfume", "preparations"],
    "perfume": ["toilet waters", "scent", "fragrance", "odoriferous"],
    "makeup": ["make-up", "beauty", "lipstick", "mascara", "foundation", "eye"],
    "skincare": ["beauty", "lotion", "cream", "preparations"],
    "phone": ["telephone", "mobile", "cellular", "handset"],
    "mobile": ["telephone", "cellular", "handset", "smartphone"],
    "computer": ["data processing", "laptop", "notebook", "cpu", "processor"],
    "laptop": ["portable automatic data processing", "notebook"],
    "tablet": ["portable automatic data processing", "data processing"],
    "keyboard": ["computer keyboards", "keyboards", "input or output units"],
    "mouse": ["mice", "computer keyboards"],
    "power bank": ["power banks", "portable lithium battery"],
    "headphones": ["headphones", "earphones", "microphone"],
    "earphones": ["headphones", "earphones"],
    "earbuds": ["headphones", "earphones"],
    "speaker": ["loudspeaker", "audio"],
    "camera": ["photographic", "cameras", "camcorder"],
    "printer": ["printing", "inkjet", "laser printer"],
    "charger": ["converters", "static converters", "transformer", "adapters"],
    "cable": ["conductors", "wiring", "coaxial"],
    "battery": ["batteries", "lithium", "lead-acid"],
    "clothes": ["apparel", "garment", "clothing", "textile", "wearing"],
    "clothing": ["apparel", "garment", "textile", "wearing", "knitted"],
    "shirt": ["blouses", "shirts", "tops"],
    "pants": ["trousers", "shorts"],
    "trousers": ["pants", "trousers"],
    "jacket": ["overcoats", "car-coats", "coats", "outerwear"],
    "coat": ["overcoats", "car-coats", "coats", "jacket"],
    "dress": ["garments", "clothing", "apparel", "wearing"],
    "suit": ["suits", "women's suits", "men's suits", "apparel", "garments", "ensembles"],
    "suits": ["suit", "women's suits", "men's suits", "apparel", "garments", "ensembles"],
    "ladies": ["women's", "women", "girls'", "female"],
    "women": ["women's", "ladies", "girls'", "female"],
    "men": ["men's", "boys'", "male"],
    "girls": ["girls'", "women's", "ladies", "children's"],
    "boys": ["boys'", "men's", "children's"],
    "ensemble": ["ensembles", "suits", "garments", "clothing"],
    "ensembles": ["ensemble", "suits", "garments", "clothing"],
    "shoes": ["footwear", "boots", "shoe"],
    "boots": ["footwear", "shoes", "boot"],
    "bag": ["bags", "handbag", "sack", "trunks", "cases"],
    "bags": ["bags", "handbag", "sack", "trunks", "cases", "backpack"],
    "luggage": ["trunks", "suit-cases", "travel", "bags"],
    "suitcase": ["trunks", "suit-cases", "travel bags"],
    "backpack": ["bags", "rucksack", "knapsacks"],
    "wallet": ["pocket", "purse", "billfold"],
    "jewelry": ["jewellery", "ornaments", "gold", "silver", "precious"],
    "jewellery": ["jewelry", "ornaments", "gold", "silver"],
    "watch": ["wrist-watches", "clocks", "timepiece"],
    "watches": ["wrist-watches", "clocks"],
    "smartwatch": ["wrist-watches", "clocks", "timepiece"],
    "medicine": ["medicaments", "pharmaceutical", "drugs", "medical"],
    "medicines": ["medicaments", "pharmaceutical", "drugs"],
    "drug": ["medicaments", "pharmaceutical", "medicine"],
    "vitamins": ["vitamins", "vitamin"],
    "food": ["foodstuffs", "edible", "food preparations"],
    "beverage": ["drinks", "waters", "juice", "tea", "coffee"],
    "toys": ["toys", "games", "dolls", "wheeled toys"],
    "toy": ["toys", "games", "dolls"],
    "game": ["games", "toys", "video game", "console"],
    "furniture": ["furniture", "seats", "chairs", "tables", "beds", "wardrobes"],
    "chair": ["seats", "chairs", "seating"],
    "table": ["tables", "furniture"],
    "bed": ["beds", "mattress", "bedroom"],
    "mattress": ["mattresses", "mattress", "bedding"],
    "lamp": ["lamps", "lighting", "chandeliers", "luminaire"],
    "light": ["lamps", "lighting", "chandeliers", "luminaire"],
    "bicycle": ["bicycles", "cycles", "bike"],
    "bike": ["bicycles", "cycles"],
    "car": ["automobiles", "motor vehicles", "vehicles"],
    "vehicle": ["motor vehicles", "automobiles", "car"],
    "book": ["books", "printed", "brochures", "literature"],
    "books": ["books", "printed", "brochures"],
    "pen": ["pens", "ballpoint", "fountain"],
    "pencil": ["pencils", "crayons"],
    "paper": ["paper", "paperboard", "stationery"],
    "sports": ["sports", "athletic", "gym", "fitness", "exercise"],
    "sport": ["sports", "athletic", "exercise"],
    "gym": ["physical exercise", "sports", "fitness", "athletic"],
    "perfumes": ["perfumes", "toilet waters", "fragrances"],
    "soap": ["soap", "detergents"],
    "candle": ["candles", "tapers"],
    "paint": ["paints", "varnishes", "coatings"],
    "wood": ["wood", "wooden", "timber", "lumber"],
    "plastic": ["plastics", "synthetic", "polymer"],
    "glass": ["glass", "glassware", "crystal"],
    "metal": ["metal", "iron", "steel", "aluminium", "copper"],
    "steel": ["steel", "iron", "metal", "stainless"],
    "gold": ["gold", "precious metal", "jewellery"],
    "silver": ["silver", "precious metal", "jewellery"],
    "diamond": ["diamonds", "precious stones", "gemstones"],
    "cotton": ["cotton", "textile", "fabric"],
    "silk": ["silk", "fabric", "textile"],
    "leather": ["leather", "hide", "skin"],
    "rubber": ["rubber", "vulcanized", "synthetic rubber"],
    "chemical": ["chemical", "compound", "substance"],
    "fertilizer": ["fertilizers", "fertiliser", "manure"],
    "oil": ["oil", "petroleum", "vegetable oil", "essential oils"],
}


_HS_CACHE_PATH = os.path.join(os.path.dirname(__file__), "hs_codes_cache.json")


_HS_KEYWORD_CACHE_PATH = os.path.join(os.path.dirname(__file__), "hs_codes_keywords.json")


def _load_hs_cache():
    """Load the accumulated HS codes entries cache from disk."""
    import json as _json
    try:
        with open(_HS_CACHE_PATH, "r") as f:
            return _json.load(f)
    except Exception:
        return {}


def _load_keyword_cache():
    """Load the keyword→htsno index from disk."""
    import json as _json
    try:
        with open(_HS_KEYWORD_CACHE_PATH, "r") as f:
            return _json.load(f)
    except Exception:
        return {}


def _update_hs_cache(keyword, new_entries):
    """Persist all API results to disk in a background thread."""
    import threading
    threading.Thread(target=_write_hs_cache, args=(keyword, new_entries), daemon=True).start()


def _write_hs_cache(keyword, new_entries):
    """Write HS code entries + keyword index to disk (runs in background thread)."""
    import json as _json
    try:
        # Update entries cache (always overwrite with latest data from API)
        try:
            with open(_HS_CACHE_PATH, "r") as f:
                entries = _json.load(f)
        except Exception:
            entries = {}
        for entry in new_entries:
            htsno = entry.get("htsno", "")
            if htsno:
                entries[htsno] = entry
        with open(_HS_CACHE_PATH, "w") as f:
            _json.dump(entries, f)

        # Update keyword index so this keyword maps to its result htsno list
        try:
            with open(_HS_KEYWORD_CACHE_PATH, "r") as f:
                kw_index = _json.load(f)
        except Exception:
            kw_index = {}
        kw_index[keyword.lower().strip()] = [e["htsno"] for e in new_entries if e.get("htsno")]
        with open(_HS_KEYWORD_CACHE_PATH, "w") as f:
            _json.dump(kw_index, f)
    except Exception:
        pass


def _search_local_hs_codes(keyword):
    """Search static dataset + accumulated cache by keyword."""
    from courier_app.api.hs_codes_data import HS_CODES

    kw = keyword.lower().strip()

    # Fast path: exact keyword was searched before — return those entries directly
    kw_index = _load_keyword_cache()
    if kw in kw_index:
        entries_cache = _load_hs_cache()
        results = [entries_cache[h] for h in kw_index[kw] if h in entries_cache]
        if results:
            return results

    # Merge static dataset with accumulated cache entries
    entries_cache = _load_hs_cache()
    static_htsno  = {item["htsno"] for item in HS_CODES}
    all_codes     = HS_CODES + [v for k, v in entries_cache.items() if k not in static_htsno]

    kw = keyword.lower().strip()
    # Build expanded search terms
    search_words = [w for w in kw.split() if len(w) >= 2]
    expanded = list(search_words)
    for w in search_words:
        for syn in _HS_SYNONYMS.get(w, []):
            if syn not in expanded:
                expanded.append(syn)
    # Also expand the full phrase
    for syn in _HS_SYNONYMS.get(kw, []):
        if syn not in expanded:
            expanded.append(syn)

    if not expanded:
        return []

    scored = []
    for item in all_codes:
        desc_lower = item["description"].lower()
        htsno = item["htsno"]
        # HS code number prefix match
        if htsno.startswith(kw) or htsno.replace(".", "").startswith(kw.replace(".", "")):
            scored.append((100, item))
            continue
        score = 0
        for w in expanded:
            if w in desc_lower:
                pos = desc_lower.find(w)
                weight = 15 if w in search_words else 8
                score += weight + max(0, 5 - pos // 10)
        if score:
            scored.append((score, item))

    scored.sort(key=lambda x: -x[0])
    seen = set()
    results = []
    for _, item in scored:
        if item["htsno"] not in seen:
            seen.add(item["htsno"])
            results.append(item)
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
