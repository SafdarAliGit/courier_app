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
        "service":              data.get("service"),
        "packaging_type":       data.get("packaging_type", "Your Packaging"),
        "sender_name":          data.get("sender_name"),
        "sender_company":       data.get("sender_company"),
        "sender_phone":         data.get("sender_phone"),
        "sender_email":         data.get("sender_email"),
        "sender_address_line1": data.get("sender_address_line1"),
        "sender_address_line2": data.get("sender_address_line2"),
        "sender_city":          data.get("sender_city"),
        "sender_country":       data.get("sender_country"),
        "sender_zip":           data.get("sender_zip"),
        "recipient_name":       data.get("recipient_name"),
        "recipient_company":    data.get("recipient_company"),
        "recipient_phone":      data.get("recipient_phone"),
        "recipient_email":      data.get("recipient_email"),
        "recipient_address_line1": data.get("recipient_address_line1"),
        "recipient_address_line2": data.get("recipient_address_line2"),
        "recipient_city":       data.get("recipient_city"),
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
        # Store logged-in user email for my-shipments lookup; fall back to sender email for guests
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
            s.service, s.tracking_number, s.recipient_name,
            s.recipient_country, s.recipient_city,
            s.total_weight, s.calculated_rate,
            s.estimated_delivery, s.submitted_by_portal,
            s.customer, s.sales_order,
            s.docstatus, s.creation
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
