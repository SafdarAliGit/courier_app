"use strict";
/* ── My Shipments Portal Page ─────────────────────────────────────────────── */

const MyShipments = {
	page: 1,
	pageSize: 15,
	filters: {},
	data: [],

	init() {
		if (!MS_USER_EMAIL || MS_USER_EMAIL === "Guest") return;
		this.filters.email = MS_USER_EMAIL;
		this._loadStatusColors(() => {
			this._populateStatusFilter();
			this.load();
		});
		this.bindFilters();
		this.bindDrawer();
	},

	bindFilters() {
		let t;
		document.getElementById("ms-search")?.addEventListener("input", e => {
			clearTimeout(t);
			t = setTimeout(() => { this.filters.search = e.target.value; this.page = 1; this.load(); }, 350);
		});
		document.getElementById("ms-filter-status")?.addEventListener("change", e => {
			this.filters.status = e.target.value; this.page = 1; this.load();
		});
		document.getElementById("ms-filter-approval")?.addEventListener("change", e => {
			this.filters.approval = e.target.value; this.page = 1; this.load();
		});
		document.getElementById("ms-btn-clear")?.addEventListener("click", () => {
			this.filters = { email: MS_USER_EMAIL };
			["ms-search","ms-filter-status","ms-filter-approval"].forEach(id => {
				const el = document.getElementById(id); if (el) el.value = "";
			});
			this.page = 1; this.load();
		});
	},

	load() {
		document.getElementById("ms-list").innerHTML = `<div class="ms-loading"><div class="ms-spinner"></div><p>Loading…</p></div>`;
		frappe.call({
			method: "courier_app.api.approval_api.get_my_shipments",
			args: { email: MS_USER_EMAIL, page: this.page, page_size: this.pageSize },
			callback: r => {
				const d = r.message || {};
				this.data = d.rows || [];
				this.render(d);
			},
			error: () => {
				document.getElementById("ms-list").innerHTML = `
<div class="ms-empty">
  <h3>Could not load shipments</h3>
  <p>Please refresh the page or <a href="/login">log in again</a>.</p>
</div>`;
			}
		});
	},

	render(d) {
		const list = document.getElementById("ms-list");
		const pg = document.getElementById("ms-pagination");

		if (!d.rows?.length) {
			list.innerHTML = `
<div class="ms-empty">
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="6" y="6" width="44" height="44" rx="10" stroke="#d1d5db" stroke-width="1.6"/><path d="M18 24l10-10 10 10M28 14v22" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"/></svg>
  <h3>No shipments found</h3>
  <p>You haven't submitted any shipments yet.</p>
  <a href="/shipment" class="ca-btn ca-btn-primary">Create your first shipment</a>
</div>`;
			pg.style.display = "none";
			return;
		}

		// Filter client-side for search/approval (quick UX)
		let rows = d.rows;
		if (this.filters.search) {
			const q = this.filters.search.toLowerCase();
			rows = rows.filter(r =>
				(r.name || "").toLowerCase().includes(q) ||
				(r.recipient_name || "").toLowerCase().includes(q) ||
				(r.recipient_country || "").toLowerCase().includes(q) ||
				(r.tracking_number || "").toLowerCase().includes(q)
			);
		}
		if (this.filters.status) rows = rows.filter(r => r.status === this.filters.status);
		if (this.filters.approval) rows = rows.filter(r => r.approval_status === this.filters.approval);

		list.innerHTML = rows.map(r => this.renderCard(r)).join("");

		// Pagination
		if (d.pages > 1) {
			pg.style.display = "flex";
			pg.innerHTML = `
<button class="ms-pg-btn" ${this.page<=1?"disabled":""} id="ms-pg-prev">← Prev</button>
<span>Page ${d.page} of ${d.pages} (${d.total} total)</span>
<button class="ms-pg-btn" ${this.page>=d.pages?"disabled":""} id="ms-pg-next">Next →</button>`;
			document.getElementById("ms-pg-prev")?.addEventListener("click", () => { this.page--; this.load(); });
			document.getElementById("ms-pg-next")?.addEventListener("click", () => { this.page++; this.load(); });
		} else {
			pg.style.display = "none";
		}

		// Bind card clicks
		list.querySelectorAll(".ms-card[data-id]").forEach(card => {
			card.addEventListener("click", () => this.openDrawer(card.dataset.id));
		});
	},

	renderCard(r) {
		const approvalColors = {
			Pending: "ms-appr-pending", Approved: "ms-appr-approved", Rejected: "ms-appr-rejected"
		};
		const cStyle = this._statusStyle(r.status);
		const ac = approvalColors[r.approval_status] || "ms-appr-pending";

		return `
<div class="ms-card" data-id="${r.name}">
  <div class="ms-card-top">
    <div class="ms-card-id">
      <span class="ms-mono">${r.name}</span>
    </div>
    <div class="ms-card-badges">
      <span class="ms-chip" style="${cStyle}">${r.status}</span>
      <span class="ms-appr-chip ${ac}">${r.approval_status || "Pending"}</span>
    </div>
  </div>
  <div class="ms-card-body">
    <div class="ms-card-info">
      <div class="ms-info-item">
        <span class="ms-info-label">Recipient</span>
        <span class="ms-info-val">${r.recipient_name || "—"}</span>
      </div>
      <div class="ms-info-item">
        <span class="ms-info-label">Destination</span>
        <span class="ms-info-val">${r.recipient_city || ""}${r.recipient_city && r.recipient_country ? ", " : ""}${r.recipient_country || "—"}</span>
      </div>
      <div class="ms-info-item">
        <span class="ms-info-label">Ship date</span>
        <span class="ms-info-val">${r.ship_date || "—"}</span>
      </div>
      <div class="ms-info-item">
        <span class="ms-info-label">Service</span>
        <span class="ms-info-val">${r.service || "—"}</span>
      </div>
      <div class="ms-info-item">
        <span class="ms-info-label">Weight</span>
        <span class="ms-info-val">${r.total_weight ? (+r.total_weight).toFixed(3) + " kg" : "—"}</span>
      </div>
      <div class="ms-info-item">
        <span class="ms-info-label">Rate</span>
        <span class="ms-info-val ms-rate">${r.calculated_rate ? "PKR " + Math.round(r.calculated_rate).toLocaleString() : "—"}</span>
      </div>
    </div>
    ${r.sales_order ? `<div class="ms-so-badge"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M3 5h6M3 7h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg> SO: ${r.sales_order}</div>` : ""}
  </div>
  <div class="ms-card-footer">
    <span class="ms-card-date">Submitted ${this.timeAgo(r.creation)}</span>
    <span class="ms-view-link">View details →</span>
  </div>
</div>`;
	},

	timeAgo(dateStr) {
		if (!dateStr) return "";
		const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
		if (diff < 60) return "just now";
		if (diff < 3600) return Math.floor(diff/60) + "m ago";
		if (diff < 86400) return Math.floor(diff/3600) + "h ago";
		return Math.floor(diff/86400) + "d ago";
	},

	openDrawer(id) {
		document.getElementById("ms-drawer-title").textContent = id;
		document.getElementById("ms-drawer-body").innerHTML = `<div class="ms-loading"><div class="ms-spinner"></div></div>`;
		document.getElementById("ms-drawer").classList.add("open");
		document.getElementById("ms-backdrop").classList.add("open");

		frappe.call({
			method: "courier_app.api.approval_api.get_shipment_detail",
			args: { shipment_id: id },
			callback: r => {
				if (r.message) this.renderDrawer(r.message);
			},
			error: () => {
				document.getElementById("ms-drawer-body").innerHTML =
					`<p style="padding:20px;color:var(--text-muted)">Failed to load shipment details.</p>`;
			}
		});
	},

	renderDrawer(d) {
		const body = document.getElementById("ms-drawer-body");

		const statusLine = this.approvalBanner(d.approval_status, d.approved_by, d.approved_on);
		const trackSection = "";

		const soSection = d.sales_order ? `
<div class="ms-drawer-section">
  <div class="ms-drawer-section-title">Sales Order</div>
  <div class="ms-so-info">${d.sales_order}</div>
</div>` : "";

		body.innerHTML = `
${statusLine}
<div class="ms-drawer-section">
  <div class="ms-drawer-section-title">Shipment Overview</div>
  <div class="ms-detail-grid">
    ${this.di("Shipment ID", `<span class="ms-mono">${d.name}</span>`)}
    ${this.di("Status", `<span class="ms-chip" style="${this._statusStyle(d.status)}">${d.status}</span>`)}
    ${this.di("Ship Date", d.ship_date || "—")}
    ${this.di("Service", d.service || "—")}
    ${this.di("Weight", d.total_weight ? d.total_weight.toFixed(3) + " kg" : "—")}
    ${this.di("Rate", d.calculated_rate ? "PKR " + Math.round(d.calculated_rate).toLocaleString() : "—")}
  </div>
</div>
${trackSection}
<div class="ms-drawer-section">
  <div class="ms-drawer-section-title">Sender</div>
  <div class="ms-detail-grid">
    ${this.di("Name", d.sender_name)}
    ${this.di("Phone", d.sender_phone)}
    ${this.di("City", d.sender_city)}
    ${this.di("Country", d.sender_country)}
  </div>
</div>
<div class="ms-drawer-section">
  <div class="ms-drawer-section-title">Recipient</div>
  <div class="ms-detail-grid">
    ${this.di("Name", d.recipient_name)}
    ${this.di("Phone", d.recipient_phone)}
    ${this.di("Address", [d.recipient_address_line1, d.recipient_address_line2].filter(Boolean).join(", "))}
    ${this.di("City", d.recipient_city)}
    ${this.di("Country", d.recipient_country)}
    ${this.di("ZIP", d.recipient_zip || "—")}
  </div>
</div>
${(d.packages||[]).length ? `
<div class="ms-drawer-section">
  <div class="ms-drawer-section-title">Packages (${d.packages.length})</div>
  ${d.packages.map((p,i) => `<div class="ms-pkg-row"><b>#${i+1}</b> ${p.weight} ${p.weight_unit} &nbsp; ${p.length||"—"} × ${p.width||"—"} × ${p.height||"—"} cm &nbsp; ${p.description||""}</div>`).join("")}
</div>` : ""}
${soSection}`;
	},

	approvalBanner(status, by, on) {
		const cls = { Approved: "ms-banner-approved", Rejected: "ms-banner-rejected", Pending: "ms-banner-pending" }[status] || "ms-banner-pending";
		const icon = status === "Approved" ? "✓" : status === "Rejected" ? "✗" : "⏳";
		const msg = status === "Approved"
			? `Approved by ${by || "admin"} on ${on ? new Date(on).toLocaleDateString() : "—"}`
			: status === "Rejected"
			? `Rejected by ${by || "admin"}`
			: "Awaiting approval from our team";
		return `<div class="ms-status-banner ${cls}"><span>${icon}</span><span>${msg}</span></div>`;
	},

	di(label, val) {
		return `<div class="ms-di"><div class="ms-di-label">${label}</div><div class="ms-di-val">${val || "—"}</div></div>`;
	},

	_colorMap: {
		Blue:{bg:"#dbeafe",color:"#1d4ed8"},Green:{bg:"#d1fae5",color:"#065f46"},
		Yellow:{bg:"#fef3c7",color:"#92400e"},Orange:{bg:"#fff7ed",color:"#c2410c"},
		Purple:{bg:"#ede9fe",color:"#5b21b6"},Red:{bg:"#fee2e2",color:"#991b1b"},
		Gray:{bg:"#f1f5f9",color:"#475569"},Teal:{bg:"#ccfbf1",color:"#0f766e"},
		Cyan:{bg:"#e0f2fe",color:"#0369a1"},Pink:{bg:"#fce7f3",color:"#9d174d"},
	},
	_statusColors: null,

	_loadStatusColors(cb) {
		if (this._statusColors) { if (cb) cb(); return; }
		frappe.call({
			method: "courier_app.api.status_api.list_statuses",
			callback: r => {
				this._statusColors = {};
				(r.message || []).forEach(s => {
					this._statusColors[s.status || s.name] = s.color || "Gray";
				});
				if (cb) cb();
			}
		});
	},

	_statusStyle(status) {
		const colorName = (this._statusColors && this._statusColors[status]) || "Gray";
		const c = this._colorMap[colorName] || this._colorMap.Gray;
		return `background:${c.bg};color:${c.color};padding:2px 10px;border-radius:100px;font-size:11px;font-weight:600;white-space:nowrap`;
	},

	_populateStatusFilter() {
		const sel = document.getElementById("ms-filter-status");
		if (!sel || !this._statusColors) return;
		sel.innerHTML = '<option value="">All statuses</option>';
		Object.keys(this._statusColors).forEach(s => {
			sel.innerHTML += `<option value="${s}">${s}</option>`;
		});
	},

	statusClass(status) {
		return "";
	},

	bindDrawer() {
		document.getElementById("ms-drawer-close")?.addEventListener("click", () => this.closeDrawer());
		document.getElementById("ms-backdrop")?.addEventListener("click", () => this.closeDrawer());
	},

	closeDrawer() {
		document.getElementById("ms-drawer")?.classList.remove("open");
		document.getElementById("ms-backdrop")?.classList.remove("open");
	},
};

document.addEventListener("DOMContentLoaded", () => MyShipments.init());
