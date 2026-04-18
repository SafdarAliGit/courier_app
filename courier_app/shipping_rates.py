"""
shipping_rates.py
-----------------
Core rate-lookup engine for courier_app.

Public entry point:
    get_shipping_rate(country, weight, service_provider)
"""

import frappe
from frappe import _
from frappe.utils import flt


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_shipping_rate(country: str, weight, service_provider: str) -> dict:
    """
    Returns shipping rate for a given country, weight (KG), and provider.

    Args:
        country          – Country name OR 2-letter ISO code
        weight           – Weight in KG (float or str)
        service_provider – Service Provider doc name or provider_code (e.g. "AAA")

    Returns dict with keys: rate, weight_kg, country, note,
        zone, zone_code, zone_label, service_provider
    """
    weight = flt(weight)
    if weight <= 0:
        frappe.throw(_("Weight must be greater than 0"))

    return _get_rate(country, weight, service_provider)


@frappe.whitelist()
def get_country_suggestions(query: str, service_provider: str = None) -> list:
    """Quick-search for front-end autocomplete."""
    if service_provider:
        return frappe.db.sql(
            """
            SELECT country_name, country_code, zone_code, shipping_zone
            FROM `tabCountry Zone`
            WHERE service_provider = %(sp)s
              AND (country_name LIKE %(q)s OR country_code LIKE %(q)s)
            ORDER BY country_name LIMIT 20
            """,
            {"sp": service_provider, "q": f"%{query}%"},
            as_dict=True,
        )
    return []


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL
# ─────────────────────────────────────────────────────────────────────────────

def _get_rate(country: str, weight: float, service_provider: str) -> dict:
    # Resolve provider_code → doc name if needed
    sp_name = _resolve_provider(service_provider)
    if not sp_name:
        frappe.throw(_(f"Service Provider '{service_provider}' not found or inactive"))

    # Resolve country → country zone row
    cz = _resolve_country_zone(country, sp_name)
    if not cz:
        frappe.throw(_(f"Country '{country}' is not configured for provider '{service_provider}'"))

    # Resolve rate zone
    zone_name = cz.get("shipping_zone")
    if not zone_name:
        zone_name = frappe.db.get_value(
            "Rate Zone",
            {"service_provider": sp_name, "zone_code": cz["zone_code"]},
            "name",
        )
    if not zone_name:
        frappe.throw(
            _(f"Rate Zone (code {cz['zone_code']}) not found for provider '{service_provider}'")
        )

    zone = frappe.get_doc("Rate Zone", zone_name)
    if not zone.is_active:
        frappe.throw(_(f"Rate Zone '{zone_name}' is inactive"))

    rate, note = _calculate_rate(zone.rate_slabs, weight)

    return {
        "rate": rate,
        "zone": zone_name,
        "zone_code": zone.zone_code,
        "zone_label": zone.zone_label or "",
        "service_provider": sp_name,
        "weight_kg": weight,
        "country": cz["country_name"],
        "note": note,
    }


def _resolve_provider(service_provider: str):
    """Accept either doc name or provider_code. Returns doc name or None."""
    if frappe.db.exists("Service Provider", service_provider):
        if frappe.db.get_value("Service Provider", service_provider, "is_active"):
            return service_provider
        return None
    name = frappe.db.get_value(
        "Service Provider",
        {"provider_code": service_provider.upper(), "is_active": 1},
        "name",
    )
    return name


def _resolve_country_zone(country: str, service_provider: str) -> dict | None:
    fields = ["country_name", "country_code", "zone_code", "shipping_zone"]
    row = frappe.db.get_value(
        "Country Zone",
        {"service_provider": service_provider, "country_name": country},
        fields,
        as_dict=True,
    )
    if row:
        return row
    return frappe.db.get_value(
        "Country Zone",
        {"service_provider": service_provider, "country_code": country.upper()},
        fields,
        as_dict=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# RATE CALCULATION
# ─────────────────────────────────────────────────────────────────────────────

def _calculate_rate(slabs, weight: float) -> tuple:
    """
    Find the applicable rate for a given weight from a slab list.

    Slabs sorted ascending by max_weight_kg.
    First slab where max_weight_kg >= weight is selected.
    For weight above the highest normal slab, the per-KG row is used:
        rate = last_normal_rate + (weight - last_normal_weight) * per_kg_rate
    """
    normal = sorted(
        [s for s in slabs if not s.is_per_kg_above_max],
        key=lambda s: flt(s.max_weight_kg),
    )
    per_kg = next((s for s in slabs if s.is_per_kg_above_max), None)

    for slab in normal:
        if flt(weight) <= flt(slab.max_weight_kg):
            return flt(slab.rate), ""

    if per_kg and normal:
        base_rate = flt(normal[-1].rate)
        base_weight = flt(normal[-1].max_weight_kg)
        extra = flt(weight) - base_weight
        total = base_rate + extra * flt(per_kg.rate)
        note = (
            f"71+ per-KG rate: {base_weight} KG base ({base_rate:,.2f}) "
            f"+ {extra:.1f} KG × {flt(per_kg.rate):,.3f} = {total:,.2f}"
        )
        return round(total, 2), note

    frappe.throw(_(f"No matching rate slab found for weight {weight} KG"))
