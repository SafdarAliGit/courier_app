"use strict";
/* ── Track Page — AfterShip integration ──────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
	const input  = document.getElementById("trk-input");
	const btn    = document.getElementById("trk-btn");
	const result = document.getElementById("trk-result");

	/* Auto-track if URL contains ?id= */
	if (TRK_QUERY) {
		input.value = TRK_QUERY;
		doTrack(TRK_QUERY);
	}

	btn.addEventListener("click", () => {
		const q = input.value.trim();
		if (!q) { input.focus(); return; }
		doTrack(q);
	});
	input.addEventListener("keydown", e => { if (e.key === "Enter") btn.click(); });

	/* ── Main fetch ── */
	function doTrack(id) {
		result.style.display = "block";
		result.innerHTML = `
<div class="trk-loading">
  <div class="trk-spinner"></div>
  <p>Fetching tracking data…</p>
</div>`;

		frappe.call({
			method: "courier_app.api.shipment_api.track_aftership",
			args: { tracking_id: id },
			error: () => {
				result.innerHTML = notFound("Connection Error",
					"Could not reach the tracking service. Please check your internet connection and try again.");
			},
			callback: r => {
				const d = r.message;
				if (!d) {
					result.innerHTML = notFound("No Response", "The server returned an empty response.");
					return;
				}
				if (!d.found) {
					const msg = d.error
						? `<p>${escHtml(d.error)}</p>`
						: `<p>No shipment found for <b>${escHtml(id)}</b>.<br>Check your tracking ID and try again.</p>`;
					result.innerHTML = notFound("Shipment Not Found", msg, true);
					return;
				}
				if (d.mode === "custom") {
					result.innerHTML = buildCustomCard(d.shipment, d.events);
				} else {
					window._currentTracking = d.tracking;
					result.innerHTML = buildCard(d.tracking);
				}
			}
		});
	}

	/* ── Card builder ── */
	function buildCard(t) {
		const tag        = t.tag || "Pending";
		const tagCls     = tagClass(tag);
		const statusText = escHtml(t.subtag_message || t.tag || "Unknown");

		const origin = joinParts([t.origin_city, t.origin_state, t.origin_country_region]);
		const dest   = joinParts([t.destination_city, t.destination_state, t.destination_country_region]);

		const pickupDt   = t.shipment_pickup_date   ? fmtDate(t.shipment_pickup_date)   : "—";
		const deliveryDt = t.shipment_delivery_date  ? fmtDate(t.shipment_delivery_date)  : "—";
		const estDt      = t.courier_estimated_delivery_date?.estimated_delivery_date
		                   ? fmtDate(t.courier_estimated_delivery_date.estimated_delivery_date) : "—";
		const updatedDt  = t.updated_at ? fmtDate(t.updated_at) : "—";

		const checkpoints = [...(t.checkpoints || [])].reverse();
		const onTimeStatus = t.on_time_status ? capitalize(t.on_time_status) : "—";
		const onTimeCls    = { early: "as-ontime-early", on_time: "as-ontime-ontime", late: "as-ontime-late" }[t.on_time_status] || "";

		return `
<div class="as-card" id="as-printable">

  <!-- ── COMPANY BAR ── -->
  ${(TRK_COMPANY_NAME || TRK_COMPANY_LOGO) ? `
  <div class="as-company-bar">
    ${TRK_COMPANY_LOGO ? `<img src="${escHtml(TRK_COMPANY_LOGO)}" alt="${escHtml(TRK_COMPANY_NAME || '')}" class="as-company-logo">` : ""}
    ${TRK_COMPANY_NAME ? `<span class="as-company-name">${escHtml(TRK_COMPANY_NAME)}</span>` : ""}
  </div>` : ""}

  <!-- ── HEADER ── -->
  <div class="as-header">
    <div class="as-header-left">
      <div class="as-tracking-eyebrow">Tracking Number</div>
      <div class="as-tracking-num">${escHtml(t.tracking_number || t.title || "—")}</div>
      ${t.slug ? `<div class="as-carrier-pill">${escHtml(t.slug)}</div>` : ""}
    </div>
    <div class="as-header-right">
      <span class="as-status-badge ${tagCls}">${statusText}</span>
      <div class="as-action-row no-print">
        <button class="as-action-btn" onclick="window.printTracking()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print
        </button>
        <button class="as-action-btn as-action-pdf" onclick="window.downloadPDF()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          Save PDF
        </button>
      </div>
    </div>
  </div>

  <!-- ── ROUTE BAR ── -->
  <div class="as-route">
    <div class="as-route-point">
      <div class="as-route-icon as-route-icon-origin">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="as-route-city">${escHtml(origin || "Origin")}</div>
      <div class="as-route-sublabel">Picked up ${pickupDt !== "—" ? pickupDt : ""}</div>
    </div>

    <div class="as-route-track">
      <div class="as-route-line-wrap">
        <div class="as-route-line-fill ${tag === "Delivered" ? "as-route-line-done" : "as-route-line-active"}"></div>
      </div>
      <div class="as-route-mid-badge ${tagCls}">${statusText}</div>
    </div>

    <div class="as-route-point as-route-point-right">
      <div class="as-route-icon ${tag === "Delivered" ? "as-route-icon-delivered" : "as-route-icon-dest"}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="as-route-city">${escHtml(dest || "Destination")}</div>
      <div class="as-route-sublabel">${deliveryDt !== "—" ? "Delivered " + deliveryDt : estDt !== "—" ? "Est. " + estDt : ""}</div>
    </div>
  </div>

  <!-- ── STATS ── -->
  <div class="as-stats-row">
    ${statBox("Picked Up",       pickupDt,   "📦")}
    ${statBox("Delivered",       deliveryDt, "✅")}
    ${statBox("Est. Delivery",   estDt,      "📅")}
    ${statBox("On-Time Status",  `<span class="${onTimeCls}">${onTimeStatus}</span>`, "⏱")}
    ${statBox("Last Updated",    updatedDt,  "🔄")}
  </div>

  <!-- ── BODY ── -->
  <div class="as-body">

    <!-- Checkpoint timeline -->
    <div class="as-section as-timeline-section">
      <h4 class="as-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Tracking History
      </h4>
      <div class="as-timeline">
        ${checkpoints.length
            ? checkpoints.map((cp, i) => buildCheckpoint(cp, i === 0)).join("")
            : `<p class="as-empty">No checkpoints available yet.</p>`}
      </div>
    </div>

    <!-- Shipment details -->
    <div class="as-section as-details-section">
      <h4 class="as-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
        Shipment Details
      </h4>
      <dl class="as-details-list">
        ${detRow("Tracking Number",   t.tracking_number)}
        ${detRow("Status",            t.subtag_message || t.tag)}
        ${detRow("Carrier / Slug",    t.slug)}
        ${detRow("Source",            capitalize(t.source || ""))}
        ${detRow("Pickup Date",       pickupDt !== "—" ? pickupDt : null)}
        ${detRow("Delivery Date",     deliveryDt !== "—" ? deliveryDt : null)}
        ${detRow("Est. Delivery",     estDt !== "—" ? estDt : null)}
        ${detRow("On-Time Status",    `<span class="${onTimeCls}">${onTimeStatus}</span>`)}
        ${t.transit_time ? detRow("Transit Days", t.transit_time) : ""}
        ${t.signed_by    ? detRow("Signed By",    t.signed_by)    : ""}
        ${t.failed_delivery_attempts ? detRow("Failed Attempts", t.failed_delivery_attempts) : ""}
        ${t.tracked_count ? detRow("Times Tracked", t.tracked_count) : ""}
      </dl>
    </div>

  </div><!-- /as-body -->

  <!-- Origin / Destination detail rows -->
  <div class="as-address-row">
    <div class="as-address-box">
      <div class="as-address-label">Origin Address</div>
      <div class="as-address-value">${escHtml(t.origin_raw_location || origin || "—")}</div>
    </div>
    <div class="as-address-arrow">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </div>
    <div class="as-address-box">
      <div class="as-address-label">Destination Address</div>
      <div class="as-address-value">${escHtml(t.destination_raw_location || dest || "—")}</div>
    </div>
  </div>

  <!-- Print-only footer -->
  <div class="as-print-footer print-only">
    <div class="as-pf-left">
      <strong>Tracking #:</strong> ${escHtml(t.tracking_number || "")}
      &nbsp;|&nbsp; <strong>Carrier:</strong> ${escHtml(t.slug || "")}
    </div>
    <div class="as-pf-right">Printed ${new Date().toLocaleString("en-US", {dateStyle:"long", timeStyle:"short"})}</div>
  </div>

</div><!-- /as-card -->`;
	}

	/* ── Checkpoint row ── */
	function buildCheckpoint(cp, isLatest) {
		const cpTag  = cp.tag || "Pending";
		const cpCls  = tagClass(cpTag);
		const cpText = escHtml(cp.subtag_message || cp.tag || "Update");
		const cpTime = cp.checkpoint_time ? fmtDateTime(cp.checkpoint_time) : "";
		const cpLoc  = cp.location || joinParts([cp.city, cp.state, cp.country_region_name]);

		return `
<div class="as-cp ${isLatest ? "as-cp-latest" : ""}">
  <div class="as-cp-spine">
    <div class="as-cp-dot ${cpCls}-dot${isLatest ? " as-cp-dot-pulse" : ""}"></div>
    <div class="as-cp-connector"></div>
  </div>
  <div class="as-cp-body">
    <div class="as-cp-top">
      <span class="as-cp-badge ${cpCls}">${cpText}</span>
      ${cpTime ? `<span class="as-cp-time">${cpTime}</span>` : ""}
    </div>
    ${cp.message ? `<div class="as-cp-msg">${escHtml(cp.message)}</div>` : ""}
    ${cpLoc ? `<div class="as-cp-loc">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1C4.34 1 3 2.34 3 4c0 2.44 3 7 3 7s3-4.56 3-7c0-1.66-1.34-3-3-3z" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="4" r="1.2" stroke="currentColor" stroke-width="1.2"/></svg>
      ${escHtml(cpLoc)}
    </div>` : ""}
  </div>
</div>`;
	}

	/* ── Helpers ── */
	function statBox(label, value, icon) {
		return `
<div class="as-stat-box">
  <div class="as-stat-icon">${icon}</div>
  <div class="as-stat-label">${label}</div>
  <div class="as-stat-value">${value}</div>
</div>`;
	}

	function detRow(label, value) {
		if (value === null || value === undefined || value === "" || value === "—") return "";
		return `<div class="as-det-row"><dt>${escHtml(label)}</dt><dd>${typeof value === "string" && value.startsWith("<") ? value : escHtml(String(value))}</dd></div>`;
	}

	function notFound(title, bodyHtml, isRaw) {
		return `
<div class="trk-not-found">
  <div class="trk-nf-icon">
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <circle cx="26" cy="26" r="24" stroke="#e5e7eb" stroke-width="1.6"/>
      <path d="M18 18l16 16M34 18L18 34" stroke="#9ca3af" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
  </div>
  <h3>${escHtml(title)}</h3>
  <div class="trk-nf-body">${isRaw ? bodyHtml : `<p>${escHtml(bodyHtml)}</p>`}</div>
</div>`;
	}

	function tagClass(tag) {
		const map = {
			InfoReceived:   "as-tag-info",
			InTransit:      "as-tag-transit",
			OutForDelivery: "as-tag-out",
			Delivered:      "as-tag-delivered",
			Exception:      "as-tag-exception",
			Failed:         "as-tag-exception",
			AttemptFail:    "as-tag-attempt",
			Pending:        "as-tag-pending",
		};
		return map[tag] || "as-tag-pending";
	}

	function joinParts(parts) {
		return parts.filter(Boolean).join(", ");
	}

	function fmtDate(iso) {
		try {
			return new Date(iso).toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"});
		} catch { return iso; }
	}

	function fmtDateTime(iso) {
		try {
			return new Date(iso).toLocaleString("en-US", {month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", hour12:true});
		} catch { return iso; }
	}

	function capitalize(s) {
		return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "";
	}

	function escHtml(str) {
		return String(str ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
	}

	/* ── Custom tracking card (non-AfterShip) ── */
	function buildCustomCard(ship, events) {
		const status = ship.status || "Shipment Information Received";
		const isDelivered = status === "Delivered";

		const statusColors = {
			"Shipment Information Received": { bg: "#dbeafe", color: "#1d4ed8" },
			"Collection":                    { bg: "#fef3c7", color: "#92400e" },
			"In Transit to Destination":     { bg: "#ede9fe", color: "#7c3aed" },
			"Departed Origin Airport":       { bg: "#e0f2fe", color: "#0369a1" },
			"Arrived at Destination Airport": { bg: "#d1fae5", color: "#065f46" },
			"Delivered":                     { bg: "#d1fae5", color: "#065f46" },
			"Cancelled":                     { bg: "#fee2e2", color: "#991b1b" },
		};
		const sc = statusColors[status] || statusColors["Shipment Information Received"];

		const latestEvent = events.length ? events[events.length - 1] : null;
		const latestDt = latestEvent ? new Date(latestEvent.datetime) : null;
		const latestDateStr = latestDt ? latestDt.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
		const latestTimeStr = latestDt ? latestDt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "";

		const grouped = {};
		const reversedEvents = [...events].reverse();
		for (const ev of reversedEvents) {
			const d = new Date(ev.datetime);
			const dateKey = d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
			if (!grouped[dateKey]) grouped[dateKey] = [];
			grouped[dateKey].push(ev);
		}

		let timelineHtml = "";
		for (const [dateLabel, dayEvents] of Object.entries(grouped)) {
			timelineHtml += `<div class="ct-date-group"><div class="ct-date-header">${escHtml(dateLabel)}</div>`;
			for (const ev of dayEvents) {
				const t = new Date(ev.datetime);
				const timeStr = t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
				const evColor = statusColors[ev.status] || { color: "#6b7280" };
				timelineHtml += `
<div class="ct-event">
  <div class="ct-event-time">${timeStr}</div>
  <div class="ct-event-dot" style="border-color:${evColor.color}"></div>
  <div class="ct-event-content">
    <div class="ct-event-status" style="color:${evColor.color}">${escHtml(ev.status)}</div>
    ${ev.location ? `<div class="ct-event-location">${escHtml(ev.location)}</div>` : ""}
  </div>
</div>`;
			}
			timelineHtml += `</div>`;
		}

		const origin = [ship.sender_city, ship.sender_country].filter(Boolean).join(", ");
		const dest   = [ship.recipient_city, ship.recipient_country].filter(Boolean).join(", ");
		const shipDateFmt = ship.ship_date ? new Date(ship.ship_date + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "";

		return `
<div class="ct-card">
  <div class="ct-banner" style="background:${sc.bg};color:${sc.color}">
    <div class="ct-banner-icon">${isDelivered ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'}</div>
    <div class="ct-banner-text">
      <div class="ct-banner-status">${escHtml(status)} ${ship.recipient_name ? "- " + escHtml(ship.recipient_name) : ""}</div>
      <div class="ct-banner-date">${latestDateStr} ${latestTimeStr}</div>
    </div>
  </div>

  <div class="ct-info">
    <div class="ct-info-row">
      <div class="ct-info-item">
        <div class="ct-info-label">Shipment ID</div>
        <div class="ct-info-value ct-mono">${escHtml(ship.name)}</div>
      </div>
      ${ship.tracking_number && ship.tracking_number !== ship.name ? `
      <div class="ct-info-item">
        <div class="ct-info-label">Tracking Number</div>
        <div class="ct-info-value ct-mono">${escHtml(ship.tracking_number)}</div>
      </div>` : ""}
      ${shipDateFmt ? `
      <div class="ct-info-item">
        <div class="ct-info-label">Ship Date</div>
        <div class="ct-info-value">${shipDateFmt}</div>
      </div>` : ""}
      ${ship.service_provider ? `
      <div class="ct-info-item">
        <div class="ct-info-label">Service Provider</div>
        <div class="ct-info-value">${escHtml(ship.service_provider)}</div>
      </div>` : ""}
      ${ship.services ? `
      <div class="ct-info-item">
        <div class="ct-info-label">Service</div>
        <div class="ct-info-value">${escHtml(ship.services)}</div>
      </div>` : ""}
    </div>
    <div class="ct-route">
      <div class="ct-route-point">
        <div class="ct-route-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill="#3b82f6"/><circle cx="12" cy="12" r="8" stroke="#3b82f6" stroke-width="1.5" opacity="0.3"/></svg>
        </div>
        <div>
          <div class="ct-route-label">Origin</div>
          <div class="ct-route-value">${escHtml(origin || "—")}</div>
          ${ship.sender_name ? `<div class="ct-route-name">${escHtml(ship.sender_name)}</div>` : ""}
        </div>
      </div>
      <div class="ct-route-arrow">
        <svg width="32" height="12" viewBox="0 0 32 12" fill="none"><path d="M0 6h28M24 1l5 5-5 5" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="ct-route-point">
        <div class="ct-route-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ef4444"/></svg>
        </div>
        <div>
          <div class="ct-route-label">Destination</div>
          <div class="ct-route-value">${escHtml(dest || "—")}</div>
          ${ship.recipient_name ? `<div class="ct-route-name">${escHtml(ship.recipient_name)}</div>` : ""}
        </div>
      </div>
    </div>
  </div>

  <div class="ct-toggle-wrap">
    <button class="ct-toggle" id="ct-toggle-btn">Hide Tracking History &#x25B4;</button>
  </div>
  <div class="ct-timeline" id="ct-timeline">
    ${timelineHtml || '<p class="ct-empty">No tracking events recorded yet.</p>'}
  </div>
</div>`;
	}

	/* Bind toggle after DOM update */
	const observer = new MutationObserver(() => {
		const btn = document.getElementById("ct-toggle-btn");
		const tl  = document.getElementById("ct-timeline");
		if (btn && tl && !btn._bound) {
			btn._bound = true;
			btn.addEventListener("click", () => {
				tl.classList.toggle("ct-hidden");
				btn.innerHTML = tl.classList.contains("ct-hidden")
					? "Show Tracking History &#x25BE;"
					: "Hide Tracking History &#x25B4;";
			});
		}
	});
	observer.observe(result, { childList: true, subtree: true });
});

/* ── Global actions (called from onclick in generated HTML) ── */

window.printTracking = function () {
	window.print();
};

window.downloadPDF = function () {
	const t = window._currentTracking;
	if (!t) return;

	const title = `Tracking Report — ${t.tracking_number || t.id || "Shipment"}`;
	const checkpoints = [...(t.checkpoints || [])].reverse();

	const tagColorMap = {
		Delivered: "#15803d", InTransit: "#7c3aed", InfoReceived: "#1d4ed8",
		OutForDelivery: "#b45309", Exception: "#b91c1c", Failed: "#b91c1c",
		AttemptFail: "#c2410c", Pending: "#6b7280",
	};
	const tagBgMap = {
		Delivered: "#dcfce7", InTransit: "#ede9fe", InfoReceived: "#dbeafe",
		OutForDelivery: "#fef3c7", Exception: "#fee2e2", Failed: "#fee2e2",
		AttemptFail: "#ffedd5", Pending: "#f3f4f6",
	};

	function escH(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
	function join(a) { return a.filter(Boolean).join(", "); }
	function fmtD(iso) { try { return new Date(iso).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}); } catch { return iso; } }
	function fmtDT(iso) { try { return new Date(iso).toLocaleString("en-US", {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true}); } catch { return iso; } }

	const origin   = join([t.origin_city, t.origin_state]);
	const dest     = join([t.destination_city, t.destination_state]);
	const pickup   = t.shipment_pickup_date  ? fmtD(t.shipment_pickup_date)  : "—";
	const delivery = t.shipment_delivery_date ? fmtD(t.shipment_delivery_date) : "—";
	const estDel   = t.courier_estimated_delivery_date?.estimated_delivery_date ? fmtD(t.courier_estimated_delivery_date.estimated_delivery_date) : "—";
	const tagColor = tagColorMap[t.tag] || "#6b7280";
	const tagBg    = tagBgMap[t.tag]    || "#f3f4f6";

	const cpRows = checkpoints.map(cp => `
<tr>
  <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-size:12px;color:#4b5563">${cp.checkpoint_time ? fmtDT(cp.checkpoint_time) : "—"}</td>
  <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb">
    <span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:600;background:${tagBgMap[cp.tag]||"#f3f4f6"};color:${tagColorMap[cp.tag]||"#6b7280"}">${escH(cp.subtag_message||cp.tag||"")}</span>
  </td>
  <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${escH(cp.message||"")}</td>
  <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#4b5563">${escH(join([cp.city,cp.state,cp.country_region_name]))}</td>
</tr>`).join("");

	const companyName = (typeof TRK_COMPANY_NAME !== "undefined" && TRK_COMPANY_NAME) ? TRK_COMPANY_NAME : "";
	const companyLogo = (typeof TRK_COMPANY_LOGO !== "undefined" && TRK_COMPANY_LOGO) ? TRK_COMPANY_LOGO : "";

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escH(title)}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; font-size:13px; color:#111827; background:#fff; padding:32px; }
  h1 { font-size:20px; font-weight:700; color:#05174A; margin-bottom:4px; }
  .subtitle { font-size:12px; color:#6b7280; margin-bottom:24px; }
  .company-bar { display:flex; align-items:center; gap:12px; padding-bottom:16px; margin-bottom:20px; border-bottom:2px solid #05174A; }
  .company-bar img { height:40px; width:40px; object-fit:contain; border-radius:6px; }
  .company-bar span { font-size:20px; font-weight:700; color:#05174A; }
  .header-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; border-bottom:1px solid #e5e7eb; padding-bottom:16px; }
  .badge { display:inline-block; padding:4px 14px; border-radius:99px; font-size:12px; font-weight:700; background:${tagBg}; color:${tagColor}; }
  .route-box { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:16px 20px; margin-bottom:20px; display:flex; align-items:center; gap:16px; }
  .route-city { font-size:14px; font-weight:600; color:#1e293b; }
  .route-sub  { font-size:11px; color:#6b7280; margin-top:2px; }
  .route-arrow { flex:1; text-align:center; font-size:18px; color:#94a3b8; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
  .stat { background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:12px; text-align:center; }
  .stat-label { font-size:10px; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
  .stat-val { font-size:13px; font-weight:600; color:#1e293b; }
  .section-title { font-size:13px; font-weight:700; color:#374151; text-transform:uppercase; letter-spacing:.05em; margin-bottom:12px; border-left:3px solid #05174A; padding-left:10px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  th { background:#f1f5f9; padding:8px 12px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#374151; border-bottom:2px solid #e5e7eb; }
  .details-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:24px; }
  .det-row { display:flex; gap:8px; font-size:12px; padding:6px 0; border-bottom:1px solid #f1f5f9; }
  .det-label { color:#6b7280; min-width:130px; flex-shrink:0; }
  .det-val { color:#1e293b; font-weight:500; }
  .footer { border-top:1px solid #e5e7eb; padding-top:12px; margin-top:8px; display:flex; justify-content:space-between; font-size:10px; color:#9ca3af; }
  @media print {
    body { padding:16px; }
    @page { margin:12mm; }
  }
</style>
</head>
<body>
${(companyName || companyLogo) ? `
<div class="company-bar">
  ${companyLogo ? `<img src="${escH(companyLogo)}" alt="${escH(companyName)}">` : ""}
  ${companyName ? `<span>${escH(companyName)}</span>` : ""}
</div>` : ""}
<div class="header-row">
  <div>
    <h1>${escH(t.tracking_number || t.title || "Tracking Report")}</h1>
    <div class="subtitle">Carrier: ${escH(t.slug||"—")} &nbsp;·&nbsp; Source: ${escH(t.source||"—")}</div>
  </div>
  <span class="badge">${escH(t.subtag_message||t.tag||"Unknown")}</span>
</div>

<div class="route-box">
  <div>
    <div class="route-city">📍 ${escH(origin||"Origin")}</div>
    <div class="route-sub">Picked up: ${pickup}</div>
  </div>
  <div class="route-arrow">──────────────►</div>
  <div style="text-align:right">
    <div class="route-city">📍 ${escH(dest||"Destination")}</div>
    <div class="route-sub">${delivery !== "—" ? "Delivered: "+delivery : "Est: "+estDel}</div>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-label">Picked Up</div><div class="stat-val">${pickup}</div></div>
  <div class="stat"><div class="stat-label">Delivered</div><div class="stat-val">${delivery}</div></div>
  <div class="stat"><div class="stat-label">Est. Delivery</div><div class="stat-val">${estDel}</div></div>
  <div class="stat"><div class="stat-label">On-Time</div><div class="stat-val">${t.on_time_status ? (t.on_time_status.charAt(0).toUpperCase()+t.on_time_status.slice(1)) : "—"}</div></div>
</div>

<div class="section-title">Shipment Details</div>
<div class="details-grid">
  <div>
    ${[["Tracking Number",t.tracking_number],["Status",t.subtag_message||t.tag],["Carrier",t.slug],["Source",t.source]].map(([l,v])=>v?`<div class="det-row"><span class="det-label">${l}</span><span class="det-val">${escH(v)}</span></div>`:"").join("")}
  </div>
  <div>
    ${[["Pickup Date",pickup],["Delivery Date",delivery],["On-Time",t.on_time_status],["Transit Days",t.transit_time?t.transit_time+"d":null]].map(([l,v])=>v&&v!=="—"?`<div class="det-row"><span class="det-label">${l}</span><span class="det-val">${escH(String(v))}</span></div>`:"").join("")}
  </div>
</div>

<div class="section-title">Tracking History</div>
<table>
  <thead><tr>
    <th>Date &amp; Time</th>
    <th>Status</th>
    <th>Details</th>
    <th>Location</th>
  </tr></thead>
  <tbody>${cpRows}</tbody>
</table>

${(t.origin_raw_location || t.destination_raw_location) ? `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
  <div><div class="section-title" style="margin-bottom:6px">Origin</div><div style="font-size:12px;color:#374151">${escH(t.origin_raw_location||origin||"—")}</div></div>
  <div><div class="section-title" style="margin-bottom:6px">Destination</div><div style="font-size:12px;color:#374151">${escH(t.destination_raw_location||dest||"—")}</div></div>
</div>` : ""}

<div class="footer">
  <span>Tracking ID: ${escH(t.id||"")}</span>
  <span>Generated ${new Date().toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"})}</span>
</div>
</body>
</html>`;

	const filename = `tracking-${t.tracking_number || t.id || "report"}.pdf`;
	const opts = {
		margin: 10,
		filename: filename,
		image: { type: "jpeg", quality: 0.98 },
		html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false },
		jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
	};

	function doSave() {
		window.html2pdf().set(opts).from(html, "string").save();
	}

	if (window.html2pdf) {
		doSave();
	} else {
		const script = document.createElement("script");
		script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
		script.onload = doSave;
		document.head.appendChild(script);
	}
};
