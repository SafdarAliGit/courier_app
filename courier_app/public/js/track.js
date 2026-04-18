"use strict";
/* ── Track Page ───────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
	const input = document.getElementById("trk-input");
	const btn   = document.getElementById("trk-btn");
	const result = document.getElementById("trk-result");

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

	function doTrack(query) {
		result.style.display = "block";
		result.innerHTML = `<div class="trk-loading"><div class="trk-spinner"></div><p>Searching…</p></div>`;

		frappe.call({
			method: "courier_app.api.shipment_api.track_shipment",
			args: { tracking_number: query },
			error: () => {
				result.innerHTML = `
<div class="trk-not-found">
  <h3>Something went wrong</h3>
  <p>Could not reach the server. Please try again.</p>
</div>`;
			},
			callback: r => {
				const d = r.message;
				if (!d || !d.found) {
					result.innerHTML = `
<div class="trk-not-found">
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="#e5e7eb" stroke-width="1.6"/><path d="M16 16l16 16M32 16L16 32" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/></svg>
  <h3>Shipment not found</h3>
  <p>No shipment matches <b>${escHtml(query)}</b>.<br>Check your tracking number and try again.</p>
</div>`;
					return;
				}

				const statusClass = {
					Pending:"trk-s-pending", Booked:"trk-s-booked",
					"In Transit":"trk-s-transit", "Out for Delivery":"trk-s-out",
					Delivered:"trk-s-delivered", Cancelled:"trk-s-cancelled",
				}[d.status] || "trk-s-pending";

				const steps = ["Pending","Booked","In Transit","Out for Delivery","Delivered"];
				const stepIdx = steps.indexOf(d.status);

				result.innerHTML = `
<div class="trk-card">
  <div class="trk-card-header">
    <div>
      <div class="trk-id">${escHtml(d.name)}</div>
      ${d.tracking_number ? `<div class="trk-tracking-num">${escHtml(d.tracking_number)}</div>` : ""}
    </div>
    <span class="trk-status-badge ${statusClass}">${d.status}</span>
  </div>

  <!-- PROGRESS STEPPER -->
  <div class="trk-stepper">
    ${steps.map((s, i) => `
<div class="trk-step ${i <= stepIdx ? 'trk-step-done' : ''} ${i === stepIdx ? 'trk-step-current' : ''}">
  <div class="trk-step-dot">${i < stepIdx ? '✓' : ''}</div>
  <div class="trk-step-label">${s}</div>
</div>
${i < steps.length-1 ? `<div class="trk-step-line ${i < stepIdx ? 'trk-step-line-done' : ''}"></div>` : ""}
`).join("")}
  </div>

  <div class="trk-details">
    <div class="trk-detail-row">
      <span>Ship date</span><span>${d.ship_date || "—"}</span>
    </div>
    <div class="trk-detail-row">
      <span>Est. delivery</span><span>${d.estimated_delivery || "—"}</span>
    </div>
    <div class="trk-detail-row">
      <span>Service</span><span>${d.service || "—"}</span>
    </div>
    <div class="trk-detail-row">
      <span>Recipient</span><span>${escHtml(d.recipient_name || "—")}</span>
    </div>
    <div class="trk-detail-row">
      <span>Destination</span><span>${escHtml((d.recipient_city || "") + (d.recipient_city && d.recipient_country ? ", " : "") + (d.recipient_country || "—"))}</span>
    </div>
    <div class="trk-detail-row">
      <span>Weight</span><span>${d.total_weight ? (+d.total_weight).toFixed(3) + " kg" : "—"}</span>
    </div>
  </div>
</div>`;
			}
		});
	}

	function escHtml(str) {
		return String(str || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
	}
});
