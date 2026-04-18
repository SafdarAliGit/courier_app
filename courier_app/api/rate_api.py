"""
courier_app/api/rate_api.py
---------------------------
Rate Management API — production-grade import, preview, adjustment, and history.

Import modes (execute_import):
  upsert        – create new zones / update existing ones (default, safe)
  replace       – delete ALL existing zones for the provider, then import fresh
  skip_existing – only create zones that don't exist yet; skip existing

Endpoints:
  get_service_providers / get_zones
  preview_import(file_url, service_provider, import_type)
  execute_import(file_url, service_provider, import_type, mode="upsert", dry_run=False)
  preview_rate_adjustment / apply_rate_adjustment
  get_import_history
  get_rate
  clear_provider_data(service_provider, confirm)   – wipe all zones + country zones
"""

import frappe
from frappe import _
from frappe.utils import flt, now_datetime, cstr
import json
import os


# ─── LOOKUPS ─────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=False)
def get_service_providers(include_inactive=False):
    filters = {} if include_inactive else {"is_active": 1}
    return frappe.db.get_all(
        "Service Provider",
        filters=filters,
        fields=["name", "provider_name", "provider_code", "is_active"],
        order_by="provider_name",
    )


@frappe.whitelist(allow_guest=False)
def get_zones(service_provider):
    return frappe.db.get_all(
        "Rate Zone",
        filters={"service_provider": service_provider},
        fields=["name", "zone_code", "zone_label", "is_active"],
        order_by="zone_code",
    )


@frappe.whitelist(allow_guest=False)
def get_provider_summary(service_provider):
    """Quick stats: how many zones and countries are loaded for a provider."""
    zones = frappe.db.count("Rate Zone", {"service_provider": service_provider})
    slabs = frappe.db.sql(
        "SELECT COUNT(*) FROM `tabRate Slab` s "
        "JOIN `tabRate Zone` z ON z.name = s.parent "
        "WHERE z.service_provider = %s",
        service_provider,
    )[0][0]
    countries = frappe.db.count("Country Zone", {"service_provider": service_provider})
    logs = frappe.db.count("Rate Import Log", {"service_provider": service_provider})
    return {
        "zones": zones,
        "rate_slabs": slabs,
        "countries": countries,
        "import_logs": logs,
    }


# ─── PREVIEW IMPORT ──────────────────────────────────────────────────────────

@frappe.whitelist()
def preview_import(file_url, service_provider, import_type):
    """
    Parse an uploaded Excel file and return a preview without saving.
    Returns counts + per-row action (Create / Update / Skip) and any errors.
    """
    rows = _read_excel_rows(file_url)
    if not rows:
        frappe.throw(_("No data found in the uploaded file"))

    if import_type == "Zone Rates":
        return _preview_zone_rates(rows, service_provider)
    elif import_type == "Country Zones":
        return _preview_country_zones(rows, service_provider)
    else:
        frappe.throw(_(f"Unknown import type: {import_type}"))


def _preview_zone_rates(rows, service_provider):
    headers = [cstr(h).strip().lower() for h in rows[0]]
    _require_columns(headers, {"zone_code", "max_weight_kg", "rate"}, "Zone Rates")

    idx = {h: i for i, h in enumerate(headers)}
    zones = {}
    errors = []

    for r, row in enumerate(rows[1:], 2):
        try:
            zone_code = cstr(row[idx["zone_code"]]).strip()
            raw_wt = row[idx["max_weight_kg"]]
            raw_rate = row[idx["rate"]]

            if not zone_code:
                continue
            if raw_wt is None or cstr(raw_wt).strip() == "":
                continue

            max_weight = flt(raw_wt)
            rate = flt(raw_rate)
            label = cstr(row[idx["zone_label"]]).strip() if "zone_label" in idx else ""
            is_pkg = int(flt(row[idx["is_per_kg_above_max"]])) if "is_per_kg_above_max" in idx else 0

            # Allow is_per_kg_above_max row (max_weight_kg = 71, is_per_kg = 1)
            if max_weight <= 0 and not is_pkg:
                continue

            if zone_code not in zones:
                zones[zone_code] = {"zone_label": label, "slabs": [], "errors": []}
            zones[zone_code]["slabs"].append(
                {"max_weight_kg": max_weight, "rate": rate, "is_per_kg_above_max": is_pkg}
            )
        except Exception as exc:
            errors.append(f"Row {r}: {exc}")

    preview = []
    for zc, zd in zones.items():
        existing = frappe.db.get_value(
            "Rate Zone",
            {"service_provider": service_provider, "zone_code": zc},
            "name",
        )
        preview.append(
            {
                "zone_code": zc,
                "zone_label": zd["zone_label"] or f"Zone {zc}",
                "slab_count": len(zd["slabs"]),
                "action": "Update" if existing else "Create",
                "existing_name": existing or "",
            }
        )

    return {
        "import_type": "Zone Rates",
        "zones": len(zones),
        "total_slabs": sum(len(z["slabs"]) for z in zones.values()),
        "preview": sorted(preview, key=lambda x: x["zone_code"]),
        "errors": errors[:50],
    }


def _preview_country_zones(rows, service_provider):
    headers = [cstr(h).strip().lower() for h in rows[0]]
    _require_columns(headers, {"country_code", "country_name", "zone_code"}, "Country Zones")

    idx = {h: i for i, h in enumerate(headers)}
    preview = []
    errors = []

    for r, row in enumerate(rows[1:], 2):
        try:
            cc = cstr(row[idx["country_code"]]).strip().upper()
            cn = cstr(row[idx["country_name"]]).strip()
            zc = cstr(row[idx["zone_code"]]).strip()
            if not cc or not cn or not zc:
                continue

            zone_exists = bool(
                frappe.db.get_value(
                    "Rate Zone",
                    {"service_provider": service_provider, "zone_code": zc},
                    "name",
                )
            )
            existing = frappe.db.get_value(
                "Country Zone",
                {"service_provider": service_provider, "country_code": cc, "country_name": cn},
                "name",
            )
            preview.append(
                {
                    "country_code": cc,
                    "country_name": cn,
                    "zone_code": zc,
                    "zone_exists": zone_exists,
                    "action": "Update" if existing else "Create",
                }
            )
        except Exception as exc:
            errors.append(f"Row {r}: {exc}")

    zones_missing = sum(1 for p in preview if not p["zone_exists"])
    return {
        "import_type": "Country Zones",
        "countries": len(preview),
        "preview": preview[:300],
        "total": len(preview),
        "zones_missing": zones_missing,
        "errors": errors[:50],
        "warning": (
            f"{zones_missing} countries reference zone codes not yet imported. "
            "Import Zone Rates first."
            if zones_missing else ""
        ),
    }


# ─── EXECUTE IMPORT ──────────────────────────────────────────────────────────

@frappe.whitelist()
def execute_import(file_url, service_provider, import_type, mode="upsert", dry_run=False):
    """
    Read the Excel file and upsert / replace / skip Rate Zone / Country Zone records.

    Parameters
    ----------
    file_url        : Frappe file URL (public or private)
    service_provider: Service Provider doc name
    import_type     : "Zone Rates" | "Country Zones"
    mode            : "upsert"        – create new, update existing (default)
                      "replace"       – delete all then re-import fresh
                      "skip_existing" – only create, skip existing zones/countries
    dry_run         : True → validate and preview only, do NOT save anything
    """
    dry_run = dry_run in (True, "true", "True", 1, "1")
    mode = mode or "upsert"
    if mode not in ("upsert", "replace", "skip_existing"):
        frappe.throw(_(f"Invalid mode '{mode}'. Use: upsert, replace, or skip_existing"))

    rows = _read_excel_rows(file_url)
    if not rows:
        frappe.throw(_("No data found in the uploaded file"))

    # Create log entry (pending)
    log = frappe.new_doc("Rate Import Log")
    log.service_provider = service_provider
    log.import_type = import_type
    log.status = "Dry Run" if dry_run else "Processing"
    log.uploaded_file = file_url
    log.imported_by = frappe.session.user
    log.import_date = now_datetime()
    log.insert(ignore_permissions=True)
    frappe.db.commit()

    try:
        if import_type == "Zone Rates":
            result = _import_zone_rates(rows, service_provider, mode=mode, dry_run=dry_run)
        elif import_type == "Country Zones":
            result = _import_country_zones(rows, service_provider, mode=mode, dry_run=dry_run)
        else:
            frappe.throw(_(f"Unknown import type: {import_type}"))

        ok = result["created"] + result["updated"]
        if dry_run:
            status = "Dry Run"
        elif result["failed"] == 0:
            status = "Success"
        elif ok > 0:
            status = "Partial"
        else:
            status = "Failed"

        log.status = status
        log.rows_created = result["created"]
        log.rows_updated = result["updated"]
        log.rows_failed  = result["failed"]
        log.error_log    = "\n".join(result.get("errors", []))
        log.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": status,
            "log_id": log.name,
            "created": result["created"],
            "updated": result["updated"],
            "skipped": result.get("skipped", 0),
            "failed":  result["failed"],
            "dry_run": dry_run,
            "mode": mode,
            "errors": result.get("errors", [])[:20],
        }

    except Exception as exc:
        log.status = "Failed"
        log.error_log = str(exc)
        log.save(ignore_permissions=True)
        frappe.db.commit()
        raise


def _import_zone_rates(rows, service_provider, mode="upsert", dry_run=False):
    headers = [cstr(h).strip().lower() for h in rows[0]]
    _require_columns(headers, {"zone_code", "max_weight_kg", "rate"}, "Zone Rates")
    idx = {h: i for i, h in enumerate(headers)}

    # Group slabs by zone_code
    zones = {}
    errors = []
    for r, row in enumerate(rows[1:], 2):
        try:
            zc = cstr(row[idx.get("zone_code", 0)]).strip()
            raw_wt = row[idx.get("max_weight_kg", 1)]
            if not zc or raw_wt is None or cstr(raw_wt).strip() == "":
                continue
            mw = flt(raw_wt)
            rt = flt(row[idx.get("rate", 2)])
            label  = cstr(row[idx["zone_label"]]).strip() if "zone_label" in idx else ""
            is_pkg = int(flt(row[idx["is_per_kg_above_max"]])) if "is_per_kg_above_max" in idx else 0
            notes  = cstr(row[idx["notes"]]).strip() if "notes" in idx else ""

            if mw <= 0 and not is_pkg:
                continue

            if zc not in zones:
                zones[zc] = {"zone_label": label or f"Zone {zc}", "slabs": []}
            zones[zc]["slabs"].append({
                "max_weight_kg":      mw,
                "rate":               rt,
                "is_per_kg_above_max": is_pkg,
                "notes":              notes,
            })
        except Exception as exc:
            errors.append(f"Row {r}: {exc}")

    if dry_run:
        return {
            "created": sum(
                1 for zc in zones
                if not frappe.db.get_value("Rate Zone",
                    {"service_provider": service_provider, "zone_code": zc}, "name")
            ),
            "updated": sum(
                1 for zc in zones
                if frappe.db.get_value("Rate Zone",
                    {"service_provider": service_provider, "zone_code": zc}, "name")
            ),
            "skipped": 0, "failed": len(errors), "errors": errors,
        }

    # Replace mode: delete all existing zones for this provider first
    if mode == "replace":
        existing_zones = frappe.db.get_all(
            "Rate Zone", {"service_provider": service_provider}, "name"
        )
        for z in existing_zones:
            frappe.delete_doc("Rate Zone", z["name"], ignore_permissions=True, force=True)
        frappe.db.commit()

    created = updated = skipped = failed = 0

    for zc, zd in zones.items():
        try:
            existing = frappe.db.get_value(
                "Rate Zone",
                {"service_provider": service_provider, "zone_code": zc},
                "name",
            )

            if existing and mode == "skip_existing":
                skipped += 1
                continue

            if existing:
                doc = frappe.get_doc("Rate Zone", existing)
                doc.zone_label = zd["zone_label"]
                doc.rate_slabs = []
            else:
                doc = frappe.new_doc("Rate Zone")
                doc.service_provider = service_provider
                doc.zone_code  = zc
                doc.zone_label = zd["zone_label"]
                doc.is_active  = 1

            for s in sorted(zd["slabs"], key=lambda x: (x["is_per_kg_above_max"], x["max_weight_kg"])):
                doc.append("rate_slabs", s)

            if existing:
                doc.save(ignore_permissions=True)
                updated += 1
            else:
                doc.insert(ignore_permissions=True)
                created += 1

        except Exception as exc:
            failed += 1
            errors.append(f"Zone {zc}: {exc}")

    frappe.db.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "failed": failed, "errors": errors}


def _import_country_zones(rows, service_provider, mode="upsert", dry_run=False):
    headers = [cstr(h).strip().lower() for h in rows[0]]
    _require_columns(headers, {"country_code", "country_name", "zone_code"}, "Country Zones")
    idx = {h: i for i, h in enumerate(headers)}

    if dry_run:
        # Just count without saving
        will_create = will_update = 0
        for row in rows[1:]:
            cc = cstr(row[idx["country_code"]]).strip().upper()
            cn = cstr(row[idx["country_name"]]).strip()
            if not cc or not cn: continue
            ex = frappe.db.get_value(
                "Country Zone",
                {"service_provider": service_provider, "country_code": cc, "country_name": cn}, "name"
            )
            if ex: will_update += 1
            else:  will_create += 1
        return {"created": will_create, "updated": will_update, "skipped": 0, "failed": 0, "errors": []}

    # Replace mode
    if mode == "replace":
        frappe.db.sql(
            "DELETE FROM `tabCountry Zone` WHERE service_provider = %s",
            service_provider,
        )
        frappe.db.commit()

    created = updated = skipped = failed = 0
    errors = []

    for r, row in enumerate(rows[1:], 2):
        try:
            cc    = cstr(row[idx["country_code"]]).strip().upper()
            cn    = cstr(row[idx["country_name"]]).strip()
            zc    = cstr(row[idx["zone_code"]]).strip()
            notes = cstr(row[idx["notes"]]).strip() if "notes" in idx else ""
            if not cc or not cn or not zc:
                continue

            zone_name = (
                frappe.db.get_value(
                    "Rate Zone",
                    {"service_provider": service_provider, "zone_code": zc},
                    "name",
                ) or ""
            )

            existing = frappe.db.get_value(
                "Country Zone",
                {"service_provider": service_provider, "country_code": cc, "country_name": cn},
                "name",
            )

            if existing and mode == "skip_existing":
                skipped += 1
                continue

            if existing:
                frappe.db.set_value(
                    "Country Zone",
                    existing,
                    {"zone_code": zc, "shipping_zone": zone_name, "notes": notes},
                )
                updated += 1
            else:
                doc = frappe.new_doc("Country Zone")
                doc.service_provider = service_provider
                doc.country_code     = cc
                doc.country_name     = cn
                doc.zone_code        = zc
                doc.shipping_zone    = zone_name
                doc.notes            = notes
                doc.insert(ignore_permissions=True)
                created += 1

        except Exception as exc:
            failed += 1
            errors.append(f"Row {r}: {exc}")

    frappe.db.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "failed": failed, "errors": errors}


# ─── CLEAR PROVIDER DATA ──────────────────────────────────────────────────────

@frappe.whitelist()
def clear_provider_data(service_provider, confirm=False):
    """
    Delete ALL Rate Zones, Country Zones, and Import Logs for a service provider.
    Requires confirm=True to proceed (safety guard).
    Returns counts of deleted records.
    """
    confirm = confirm in (True, "true", "True", 1, "1")
    if not confirm:
        # Preview only — return counts without deleting
        zone_names = frappe.db.get_all("Rate Zone", {"service_provider": service_provider}, "name")
        zone_slabs = 0
        for z in zone_names:
            zone_slabs += frappe.db.count("Rate Slab", {"parent": z["name"]})
        return {
            "confirmed": False,
            "zones":         len(zone_names),
            "zone_slabs":    zone_slabs,
            "country_zones": frappe.db.count("Country Zone", {"service_provider": service_provider}),
            "import_logs":   frappe.db.count("Rate Import Log", {"service_provider": service_provider}),
        }

    deleted_zones = deleted_countries = deleted_logs = 0

    # Delete zones (cascades rate_slabs child table)
    zone_names = frappe.db.get_all(
        "Rate Zone", {"service_provider": service_provider}, "name"
    )
    for z in zone_names:
        frappe.delete_doc("Rate Zone", z["name"], ignore_permissions=True, force=True)
        deleted_zones += 1

    # Delete country zones
    country_names = frappe.db.get_all(
        "Country Zone", {"service_provider": service_provider}, "name"
    )
    for c in country_names:
        frappe.delete_doc("Country Zone", c["name"], ignore_permissions=True, force=True)
        deleted_countries += 1

    # Delete import logs
    log_names = frappe.db.get_all(
        "Rate Import Log", {"service_provider": service_provider}, "name"
    )
    for l in log_names:
        frappe.delete_doc("Rate Import Log", l["name"], ignore_permissions=True, force=True)
        deleted_logs += 1

    frappe.db.commit()
    return {
        "confirmed":     True,
        "zones":         deleted_zones,
        "country_zones": deleted_countries,
        "import_logs":   deleted_logs,
    }


# ─── RATE ADJUSTMENT ─────────────────────────────────────────────────────────

@frappe.whitelist()
def preview_rate_adjustment(service_provider, zone_codes, adjustment_type, adjustment_value, direction):
    """
    Returns a before/after preview of rate changes without saving.
    zone_codes: JSON list of zone_code strings, or ["all"] for all zones.
    adjustment_type: "Percentage" | "Fixed Amount"
    direction: "increase" | "decrease"
    """
    if isinstance(zone_codes, str):
        zone_codes = json.loads(zone_codes)
    val = flt(adjustment_value)
    if val <= 0:
        frappe.throw(_("Adjustment value must be > 0"))

    zones = _get_zones_for_adjustment(service_provider, zone_codes)
    preview_rows = []

    for z in zones:
        doc = frappe.get_doc("Rate Zone", z["name"])
        for slab in doc.rate_slabs:
            old = flt(slab.rate)
            new = _apply_adjustment(old, adjustment_type, val, direction)
            preview_rows.append(
                {
                    "zone_code":     z["zone_code"],
                    "zone_label":    z.get("zone_label") or "",
                    "max_weight_kg": flt(slab.max_weight_kg),
                    "old_rate":      round(old, 3),
                    "new_rate":      round(new, 3),
                    "change":        round(new - old, 3),
                    "is_per_kg":     int(slab.is_per_kg_above_max),
                }
            )

    return {
        "zones_affected":  len(zones),
        "slabs_affected":  len(preview_rows),
        "preview":         preview_rows[:300],
    }


@frappe.whitelist()
def apply_rate_adjustment(service_provider, zone_codes, adjustment_type, adjustment_value, direction):
    """Apply rate adjustment to selected zones. Permanently updates rate slabs."""
    if isinstance(zone_codes, str):
        zone_codes = json.loads(zone_codes)
    val = flt(adjustment_value)
    if val <= 0:
        frappe.throw(_("Adjustment value must be > 0"))

    zones = _get_zones_for_adjustment(service_provider, zone_codes)
    slabs_updated = 0

    for z in zones:
        doc = frappe.get_doc("Rate Zone", z["name"])
        for slab in doc.rate_slabs:
            slab.rate = round(_apply_adjustment(flt(slab.rate), adjustment_type, val, direction), 3)
            slabs_updated += 1
        doc.save(ignore_permissions=True)

    frappe.db.commit()
    return {
        "status":        "ok",
        "zones_updated": len(zones),
        "slabs_updated": slabs_updated,
    }


def _get_zones_for_adjustment(service_provider, zone_codes):
    filters = {"service_provider": service_provider, "is_active": 1}
    if zone_codes and zone_codes != ["all"] and "all" not in zone_codes:
        filters["zone_code"] = ["in", zone_codes]
    return frappe.db.get_all(
        "Rate Zone",
        filters=filters,
        fields=["name", "zone_code", "zone_label"],
    )


def _apply_adjustment(rate, adjustment_type, value, direction):
    sign = 1 if direction == "increase" else -1
    if adjustment_type == "Percentage":
        return rate * (1 + sign * value / 100)
    else:
        return max(0.0, rate + sign * value)


# ─── IMPORT HISTORY ──────────────────────────────────────────────────────────

@frappe.whitelist()
def get_import_history(service_provider=None, limit=50):
    filters = {}
    if service_provider:
        filters["service_provider"] = service_provider
    return frappe.db.get_all(
        "Rate Import Log",
        filters=filters,
        fields=[
            "name", "service_provider", "import_type", "status",
            "rows_created", "rows_updated", "rows_failed",
            "import_date", "imported_by", "uploaded_file",
        ],
        order_by="import_date desc",
        limit=int(limit),
    )


# ─── PUBLIC RATE LOOKUP ───────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_rate(country, weight, service_provider):
    """
    Public rate-lookup API supporting multiple service providers.
    Parameters:
        country          – Country name OR 2-letter ISO code
        weight           – Weight in KG
        service_provider – Service Provider name or provider_code (e.g. AAA)
    """
    from courier_app.shipping_rates import get_shipping_rate
    return get_shipping_rate(country=country, weight=weight, service_provider=service_provider)


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _read_excel_rows(file_url):
    """Read all non-empty rows from the first sheet of an Excel file."""
    try:
        import openpyxl
    except ImportError:
        frappe.throw(_("openpyxl is required. Run: pip install openpyxl"))

    site_path = frappe.utils.get_site_path()
    file_name = os.path.basename(file_url.split("?")[0])

    if "/private/" in file_url:
        path = os.path.join(site_path, "private", "files", file_name)
    else:
        path = os.path.join(site_path, "public", "files", file_name)

    if not os.path.exists(path):
        frappe.throw(_(f"File not found on server: {file_name}. "
                       "Upload via Files or use a full-path URL."))

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = [
        list(row) for row in ws.iter_rows(values_only=True)
        if any(c is not None and cstr(c).strip() != "" for c in row)
    ]
    wb.close()
    return rows


def _require_columns(headers, required, import_type):
    missing = required - set(headers)
    if missing:
        frappe.throw(
            _("{0} file is missing required columns: {1}. Got: {2}").format(
                import_type,
                ", ".join(sorted(missing)),
                ", ".join(headers),
            )
        )
