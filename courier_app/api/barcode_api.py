"""
courier_app/api/barcode_api.py
Barcode SVG generation — no external packages required.

Supported types:
  Code 128  — pure-Python Code128B SVG (universal, all-ASCII, modern scanners)
  Code 39   — uses reportlab decomposed data → SVG  (legacy/wide-format scanners)
  QR Code   — uses reportlab QrCodeWidget → SVG     (smartphone / 2D scanners)
"""

import frappe


# ─── Code 128B ───────────────────────────────────────────────────────────────

# 103 characters (ASCII 32–126) mapped to their 11-bit bar-space pattern.
# Index 0 = space (ASCII 32), index 94 = tilde (ASCII 126).
_C128B_PATTERNS = [
    '11011001100','11001101100','11001100110','10010011000','10010001100',
    '10001001100','10011001000','10011000100','10001100100','11001001000',
    '11001000100','11000100100','10110011100','10011011100','10011001110',
    '10111001100','10011101100','10011100110','11001110010','11001011100',
    '11001001110','11011100100','11001110100','11101101110','11101001100',
    '11100101100','11100100110','11101100100','11100110100','11100110010',
    '11011011000','11011000110','11000110110','10100011000','10001011000',
    '10001000110','10110001000','10001101000','10001100010','11010001000',
    '11000101000','11000100010','10110111000','10110001110','10001101110',
    '10111011000','10111000110','10001110110','11101110110','11010001110',
    '11000101110','11011101000','11011100010','11011101110','11101011000',
    '11101000110','11100010110','11101101000','11100011010','11101111010',
    '11001000010','11110001010','10100110000','10100001100','10010110000',
    '10010000110','10000101100','10000100110','10110010000','10110000100',
    '10011010000','10011000010','10000110100','10000110010','11000010010',
    '11001010000','11110111010','11000010100','10001111010','10100111100',
    '10010111100','10010011110','10111100100','10011110100','10011110010',
    '11110100100','11110010100','11110010010','11011011110','11011110110',
    '11110110110','10101111000','10100011110','10001011110','10111101000',
    '10111100010','11110101000','11110100010','10111011110','10111101110',
    '11101011110','11110101110',
]

_C128B_START   = '11010010000'
_C128B_STOP    = '1100011101011'
_C128B_START_V = 104  # checksum value for START B


def _code128b_svg(value, bar_width=2, bar_height=60, show_text=True, font_size=9):
    """Return an inline SVG string for a Code128B barcode."""
    for ch in value:
        idx = ord(ch) - 32
        if not (0 <= idx < len(_C128B_PATTERNS)):
            frappe.throw(f"Character {repr(ch)} is not supported in Code 128B.")

    # Build pattern: START + data + check + STOP
    patterns   = [_C128B_START]
    checksum   = _C128B_START_V
    for pos, ch in enumerate(value, 1):
        idx = ord(ch) - 32
        patterns.append(_C128B_PATTERNS[idx])
        checksum += pos * idx
    patterns.append(_C128B_PATTERNS[checksum % 103])
    patterns.append(_C128B_STOP)

    # Convert bit-strings to a flat bar/space list (1=bar, 0=space)
    bits = [int(b) for pat in patterns for b in pat]

    total_w    = len(bits) * bar_width
    text_h     = (font_size + 3) if show_text else 0
    svg_height = bar_height + text_h + 2

    rects = []
    x = 0
    for bit in bits:
        if bit:
            rects.append(f'<rect x="{x}" y="0" width="{bar_width}" height="{bar_height}"/>')
        x += bar_width

    text_el = ''
    if show_text:
        text_el = (
            f'<text x="{total_w / 2:.1f}" y="{bar_height + font_size + 1}" '
            f'font-family="monospace,Courier New,Courier" font-size="{font_size}" '
            f'text-anchor="middle" fill="#000" letter-spacing="1">{value}</text>'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{total_w}" height="{svg_height}" '
        f'viewBox="0 0 {total_w} {svg_height}" '
        f'fill="#000" shape-rendering="crispEdges">'
        + ''.join(rects) + text_el
        + '</svg>'
    )


# ─── Code 39 ─────────────────────────────────────────────────────────────────

def _code39_svg(value, bar_width=2, bar_height=60, show_text=True, font_size=9):
    """Return an inline SVG string for a Code39 barcode (no checksum)."""
    try:
        from reportlab.graphics.barcode.code39 import Standard39
    except ImportError:
        # Fall back to Code 128B if reportlab is unavailable
        return _code128b_svg(value, bar_width, bar_height, show_text, font_size)

    bc = Standard39(value, barWidth=1, barHeight=bar_height, checksum=0, humanReadable=False)
    bc._calculate()
    decomposed = bc.decomposed  # e.g. 'bSbsBsBsb i bSbsBsBsb ...'

    # Decode: b/B = bar (narrow/wide), s/S = space (narrow/wide), i = inter-char gap (narrow space)
    narrow = bar_width
    wide   = bar_width * 3

    rects  = []
    x      = 0.0
    for ch in decomposed:
        if ch in ('b', 'B'):
            w = wide if ch == 'B' else narrow
            rects.append(f'<rect x="{x:.1f}" y="0" width="{w}" height="{bar_height}"/>')
            x += w
        elif ch in ('s', 'S', 'i'):
            x += wide if ch == 'S' else narrow
        # anything else ignored

    total_w    = x
    text_h     = (font_size + 3) if show_text else 0
    svg_height = bar_height + text_h + 2

    text_el = ''
    if show_text:
        text_el = (
            f'<text x="{total_w / 2:.1f}" y="{bar_height + font_size + 1}" '
            f'font-family="monospace,Courier New,Courier" font-size="{font_size}" '
            f'text-anchor="middle" fill="#000" letter-spacing="1">{value}</text>'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{total_w:.0f}" height="{svg_height}" '
        f'viewBox="0 0 {total_w:.0f} {svg_height}" '
        f'fill="#000" shape-rendering="crispEdges">'
        + ''.join(rects) + text_el
        + '</svg>'
    )


# ─── QR Code ─────────────────────────────────────────────────────────────────

def _qr_svg(value, size=100):
    """Return an SVG string for a QR code using reportlab's QrCodeWidget."""
    try:
        import os, tempfile
        from reportlab.graphics.barcode import qr as rqr
        from reportlab.graphics.shapes import Drawing
        from reportlab.graphics import renderSVG

        qw      = rqr.QrCodeWidget(value)
        node    = qw.provideNode()
        drawing = Drawing(size, size)
        drawing.add(node)

        with tempfile.NamedTemporaryFile(suffix='.svg', delete=False, mode='w') as f:
            tmp_path = f.name
        renderSVG.drawToFile(drawing, tmp_path)
        with open(tmp_path, 'r') as f:
            svg_data = f.read()
        os.unlink(tmp_path)

        # Strip XML declaration / DOCTYPE — return the <svg ...>...</svg> element only
        start = svg_data.find('<svg')
        if start != -1:
            svg_data = svg_data[start:]
        return svg_data
    except Exception:
        # Fallback to Code 128B if QR generation fails
        return _code128b_svg(value)


# ─── Public API ──────────────────────────────────────────────────────────────

def generate_barcode_svg(value, barcode_type=None, bar_height=60, show_text=True):
    """
    Return an inline SVG barcode string for *value*.

    barcode_type: "Code 128" | "Code 39" | "QR Code" | None (reads Courier Settings)
    """
    if not barcode_type:
        try:
            barcode_type = frappe.db.get_single_value("Courier Settings", "barcode_type") or "Code 128"
        except Exception:
            barcode_type = "Code 128"

    if barcode_type == "QR Code":
        qr_size = max(bar_height, 80)
        return _qr_svg(value, size=qr_size)
    elif barcode_type == "Code 39":
        return _code39_svg(value, bar_height=bar_height, show_text=show_text)
    else:
        return _code128b_svg(value, bar_height=bar_height, show_text=show_text)


@frappe.whitelist()
def get_shipment_barcode(name, barcode_type=None):
    """Return the barcode SVG for a given Courier Shipment name."""
    if not frappe.db.exists("Courier Shipment", name):
        frappe.throw(f"Shipment {name} not found")
    return generate_barcode_svg(name, barcode_type=barcode_type)
