---
name: revert-hero
description: Revert index hero section from light (contact-page style) back to original dark purple gradient when user says "revert-hero"
metadata:
  type: project
---

When user says "revert-hero", revert the index page hero section from the light content-area style back to the original dark purple gradient.

**Why:** User wants the ability to quickly undo the hero color change made on 2026-06-17.

**How to apply:** Restore these original values in `courier_app/public/css/website.css` and `courier_app/www/index.html`:

### CSS (`courier_app/public/css/website.css`):
- `.wsite-hero` background: `linear-gradient(135deg, var(--w-navy) 0%, var(--w-navy-2) 55%, #5A2870 100%)`
- `::before` pattern fill: `%23ffffff` (white) with `fill-opacity='0.025'`
- `.wsite-hero-badge`: `background: rgba(240,180,41,0.15)`, `color: var(--w-gold)`
- `.wsite-hero h1`: `color: var(--w-white)`
- `.wsite-hero-sub`: `color: rgba(255,255,255,0.72)`
- `.wsite-hero-trust` border-top: `1px solid rgba(255,255,255,0.1)`
- `.wsite-hero-stat` border-right: `1px solid rgba(255,255,255,0.1)`
- `.wsite-hero-stat-num`: `color: var(--w-gold)`
- `.wsite-hero-stat-label`: `color: rgba(255,255,255,0.55)`
- `.wsite-hero-card`: `background: rgba(255,255,255,0.06)`, `border: 1px solid rgba(255,255,255,0.12)`, `backdrop-filter: blur(12px)` (remove `box-shadow`)
- `.wsite-hero-card-title`: `color: var(--w-gold)`
- `.wsite-hero-input`: `background: rgba(255,255,255,0.1)`, `border: 1px solid rgba(255,255,255,0.2)`, `color: var(--w-white)`
- `.wsite-hero-input::placeholder`: `color: rgba(255,255,255,0.45)`
- `.wsite-hero-input:focus`: `border-color: var(--w-gold)` (no box-shadow)
- `.wqf-dropdown`: `background: #2A1438`, `border: 1px solid rgba(255,255,255,0.18)`, `box-shadow: 0 8px 24px rgba(0,0,0,0.35)`
- `.wqf-item`: `color: rgba(255,255,255,0.88)`
- `.wqf-item:hover, .wqf-item.focused`: `background: rgba(240,180,41,0.12)`, `color: var(--w-gold)`
- `.wqf-item span`: `color: rgba(255,255,255,0.4)`
- `.wqf-item:hover span, .wqf-item.focused span`: `color: rgba(240,180,41,0.6)`
- scrollbar thumb: `background: rgba(255,255,255,0.15)`
- `.wsite-hero-carousel` box-shadow: `0 8px 32px rgba(61,34,72,0.28)`

### HTML (`courier_app/www/index.html`):
- Track button: change `w-btn-ghost-navy` back to `w-btn-outline`
- "Or book a shipment" link: change `color:var(--w-text-muted)` back to `color:rgba(255,255,255,0.6)`
