import frappe
from frappe.utils import getdate, today


def _calc_years(founded_date, fallback=20):
    """Return integer years since founded_date, or fallback if not set."""
    if not founded_date:
        return fallback
    try:
        start = getdate(founded_date)
        today_date = getdate(today())
        years = today_date.year - start.year
        if (today_date.month, today_date.day) < (start.month, start.day):
            years -= 1
        return max(years, 0)
    except Exception:
        return fallback


@frappe.whitelist(allow_guest=True)
def get_header_data():
    """Fetch header/nav data from Website Header Settings."""
    try:
        d = frappe.get_single("Website Header Settings")
        years_int = _calc_years(d.company_founded_date, fallback=20)
        return {
            "company_name":        d.company_name or "",
            "company_logo":        d.company_logo or "",
            "contact_email":       d.contact_email or "",
            "contact_phone":       d.contact_phone or "",
            "facebook_url":        d.facebook_url or "#",
            "linkedin_url":        d.linkedin_url or "#",
            "twitter_url":         d.twitter_url or "#",
            "company_founded_date": str(d.company_founded_date or ""),
            "years_of_service":    years_int,
            "years_display":       f"{years_int}+",
        }
    except Exception:
        return {}


@frappe.whitelist(allow_guest=True)
def get_footer_data():
    """Fetch full footer data including dynamic link columns."""
    try:
        hdr = frappe.get_single("Website Header Settings")
        ftr = frappe.get_single("Website Footer Settings")
        return {
            "company_name":    hdr.company_name or "",
            "company_logo":    hdr.company_logo or "",
            "company_tagline": ftr.company_tagline or "",
            "contact_email":   hdr.contact_email or "",
            "contact_phone":   hdr.contact_phone or "",
            "contact_address": ftr.contact_address or "",
            "facebook_url":    hdr.facebook_url or "#",
            "linkedin_url":    hdr.linkedin_url or "#",
            "twitter_url":     hdr.twitter_url or "#",
            "col1_title":      ftr.col1_title or "Company",
            "col1_links":      [{"label": r.label, "url": r.url} for r in (ftr.col1_links or [])],
            "col2_title":      ftr.col2_title or "Services",
            "col2_links":      [{"label": r.label, "url": r.url} for r in (ftr.col2_links or [])],
            "contact_title":   ftr.contact_title or "Get in Touch",
            "bottom_links":    [{"label": r.label, "url": r.url} for r in (ftr.bottom_links or [])],
            "developer_name":  ftr.developer_name or "",
            "developer_phone": ftr.developer_phone or "",
            "developer_url":   ftr.developer_url or "",
        }
    except Exception:
        return {}


@frappe.whitelist(allow_guest=True)
def get_home_page_data():
    """Fetch all Home Page content with dynamic years calculation."""
    try:
        hdr = frappe.get_single("Website Header Settings")
        ftr = frappe.get_single("Website Footer Settings")
        hp  = frappe.get_single("Website Home Page")

        years_int     = _calc_years(hdr.company_founded_date, fallback=20)
        years_display = f"{years_int}+"

        return {
            "company_name":    hdr.company_name or "",
            "company_logo":    hdr.company_logo or "",
            "contact_email":   hdr.contact_email or "",
            "contact_phone":   hdr.contact_phone or "",
            "contact_address": ftr.contact_address or "",
            "company_tagline": ftr.company_tagline or "",
            "facebook_url":    hdr.facebook_url or "#",
            "linkedin_url":    hdr.linkedin_url or "#",
            "twitter_url":     hdr.twitter_url or "#",

            "hero_badge_text": hp.hero_badge_text or "Trusted Global Logistics Partner",
            "hero_headline":   hp.hero_headline or "",
            "hero_sub":        hp.hero_sub or "",
            "hero_btn1_text":  hp.hero_btn1_text or "Get a Quote",
            "hero_btn2_text":  hp.hero_btn2_text or "Track Shipment",

            # Stats — years_* always computed from founded date
            "stat_packages":       hp.stat_packages or "5,000+",
            "stat_packages_label": hp.stat_packages_label or "Packages Delivered",
            "stat_clients":        hp.stat_clients or "200+",
            "stat_clients_label":  hp.stat_clients_label or "Happy Clients",
            "stat_countries":      hp.stat_countries or "40+",
            "stat_countries_label": hp.stat_countries_label or "Countries Served",
            "stat_years":          hp.stat_years or years_display,
            "stat_years_label":    hp.stat_years_label or "Years Experience",
            "stat_packages_count":  hp.stat_packages_count or 5000,
            "stat_clients_count":   hp.stat_clients_count or 200,
            "stat_countries_count": hp.stat_countries_count or 40,
            "stat_years_count":     years_int,

            # About / badge
            "about_badge_num":   years_display,
            "about_badge_label": hp.about_badge_label or "Years of Excellence",
            "about_headline":    hp.about_headline or "",
            "about_text":        hp.about_text or "",
            "about_checklist":   [r.item_text for r in (hp.about_checklist or [])],

            # Services
            "services_section_title": hp.services_section_title or "",
            "services_section_sub":   hp.services_section_sub or "",
            "services": [{"icon": r.icon, "title": r.title, "desc": r.description}
                         for r in (hp.services or [])],

            # Features strip
            "features": [{"title": r.title, "desc": r.description}
                         for r in (hp.features or [])],

            # Testimonials
            "testimonials_title": hp.testimonials_title or "What our clients say",
            "testimonials_sub":   hp.testimonials_sub or "",
            "testimonials": [{"name": r.client_name, "role": r.role, "text": r.testimonial_text}
                             for r in (hp.testimonials or [])],

            # CTA
            "cta_title":     hp.cta_title or "",
            "cta_text":      hp.cta_text or "",
            "cta_btn1_text": hp.cta_btn1_text or "Create Shipment",
            "cta_btn2_text": hp.cta_btn2_text or "Request a Call Back",

            "years_of_service": years_int,
            "years_display":    years_display,
        }
    except Exception as e:
        return {"error": str(e)}


@frappe.whitelist(allow_guest=True)
def get_about_page_data():
    """Fetch About Page content with dynamic years calculation."""
    try:
        hdr = frappe.get_single("Website Header Settings")
        ftr = frappe.get_single("Website Footer Settings")
        ab  = frappe.get_single("Website About Page")
        hp  = frappe.get_single("Website Home Page")

        years_int     = _calc_years(hdr.company_founded_date, fallback=20)
        years_display = f"{years_int}+"

        return {
            "company_name":    hdr.company_name or "",
            "company_logo":    hdr.company_logo or "",
            "contact_email":   hdr.contact_email or "",
            "contact_phone":   hdr.contact_phone or "",
            "contact_address": ftr.contact_address or "",
            "company_tagline": ftr.company_tagline or "",
            "facebook_url":    hdr.facebook_url or "#",
            "linkedin_url":    hdr.linkedin_url or "#",
            "twitter_url":     hdr.twitter_url or "#",

            "page_hero_subtitle": ab.page_hero_subtitle or "",

            # Overview — badge uses dynamic years
            "overview_headline":   ab.overview_headline or "",
            "overview_text":       ab.overview_text or "",
            "overview_badge_num":  years_display,
            "overview_badge_label": ab.overview_badge_label or "Years of Excellence",
            "overview_checklist":  [r.item_text for r in (ab.overview_checklist or [])],

            # Mission & Vision
            "mission_title": ab.mission_title or "Delivering with Purpose",
            "mission_text":  ab.mission_text or "",
            "vision_title":  ab.vision_title or "Leading the Future of Logistics",
            "vision_text":   ab.vision_text or "",

            # Services
            "services": [{"icon": r.icon, "title": r.title, "desc": r.description}
                         for r in (ab.services or [])],

            # Stats — share home page stats, years always dynamic
            "stat_packages":  hp.stat_packages or "5,000+",
            "stat_clients":   hp.stat_clients or "200+",
            "stat_countries": hp.stat_countries or "40+",
            "stat_years":     hp.stat_years or years_display,

            "years_of_service": years_int,
            "years_display":    years_display,
        }
    except Exception as e:
        return {"error": str(e)}


@frappe.whitelist(allow_guest=True)
def search_countries(query=""):
    """Autocomplete countries from Country Zone (all providers) for Quick Rate Check."""
    try:
        return frappe.db.sql(
            """
            SELECT DISTINCT country_name, country_code
            FROM `tabCountry Zone`
            WHERE country_name LIKE %(q)s OR country_code LIKE %(q)s
            ORDER BY country_name LIMIT 20
            """,
            {"q": f"%{query}%"},
            as_dict=True,
        )
    except Exception:
        return []


@frappe.whitelist(allow_guest=True)
def get_contact_page_data():
    """Fetch Contact Page content."""
    try:
        hdr = frappe.get_single("Website Header Settings")
        ftr = frappe.get_single("Website Footer Settings")
        cp  = frappe.get_single("Website Contact Page")
        return {
            "company_name":    hdr.company_name or "",
            "company_logo":    hdr.company_logo or "",
            "contact_email":   hdr.contact_email or "",
            "contact_phone":   hdr.contact_phone or "",
            "contact_address": ftr.contact_address or "",
            "company_tagline": ftr.company_tagline or "",
            "facebook_url":    hdr.facebook_url or "#",
            "linkedin_url":    hdr.linkedin_url or "#",
            "twitter_url":     hdr.twitter_url or "#",

            "page_hero_title":    cp.page_hero_title or "Get in Touch",
            "page_hero_subtitle": cp.page_hero_subtitle or "",
            "phone_note":         cp.phone_note or "Available 24/7 for urgent enquiries",
            "email_note":         cp.email_note or "We reply within 2 business hours",
            "business_hours":     cp.business_hours or "Monday – Saturday\n9:00 AM – 6:00 PM (PKT)",
            "form_title":         cp.form_title or "Send us a message",
            "form_subtitle":      cp.form_subtitle or "",
            "map_embed_url":      cp.map_embed_url or "",
            "cta_title":          cp.cta_title or "",
            "cta_text":           cp.cta_text or "",
        }
    except Exception as e:
        return {"error": str(e)}
