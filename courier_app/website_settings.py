import re
import frappe
from frappe.utils import getdate, today
import datetime


def _get_header():
    try:
        return frappe.get_single("Website Header Settings")
    except Exception:
        return frappe._dict()


def _get_footer():
    try:
        return frappe.get_single("Website Footer Settings")
    except Exception:
        return frappe._dict()


def _get_home():
    try:
        return frappe.get_single("Website Home Page")
    except Exception:
        return frappe._dict()


def _get_about():
    try:
        return frappe.get_single("Website About Page")
    except Exception:
        return frappe._dict()


def _get_contact():
    try:
        return frappe.get_single("Website Contact Page")
    except Exception:
        return frappe._dict()


def _get_carousel():
    try:
        return frappe.get_single("Website Carousel")
    except Exception:
        return frappe._dict()


def _calc_years(founded_date, fallback=20):
    if not founded_date:
        return fallback
    try:
        start = getdate(founded_date)
        today_date = getdate(today())
        years = today_date.year - start.year
        if (today_date.month, today_date.day) < (start.month, start.day):
            years -= 1
        return max(years, 1)
    except Exception:
        return fallback


def _fmt(n):
    """Format a count as '1,234+' string."""
    return f"{n:,}+"


def _sub_stats(text, years, customers, countries, cities, shipments, company=""):
    """Replace tokens AND smart-replace hardcoded numbers in known keyword contexts.
    Numbers are only replaced when the live count is > 0, so manually entered
    fallback values in the doctype are preserved until real data exists."""
    # Token substitution — both {{var}} and {var} forms are supported
    text = (text
        .replace("{{years}}", str(years))
        .replace("{{customers}}", str(customers))
        .replace("{{countries}}", str(countries))
        .replace("{{cities}}", str(cities))
        .replace("{{shipments}}", str(shipments))
        .replace("{{company}}", company)
        .replace("{years}", str(years))
        .replace("{customers}", str(customers))
        .replace("{countries}", str(countries))
        .replace("{cities}", str(cities))
        .replace("{shipments}", str(shipments))
        .replace("{company}", company)
    )
    # Smart company-name replacement — replace hardcoded name before "specialises/specializes in"
    if company:
        text = re.sub(
            r'([,;]\s+)((?:\w+\s+){1,5}\w+)(?=\s+specialises?\s+in\b)',
            lambda m: m.group(1) + company,
            text, flags=re.IGNORECASE
        )
    # Smart pattern replacement — only when live count > 0
    if years > 0:
        text = re.sub(r'\b\d[\d,]*\b(?=\+?\s+years?\b)', str(years), text, flags=re.IGNORECASE)
    if customers > 0:
        text = re.sub(r'\b\d[\d,]*\b(?=\+?\s+(?:businesses?|clients?|customers?)\b)', str(customers), text, flags=re.IGNORECASE)
    if countries > 0:
        text = re.sub(r'\b\d[\d,]*\b(?=\+?\s+countries?\b)', str(countries), text, flags=re.IGNORECASE)
    if cities > 0:
        text = re.sub(r'\b\d[\d,]*\b(?=\+?\s+(?:\w+\s+){0,2}(?:cities?|destinations?|locations?)\b)', str(cities), text, flags=re.IGNORECASE)
    if shipments > 0:
        text = re.sub(r'\b\d[\d,]*\b(?=\+?\s+(?:shipments?|packages?|deliveries|orders?)\b)', str(shipments), text, flags=re.IGNORECASE)
    return text


def _live_stats():
    """Return live counts from DB for the four website stats."""
    try:
        shipments = frappe.db.count("Courier Shipment") or 0
    except Exception:
        shipments = 0
    try:
        customers = frappe.db.count("Customer") or 0
    except Exception:
        customers = 0
    try:
        countries = frappe.db.count("Country Zone") or 0
    except Exception:
        countries = 0
    try:
        cities = frappe.db.count("City") or 0
    except Exception:
        cities = 0
    return shipments, customers, countries, cities


def get_website_context(active_page=""):
    hdr = _get_header()
    ftr = _get_footer()
    hp  = _get_home()
    ab  = _get_about()
    cp  = _get_contact()
    cr  = _get_carousel()

    # Company name / logo from ERPNext Company
    company = (frappe.db.get_single_value("Global Defaults", "default_company") or
               getattr(hdr, "company_name", "") or "")
    company_logo = (frappe.db.get_value("Company", company, "company_logo") or "") if company else ""

    # ── Stats: doctype fields are the primary source for all {{variables}} ───
    # Live DB counts are only used when the doctype field is left at 0.
    _db_shipments, _db_customers, _db_countries, _db_cities = _live_stats()
    founded_date = getattr(hdr, "company_founded_date", None)

    customers_count = int(getattr(hp, "stat_clients_count",   0) or 0) or _db_customers
    shipments_count = int(getattr(hp, "stat_packages_count",  0) or 0) or _db_shipments
    countries_count = int(getattr(hp, "stat_countries_count", 0) or 0) or _db_countries
    cities_count    = int(getattr(hp, "stat_cities_count",    0) or 0) or _db_cities
    years_int       = int(getattr(hp, "stat_years_count",     0) or 0) or _calc_years(founded_date, fallback=20)
    years_display   = f"{years_int}+"

    # ── Contact info (resolved early so _ss can embed them as variables) ──
    _contact_email   = getattr(hdr, "contact_email", "") or getattr(cp, "contact_email", "") or "info@aaagloballogistics.co.uk"
    _contact_phone   = getattr(hdr, "contact_phone", "") or getattr(cp, "contact_phone", "") or "+92 319 6496468"
    _contact_address = (
        getattr(cp, "contact_address", "") or
        getattr(ftr, "contact_address", "") or
        "Office # 1,2,11 Ground Floor, Rafiq Plaza 8, Davis Road, Lahore, Pakistan"
    )

    # ── _ss(): full variable substitution used on every text field ─────────
    def _ss(t):
        t = _sub_stats(t, years_int, customers_count, countries_count, cities_count, shipments_count, company)
        return (t
            .replace("{{email}}", _contact_email)
            .replace("{{phone}}", _contact_phone)
            .replace("{{address}}", _contact_address)
            .replace("{email}", _contact_email)
            .replace("{phone}", _contact_phone)
            .replace("{address}", _contact_address)
        )

    src = getattr(hp, "services", None) or []
    if src:
        services = [{"icon": r.icon, "title": _ss(r.title), "desc": _ss(r.description)} for r in src]
    else:
        services = [
            {"icon": "support", "title": "24/7 Business Support",  "desc": "Round-the-clock operational support so your shipments never stop moving."},
            {"icon": "secure",  "title": "Secure Transportation",   "desc": "Every package handled with care — fully insured and monitored end to end."},
            {"icon": "global",  "title": "Worldwide Operations",    "desc": _ss("International logistics capabilities connecting you to 40+ destinations globally.")},
            {"icon": "resolve", "title": "Fast Problem Resolution", "desc": "Dedicated support team that analyses and resolves issues swiftly."},
        ]

    # ── Testimonials list ──────────────────────────────────────────────────
    src_t = getattr(hp, "testimonials", None) or []
    if src_t:
        testimonials = [{"name": r.client_name, "role": r.role, "text": r.testimonial_text} for r in src_t]
    else:
        testimonials = [
            {"name": "Sikandar Saeed",      "role": "Business Owner",     "text": "Excellent service and perfectly timed deliveries every time. Highly recommended for any business needing reliable logistics."},
            {"name": "Saad Tariq",          "role": "Import Trader",      "text": "Professional team, great rates and outstanding reliability. My shipments always arrive on time and in perfect condition."},
            {"name": "Muhammad Abid",       "role": "CEO, TechExport",    "text": "The best logistics partner we have ever worked with. Their tracking system gives us complete peace of mind."},
            {"name": "Syed Saif Ur Rehman", "role": "Operations Manager", "text": "Consistent quality and exceptional customer service. They truly go above and beyond to keep us informed at every step."},
        ]

    # ── Footer link columns ────────────────────────────────────────────────
    footer_col1_title = getattr(ftr, "col1_title", "") or "Company"
    footer_col1_links = [{"label": r.label, "url": r.url} for r in (getattr(ftr, "col1_links", None) or [])]
    footer_col2_title = getattr(ftr, "col2_title", "") or "Services"
    footer_col2_links = [{"label": r.label, "url": r.url} for r in (getattr(ftr, "col2_links", None) or [])]
    footer_contact_title = getattr(ftr, "contact_title", "") or "Get in Touch"
    footer_bottom_links  = [{"label": r.label, "url": r.url} for r in (getattr(ftr, "bottom_links", None) or [])]

    # Fallbacks when DB not yet seeded
    if not footer_col1_links:
        footer_col1_links = [{"label": "Home", "url": "/"}, {"label": "About Us", "url": "/about"}, {"label": "Contact Us", "url": "/contact"}]
    if not footer_col2_links:
        footer_col2_links = [{"label": "Create Shipment", "url": "/shipment"}, {"label": "Track Package", "url": "/track"}, {"label": "Rate Calculator", "url": "/rates"}]
    if not footer_bottom_links:
        footer_bottom_links = [{"label": "About", "url": "/about"}, {"label": "Contact", "url": "/contact"}, {"label": "Rates", "url": "/rates"}]

    currency = (frappe.db.get_value("Company", company, "default_currency") or
                frappe.db.get_single_value("Global Defaults", "default_currency") or "PKR")

    is_system_user = (
        frappe.session.user != "Guest" and
        frappe.db.get_value("User", frappe.session.user, "user_type") == "System User"
    )

    ctx = frappe._dict(
        company_name    = company,
        is_system_user  = is_system_user,
        company_logo    = company_logo,
        active_page     = active_page,
        currency        = currency,

        company_tagline = _ss(getattr(ftr, "company_tagline", "") or "Moving goods, powering growth, and ensuring every shipment counts."),
        company_sub     = "Delivering Reliability. Driving Logistics Excellence.",

        hero_headline   = _ss(getattr(hp, "hero_headline", "") or "Delivering your cargo Safely and on time worldwide"),
        hero_sub        = _ss(getattr(hp, "hero_sub", "") or "We ensure the safe and timely delivery of your cargo through dependable logistics services that you can rely on."),
        hero_badge_text = _ss(getattr(hp, "hero_badge_text", "") or "Trusted Global Logistics Partner"),
        hero_btn1_text  = getattr(hp, "hero_btn1_text", "") or "Get a Quote",
        hero_btn2_text  = getattr(hp, "hero_btn2_text", "") or "Track Shipment",

        contact_email   = _contact_email,
        contact_phone   = _contact_phone,
        contact_address = _contact_address,

        # Stats — doctype value if set, else live DB count
        stat_packages   = _ss(getattr(hp, "stat_packages", "") or _fmt(shipments_count)),
        stat_clients    = _ss(getattr(hp, "stat_clients", "")  or _fmt(customers_count)),
        stat_countries  = _ss(getattr(hp, "stat_countries", "") or _fmt(countries_count)),
        stat_years      = _ss((_v if (_v := (getattr(hp, "stat_years", "") or "").strip()) not in ("", "0") else "") or years_display),

        stat_packages_count  = getattr(hp, "stat_packages_count", 0) or shipments_count,
        stat_clients_count   = getattr(hp, "stat_clients_count", 0)  or customers_count,
        stat_countries_count = getattr(hp, "stat_countries_count", 0) or countries_count,
        stat_years_count     = years_int,

        stat_packages_label  = getattr(hp, "stat_packages_label", "") or "Delivered Packages",
        stat_clients_label   = getattr(hp, "stat_clients_label", "") or "Happy Clients",
        stat_countries_label = getattr(hp, "stat_countries_label", "") or "Countries Served",
        stat_years_label     = getattr(hp, "stat_years_label", "") or "Years Experience",

        # About / badge — years_display used for badge and inline text
        cities_count      = cities_count,
        about_image       = getattr(hp, "about_image", "") or "/assets/courier_app/images/about_home.png",
        about_badge_num   = _ss(getattr(hp, "about_badge_num", "") or years_display),
        about_badge_label = getattr(hp, "about_badge_label", "") or "Years of Excellence",
        about_headline    = _ss(getattr(hp, "about_headline", "") or getattr(ab, "overview_headline", "") or "Your Trusted Global Logistics Partner"),
        about_text        = _ss(
            getattr(hp, "about_text", "") or getattr(ab, "overview_text", "") or
            "With over {years} years in the logistics industry, {company} specialises in "
            "streamlining supply chains through strategic planning, reliable transportation, and "
            "customer-focused service delivery. We transport more than just goods — we transport trust."
        ),

        about_mission = _ss(getattr(ab, "mission_text", "") or "To deliver every shipment safely, on time, and at the best value — building lasting partnerships through transparency and reliability."),
        about_vision  = _ss(getattr(ab, "vision_text", "")  or "To become the leading logistics partner for businesses across Pakistan and the UK, connecting markets with speed, precision, and care."),

        facebook_url  = getattr(hdr, "facebook_url", "") or "",
        linkedin_url  = getattr(hdr, "linkedin_url", "") or "",
        twitter_url   = getattr(hdr, "twitter_url", "")  or "",

        services     = services,
        testimonials = testimonials,

        years_int     = years_int,
        years_display = years_display,

        cta_title     = _ss(getattr(hp, "cta_title", "") or "Ready to ship with confidence?"),
        cta_text      = _ss(getattr(hp, "cta_text", "")  or "Join hundreds of businesses that trust {{company}} to deliver their cargo safely and on time, every time."),
        cta_btn1_text = getattr(hp, "cta_btn1_text", "") or "Create Shipment",
        cta_btn2_text = getattr(hp, "cta_btn2_text", "") or "Request a Call Back",

        footer_col1_title    = footer_col1_title,
        footer_col1_links    = footer_col1_links,
        footer_col2_title    = footer_col2_title,
        footer_col2_links    = footer_col2_links,
        footer_contact_title = footer_contact_title,
        footer_bottom_links  = footer_bottom_links,
        developer_name       = getattr(ftr, "developer_name", "") or "",
        developer_phone      = getattr(ftr, "developer_phone", "") or "",
        developer_url        = getattr(ftr, "developer_url", "") or "",

        # ── Home page section labels ───────────────────────────────────────
        about_section_label        = getattr(hp, "about_section_label", "") or "Who We Are",
        about_btn1_text            = getattr(hp, "about_btn1_text", "") or "Read More About Us",
        about_btn2_text            = getattr(hp, "about_btn2_text", "") or "Get in Touch",
        services_section_label     = getattr(hp, "services_section_label", "") or "Our Services",
        testimonials_section_label = getattr(hp, "testimonials_section_label", "") or "Client Testimonials",

        # ── About page — overview ──────────────────────────────────────────
        about_image_about  = getattr(ab, "about_image", "") or "",
        overview_section_label = getattr(ab, "overview_section_label", "") or "Our Story",
        overview_headline      = _ss(getattr(ab, "overview_headline", "") or ""),
        overview_text          = _ss(
            getattr(ab, "overview_text", "") or
            "With over {{years}} years in the logistics industry, {{company}} specialises in "
            "streamlining supply chains through strategic planning, reliable transportation, and "
            "customer-focused service delivery. We transport more than just goods — we transport trust."
        ),
        overview_checklist     = [
            _sub_stats(r.item_text, years_int, customers_count, countries_count, cities_count, shipments_count, company)
            for r in (getattr(ab, "overview_checklist", None) or [])
        ] or [
            f"Over {years_int} years of logistics expertise",
            f"Trusted by {customers_count}+ businesses worldwide",
            f"Coverage across {countries_count}+ countries globally",
        ],

        # ── About page — mission & vision ──────────────────────────────────
        mv_section_label  = getattr(ab, "mv_section_label", "") or "Mission & Vision",
        mv_section_title  = _ss(getattr(ab, "mv_section_title", "") or "Our guiding principles"),
        mission_title     = _ss(getattr(ab, "mission_title", "") or "Delivering with Purpose"),
        mission_card_label = getattr(ab, "mission_card_label", "") or "Our Mission",
        vision_title      = _ss(getattr(ab, "vision_title", "") or "Leading the Future of Logistics"),
        vision_card_label = getattr(ab, "vision_card_label", "") or "Our Vision",

        # ── About page — services ──────────────────────────────────────────
        ab_services_section_label = getattr(ab, "services_section_label", "") or "What We Offer",
        ab_services_section_title = _ss(getattr(ab, "services_section_title", "") or "Our core services"),
        ab_services_section_sub   = _ss(getattr(ab, "services_section_sub", "") or "End-to-end logistics solutions designed to move your business forward."),
        ab_services               = [{"icon": r.icon, "title": _ss(r.title), "desc": _ss(r.description)} for r in (getattr(ab, "services", None) or [])],

        # ── About page — values ────────────────────────────────────────────
        values_section_label = getattr(ab, "values_section_label", "") or "Our Values",
        values_section_title = _ss(getattr(ab, "values_section_title", "") or "The principles that drive us"),
        values               = [{"title": _ss(r.title), "desc": _ss(r.description)} for r in (getattr(ab, "values", None) or [])],

        # ── About page — CTA ──────────────────────────────────────────────
        about_cta_title    = _ss(getattr(ab, "cta_title", "") or "Partner with {{company}} today"),
        about_cta_text     = _ss(getattr(ab, "cta_text", "") or "Experience logistics done right. Contact our team to discuss your shipping needs and get a tailored quote."),
        about_cta_btn1_text = getattr(ab, "cta_btn1_text", "") or "Contact Us",
        about_cta_btn2_text = getattr(ab, "cta_btn2_text", "") or "Calculate Rates",

        # ── Home page — checklist, features, testimonials details ──────────
        about_checklist    = [_ss(r.item_text) for r in (getattr(hp, "about_checklist", None) or [])],
        features           = [{"title": _ss(r.title), "desc": _ss(r.description)} for r in (getattr(hp, "features", None) or [])],
        testimonials_title = _ss(getattr(hp, "testimonials_title", "") or "What our clients say"),
        testimonials_sub   = _ss(getattr(hp, "testimonials_sub", "") or ""),
        services_section_title = _ss(getattr(hp, "services_section_title", "") or "Fast & Reliable Solutions"),
        services_section_sub   = _ss(getattr(hp, "services_section_sub", "") or "Driven by reliability, powered by experience, and focused on your business success."),

        features_section_label = getattr(hp, "features_section_label", "") or "What We Offer",
        features_section_title = getattr(hp, "features_section_title", "") or "Fast & Reliable Solutions",
        features_section_sub   = _ss(getattr(hp, "features_section_sub", "") or ""),

        # ── Contact page ───────────────────────────────────────────────────
        page_hero_title      = _ss(getattr(cp, "page_hero_title", "") or "Get in Touch"),
        page_hero_subtitle   = _ss(
            getattr(ab, "page_hero_subtitle", "") or ""
            if active_page == "about"
            else getattr(cp, "page_hero_subtitle", "") or "Have a question or need a quote? Our team is ready to help."
        ),
        phone_note           = getattr(cp, "phone_note", "") or "Available 24/7 for urgent enquiries",
        email_note           = getattr(cp, "email_note", "") or "We reply within 2 business hours",
        business_hours       = getattr(cp, "business_hours", "") or "Monday – Saturday\n9:00 AM – 6:00 PM (PKT)",
        form_title           = getattr(cp, "form_title", "") or "Send us a message",
        form_subtitle        = getattr(cp, "form_subtitle", "") or "Fill in the form below and we'll get back to you as soon as possible.",
        contact_cta_title    = _ss(getattr(cp, "cta_title", "") or "Need a quick rate estimate?"),
        contact_cta_text     = _ss(getattr(cp, "cta_text", "") or "Use our instant rate calculator to get pricing for your destination and parcel weight — no registration needed."),
        contact_cta_btn1_text = getattr(cp, "cta_btn1_text", "") or "Calculate Rates",
        contact_cta_btn2_text = getattr(cp, "cta_btn2_text", "") or "Book a Shipment",
        map_lat               = getattr(cp, "map_latitude", None) or None,
        map_lon               = getattr(cp, "map_longitude", None) or None,

        # ── Carousel ───────────────────────────────────────────────────────
        carousel_slides   = [
            {
                "image":   r.slide_image,
                "label":   r.slide_label or "",
                "title":   r.slide_title or "",
                "caption": r.slide_caption or "",
            }
            for r in (getattr(cr, "slides", None) or [])
            if getattr(r, "is_enabled", 1) and getattr(r, "slide_image", "")
        ],
        carousel_interval = getattr(cr, "interval", 0) or 4000,
        carousel_autoplay = int(getattr(cr, "auto_play", 1) or 1),
    )

    return ctx
