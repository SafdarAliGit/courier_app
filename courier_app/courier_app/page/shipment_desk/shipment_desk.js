/* ── CourierApp Shipment Manager ─────────────────────────────────────────── */

frappe.pages["shipment-desk"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "Shipment Manager", single_column: true });

	if (!document.getElementById("ca-desk-font")) {
		const l = document.createElement("link");
		l.id = "ca-desk-font"; l.rel = "stylesheet";
		l.href = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap";
		document.head.appendChild(l);
	}
	if (!document.getElementById("ca-desk-css")) {
		const l = document.createElement("link");
		l.id = "ca-desk-css"; l.rel = "stylesheet";
		l.href = "/assets/courier_app/css/desk.css";
		document.head.appendChild(l);
	}

	/* Hide Frappe's sticky page-head — we render our own toolbar inside
	   the content area. This also fixes a z-index bug where the page-head
	   intercepts clicks on our custom buttons. */
	const pageHead = wrapper.querySelector(".page-head");
	if (pageHead) pageHead.style.display = "none";

	/* Strip Bootstrap container / grid gutters for full-width layout */
	const pbody = wrapper.querySelector(".page-body");
	if (pbody) { pbody.style.maxWidth = "none"; pbody.style.padding = "0 8px"; }
	const lm = wrapper.querySelector(".layout-main");
	if (lm) { lm.style.marginLeft = "0"; lm.style.marginRight = "0"; }
	const lmw = wrapper.querySelector(".layout-main-section-wrapper");
	if (lmw) { lmw.style.paddingLeft = "0"; lmw.style.paddingRight = "0"; }

	const mainEl = page.main instanceof jQuery ? page.main[0] : page.main;
	mainEl.innerHTML = '<div id="desk-root"></div>';
	const root = mainEl.querySelector("#desk-root");
	CourierDesk.mount(root, page);
};

frappe.pages["shipment-desk"].on_page_show = function () {
	if (window.CourierDesk && CourierDesk.root) {
		/* Skip reload on the very first show — mount() already kicked off the
		   initial load. Re-triggering here caused a double API call + race
		   condition in Firefox that left the page blank or unresponsive. */
		if (CourierDesk._justMounted) {
			CourierDesk._justMounted = false;
			return;
		}
		CourierDesk.loadStats();
		CourierDesk.load();
	}
};

/* ═══════════════════════════════════════════════════════════════════════════ */
window.CourierDesk = {

	/* ── MOUNT (called once) ─────────────────────────────────────────────── */
	mount(root, page) {
		this.root  = root;
		this.page  = page;
		this.pg    = 1;
		this.pgSize = 20;
		this.sortBy = "creation";
		this.sortDir = "desc";
		this.filters = {};
		this.rows  = [];
		this.total = 0;
		this.pages = 0;
		this.sel   = new Set();
		this._justMounted = true;   // prevents on_page_show double-load

		this.build();
		this.loadStats();
		this.load();
		this._loadProviders();
		this._loadAllCountries();
	},

	/* ── HELPERS ─────────────────────────────────────────────────────────── */
	q(id)    { return this.root.querySelector("#" + id); },
	qa(sel)  { return Array.from(this.root.querySelectorAll(sel)); },

	/* ── SHELL ────────────────────────────────────────────────────────────── */
	build() {
		this.root.innerHTML = `
<div class="dk-toolbar">
  <span class="dk-toolbar-title">Shipment Manager</span>
  <div class="dk-toolbar-actions">
    <button class="dk-btn dk-btn-ghost" id="dk-refresh">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.65-3.6L12.5 2M12.5 5V2h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 7a5.5 5.5 0 0 1-9.65 3.6L1.5 12M1.5 9v3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Refresh
    </button>
    <button class="dk-btn dk-btn-ghost" id="dk-export">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 10v2h10v-2M7 1v7M4 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Export CSV
    </button>
    <button class="dk-btn dk-btn-ghost" id="dk-export-pdf">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M4 4h4M4 7h4M4 10h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 8l3 3M10 11l3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Export PDF
    </button>
    <button class="dk-btn dk-btn-ghost" id="dk-track-btn">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10 10l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      Track Shipment
    </button>
    <button class="dk-btn dk-btn-primary" id="dk-new">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      New Shipment
    </button>
  </div>
</div>

<div class="dk-stats-row" id="dk-stats">
  ${Array(8).fill('<div class="dk-stat-card"><div class="dk-skeleton" style="height:10px;width:60%;margin-bottom:9px"></div><div class="dk-skeleton" style="height:26px;width:40%"></div></div>').join("")}
</div>

<div class="dk-bulk-bar" id="dk-bulk">
  <span><span id="dk-bulk-n">0</span> selected</span>
  <div class="dk-bulk-actions">
    <button class="dk-btn bulk-approve" data-bulk-action="approve">✓ Approve</button>
    <button class="dk-btn bulk-reject"  data-bulk-action="reject">✗ Reject</button>
    <button class="dk-btn" data-bulk-status="Booked">Booked</button>
    <button class="dk-btn" data-bulk-status="In Transit">In Transit</button>
    <button class="dk-btn" data-bulk-status="Out for Delivery">Out for Delivery</button>
    <button class="dk-btn" data-bulk-status="Delivered">Delivered</button>
    <button class="dk-btn" data-bulk-status="Cancelled">Cancel</button>
  </div>
  <button class="dk-btn-close" id="dk-bulk-clear">✕</button>
</div>

<div class="dk-filter-bar">
  <div class="dk-search-wrap">
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10 10l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    <input class="dk-input dk-search" id="dk-search" type="text" placeholder="Search ID, tracking, recipient, country…" style="width:100%">
  </div>
  <div class="dk-filter-sep"></div>
  <select class="dk-input dk-select" id="dk-f-status">
    <option value="">All Statuses</option>
    <option>Draft</option><option>Pending</option><option>Booked</option>
    <option>In Transit</option><option>Out for Delivery</option>
    <option>Delivered</option><option>Cancelled</option>
  </select>
  <select class="dk-input dk-select" id="dk-f-appr">
    <option value="">All Approvals</option>
    <option value="Pending">Pending Approval</option>
    <option value="Approved">Approved</option>
    <option value="Rejected">Rejected</option>
  </select>
  <select class="dk-input dk-select" id="dk-f-type">
    <option value="">All Types</option>
    <option>Outbound</option><option>Inbound</option><option>Return</option>
  </select>
  <div class="dk-filter-sep"></div>
  <input class="dk-input" id="dk-f-from" type="date" title="Ship date from" style="width:130px">
  <input class="dk-input" id="dk-f-to"   type="date" title="Ship date to"   style="width:130px">
  <div class="dk-filter-sep"></div>
  <button class="dk-btn dk-btn-ghost dk-btn-sm" id="dk-clear-f">Clear</button>
  <select class="dk-input dk-select" id="dk-pgsize" style="width:96px">
    <option value="20">20 / page</option>
    <option value="50">50 / page</option>
    <option value="100">100 / page</option>
  </select>
</div>

<div class="dk-table-wrap" id="dk-table">
  <div class="dk-empty"><p>Loading…</p></div>
</div>

<div class="dk-drawer-backdrop" id="dk-bd"></div>
<div class="dk-drawer" id="dk-drawer">
  <div class="dk-drawer-header">
    <div class="dk-drw-title-wrap">
      <h3 id="dk-drw-title">Shipment</h3>
      <div id="dk-drw-meta" class="dk-drw-meta"></div>
    </div>
    <span id="dk-drw-badge" class="dk-drw-mode-badge view" style="display:none"></span>
    <button class="dk-btn dk-btn-ghost dk-btn-icon dk-btn-sm" id="dk-drw-close">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
  </div>
  <div class="dk-drawer-body" id="dk-drw-body"><div class="dk-empty"><p>Select a shipment</p></div></div>
  <div class="dk-drawer-actions" id="dk-drw-actions"></div>
</div>`;

		this.bindAll();
	},

	/* ── BIND ALL ─────────────────────────────────────────────────────────── */
	bindAll() {
		/* toolbar */
		this.q("dk-refresh").addEventListener("click", () => { this.loadStats(); this.load(); });
		this.q("dk-new").addEventListener("click", () => this.openShipmentForm());
		this.q("dk-export").addEventListener("click", () => this.exportCSV());
		this.q("dk-export-pdf").addEventListener("click", () => this.exportPDF());
		this.q("dk-track-btn").addEventListener("click", () => this.openTrackModal());

		/* filters */
		let searchT;
		this.q("dk-search").addEventListener("input", e => {
			clearTimeout(searchT);
			searchT = setTimeout(() => { this.filters.search = e.target.value; this.pg = 1; this.load(); }, 320);
		});
		[["dk-f-status","status"],["dk-f-appr","approval_status"],["dk-f-type","shipment_type"]].forEach(([id,key]) => {
			this.q(id).addEventListener("change", e => {
				this.filters[key] = e.target.value; this.pg = 1; this.load();
				if (key === "status" || key === "approval_status") this.refreshStatActive();
			});
		});
		this.q("dk-f-from").addEventListener("change", e => { this.filters.date_from = e.target.value; this.pg = 1; this.load(); });
		this.q("dk-f-to")  .addEventListener("change", e => { this.filters.date_to   = e.target.value; this.pg = 1; this.load(); });
		this.q("dk-pgsize").addEventListener("change", e => { this.pgSize = +e.target.value; this.pg = 1; this.load(); });
		this.q("dk-clear-f").addEventListener("click", () => {
			this.filters = {};
			["dk-search","dk-f-status","dk-f-appr","dk-f-type","dk-f-from","dk-f-to"].forEach(id => {
				const el = this.q(id); if (el) el.value = "";
			});
			this.pg = 1; this.load(); this.refreshStatActive();
		});

		/* bulk */
		this.qa("[data-bulk-status]").forEach(btn => {
			btn.addEventListener("click", () => {
				const status = btn.dataset.bulkStatus;
				const names  = [...this.sel]; if (!names.length) return;
				frappe.confirm(`Update ${names.length} shipment(s) to "${status}"?`, () => {
					let done = 0;
					names.forEach(name => frappe.call({
						method: "courier_app.api.shipment_api.update_status",
						args: { shipment_id: name, new_status: status },
						callback: () => { if (++done === names.length) { this.toast(`${done} updated to "${status}"`, "success"); this.loadStats(); this.load(); } }
					}));
				});
			});
		});
		this.root.querySelector("[data-bulk-action='approve']").addEventListener("click", () => {
			const names = [...this.sel]; if (!names.length) return;
			frappe.confirm(`Approve ${names.length} shipment(s)?<br><small>A Sales Order will be created for each.</small>`, () => {
				let done = 0, fail = 0;
				const next = i => {
					if (i >= names.length) {
						this.toast(`Approved ${done}${fail ? ", " + fail + " failed" : ""}`, done ? "success" : "error");
						this.loadStats(); this.load(); return;
					}
					frappe.call({
						method: "courier_app.api.approval_api.approve_shipment",
						args: { shipment_id: names[i] },
						callback: () => { done++; next(i + 1); },
						error:    () => { fail++;  next(i + 1); }
					});
				};
				next(0);
			});
		});
		this.root.querySelector("[data-bulk-action='reject']").addEventListener("click", () => {
			const names = [...this.sel]; if (!names.length) return;
			this.rejectModal(names, () => { this.loadStats(); this.load(); });
		});
		this.q("dk-bulk-clear").addEventListener("click", () => {
			this.sel.clear(); this.refreshBulk();
			this.qa(".dk-row-chk").forEach(c => c.checked = false);
			this.qa("tr[data-name]").forEach(tr => tr.classList.remove("selected"));
		});

		/* drawer close */
		this.q("dk-drw-close").addEventListener("click", () => this.closeDrawer());
		this.q("dk-bd").addEventListener("click", () => this.closeDrawer());
		document.addEventListener("keydown", e => { if (e.key === "Escape") this.closeDrawer(); });
	},

	/* ── STATS ────────────────────────────────────────────────────────────── */
	loadStats() {
		frappe.call({
			method: "courier_app.api.shipment_api.get_dashboard_stats",
			callback: r => {
				const s = r.message || {};
				this.q("dk-stats").innerHTML = [
					this.sc("Total",         s.total            || 0, "",              ""),
					this.sc("Pending",       s.pending          || 0, "dk-stat-amber", "Pending"),
					this.sc("Booked",        s.booked           || 0, "dk-stat-blue",  "Booked"),
					this.sc("In Transit",    s.in_transit       || 0, "dk-stat-blue",  "In Transit"),
					this.sc("Delivered",     s.delivered        || 0, "dk-stat-green", "Delivered"),
					this.sc("Cancelled",     s.cancelled        || 0, "dk-stat-red",   "Cancelled"),
					this.sc("Pending Appr.", s.pending_approval || 0, "dk-stat-amber", "", "appr"),
					this.sc("PKR Revenue",   "PKR " + Math.round(s.total_revenue || 0).toLocaleString(), "", "", "none"),
				].join("");
				this.refreshStatActive();
				this.qa(".dk-stat-card[data-sf]").forEach(c => {
					c.addEventListener("click", () => {
						const mode = c.dataset.mode || "status";
						if (mode === "none") return;
						if (mode === "appr") {
							const el = this.q("dk-f-appr");
							const same = this.filters.approval_status === "Pending";
							el.value = same ? "" : "Pending";
							this.filters.approval_status = same ? "" : "Pending";
						} else {
							const el = this.q("dk-f-status");
							const same = this.filters.status === c.dataset.sf;
							el.value = same ? "" : c.dataset.sf;
							this.filters.status = same ? "" : c.dataset.sf;
						}
						this.pg = 1; this.load(); this.refreshStatActive();
					});
				});
			}
		});
	},

	sc(label, val, cls, sf, mode) {
		return `<div class="dk-stat-card ${cls}" data-sf="${sf}" data-mode="${mode || "status"}"><div class="dk-stat-label">${label}</div><div class="dk-stat-value">${val}</div></div>`;
	},

	refreshStatActive() {
		this.qa(".dk-stat-card").forEach(c => c.classList.remove("active"));
		if (this.filters.status) {
			const c = this.root.querySelector(`.dk-stat-card[data-sf="${this.filters.status}"]`);
			if (c) c.classList.add("active");
		}
		if (this.filters.approval_status === "Pending") {
			const c = this.root.querySelector(`.dk-stat-card[data-mode="appr"]`);
			if (c) c.classList.add("active");
		}
	},

	/* ── LOAD ─────────────────────────────────────────────────────────────── */
	load() {
		this.q("dk-table").innerHTML = `<div class="dk-empty"><p>Loading…</p></div>`;
		frappe.call({
			method: "courier_app.api.shipment_api.get_shipments",
			args: {
				filters: JSON.stringify(this.filters),
				page: this.pg, page_size: this.pgSize,
				sort_by: this.sortBy, sort_order: this.sortDir,
			},
			callback: r => {
				const d = r.message || {};
				this.rows  = d.rows  || [];
				this.total = d.total || 0;
				this.pages = d.pages || 1;
				this.sel.clear();
				this.refreshBulk();
				this.renderTable();
			}
		});
	},

	/* ── TABLE ────────────────────────────────────────────────────────────── */
	renderTable() {
		const wrap = this.q("dk-table");
		if (!this.rows.length) {
			wrap.innerHTML = `<div class="dk-empty"><svg width="42" height="42" viewBox="0 0 42 42" fill="none"><rect x="5" y="3" width="32" height="36" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="M13 13h16M13 19h12M13 25h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><p>No shipments found</p></div>`;
			return;
		}
		const cols = [
			{ k:"name",             l:"Shipment ID",  s:true  },
			{ k:"status",           l:"Status",       s:true  },
			{ k:"approval_status",  l:"Approval",     s:true  },
			{ k:"shipment_type",    l:"Type",         s:false },
			{ k:"recipient_name",   l:"Recipient",    s:true  },
			{ k:"recipient_country",l:"Country",      s:true  },
			{ k:"ship_date",        l:"Ship Date",    s:true  },
			{ k:"services",         l:"Services",     s:false },
			{ k:"total_weight",         l:"Wt (kg)",      s:true  },
			{ k:"total_actual_weight",  l:"Act. Wt",      s:false },
			{ k:"calculated_rate",      l:"Rate (PKR)",   s:true  },
			{ k:"_act",             l:"",             s:false },
		];
		wrap.innerHTML = `
<table class="dk-table">
  <thead><tr>
    <th class="dk-check-col"><input type="checkbox" id="dk-chk-all"></th>
    ${cols.map(c => `<th ${c.s ? `data-sort="${c.k}"` : ""} class="${this.sortBy===c.k?"sorted":""}">${c.l}${c.s?`<span class="sort-icon">${this.sortBy===c.k?(this.sortDir==="asc"?"↑":"↓"):"↕"}</span>`:""}</th>`).join("")}
  </tr></thead>
  <tbody>${this.rows.map(r => this.renderRow(r)).join("")}</tbody>
</table>
${this.renderPager()}`;
		this.bindTable(wrap);
	},

	renderRow(r) {
		const sb = {Draft:"dk-badge-draft",Pending:"dk-badge-pending",Booked:"dk-badge-booked","In Transit":"dk-badge-transit","Out for Delivery":"dk-badge-out",Delivered:"dk-badge-delivered",Cancelled:"dk-badge-cancelled"}[r.status]||"dk-badge-draft";
		const ap = r.approval_status || "Pending";
		const ac = {Approved:"dk-appr-approved",Rejected:"dk-appr-rejected",Pending:"dk-appr-pending"}[ap]||"dk-appr-pending";
		const tc = {Outbound:"dk-type-outbound",Inbound:"dk-type-inbound",Return:"dk-type-return"}[r.shipment_type]||"";
		return `
<tr data-name="${r.name}" class="${this.sel.has(r.name)?"selected":""}">
  <td class="dk-check-col" onclick="event.stopPropagation()">
    <input type="checkbox" class="dk-row-chk" data-name="${r.name}" ${this.sel.has(r.name)?"checked":""}>
  </td>
  <td class="dk-td-mono" style="font-weight:600">${r.name}${r.submitted_by_portal?`<span class="dk-portal-dot" title="Via portal"></span>`:""}</td>
  <td><span class="dk-badge ${sb}">${r.status}</span></td>
  <td><span class="dk-appr ${ac}">${ap}</span></td>
  <td><span class="dk-type-chip ${tc}">${r.shipment_type||"—"}</span></td>
  <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.recipient_name||"—"}</td>
  <td class="dk-td-muted">${r.recipient_country||"—"}</td>
  <td class="dk-td-muted">${r.ship_date||"—"}</td>
  <td class="dk-td-muted" style="font-size:12px">${r.services||"—"}</td>
  <td class="dk-td-right dk-td-mono">${r.total_weight?(+r.total_weight).toFixed(2):"—"}</td>
  <td class="dk-td-right dk-td-mono" style="color:var(--dk-sub)">${r.total_actual_weight&&+r.total_actual_weight>0?(+r.total_actual_weight).toFixed(3):"—"}</td>
  <td class="dk-td-right dk-td-mono" style="font-weight:600">${r.calculated_rate?Math.round(r.calculated_rate).toLocaleString():"—"}</td>
  <td onclick="event.stopPropagation()" style="white-space:nowrap">
    <button class="dk-btn dk-btn-ghost dk-btn-sm dk-btn-icon" data-view="${r.name}" title="View">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>
    </button>
    <button class="dk-btn dk-btn-ghost dk-btn-sm dk-btn-icon" data-edit="${r.name}" title="Edit">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.5 1.5 0 0 1 2 2L4 10 1 11l1-3 6.5-6.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </td>
</tr>`;
	},

	renderPager() {
		if (this.total <= this.pgSize) return "";
		const s = (this.pg - 1) * this.pgSize + 1;
		const e = Math.min(this.pg * this.pgSize, this.total);
		let pgs = [];
		for (let i = Math.max(1, this.pg - 3); i <= Math.min(this.pages, this.pg + 3); i++) pgs.push(i);
		return `<div class="dk-pagination">
  <span>Showing ${s}–${e} of ${this.total.toLocaleString()}</span>
  <div class="dk-page-btns">
    <button class="dk-page-btn" data-pgo="first" ${this.pg<=1?"disabled":""}>«</button>
    <button class="dk-page-btn" data-pgo="prev"  ${this.pg<=1?"disabled":""}>‹</button>
    ${pgs.map(p=>`<button class="dk-page-btn${p===this.pg?" active":""}" data-pgn="${p}">${p}</button>`).join("")}
    <button class="dk-page-btn" data-pgo="next"  ${this.pg>=this.pages?"disabled":""}>›</button>
    <button class="dk-page-btn" data-pgo="last"  ${this.pg>=this.pages?"disabled":""}>»</button>
  </div>
  <span>Page ${this.pg} / ${this.pages}</span>
</div>`;
	},

	bindTable(wrap) {
		/* sort headers */
		wrap.querySelectorAll("th[data-sort]").forEach(th => {
			th.style.cursor = "pointer";
			th.addEventListener("click", () => {
				if (this.sortBy === th.dataset.sort) this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
				else { this.sortBy = th.dataset.sort; this.sortDir = "desc"; }
				this.load();
			});
		});
		/* select-all */
		const chkAll = wrap.querySelector("#dk-chk-all");
		if (chkAll) chkAll.addEventListener("change", () => {
			this.rows.forEach(r => chkAll.checked ? this.sel.add(r.name) : this.sel.delete(r.name));
			wrap.querySelectorAll(".dk-row-chk").forEach(c => c.checked = chkAll.checked);
			wrap.querySelectorAll("tr[data-name]").forEach(tr => tr.classList.toggle("selected", chkAll.checked));
			this.refreshBulk();
		});
		/* row checkboxes */
		wrap.querySelectorAll(".dk-row-chk").forEach(chk => {
			chk.addEventListener("change", () => {
				chk.checked ? this.sel.add(chk.dataset.name) : this.sel.delete(chk.dataset.name);
				chk.closest("tr").classList.toggle("selected", chk.checked);
				this.refreshBulk();
			});
		});
		/* row click → drawer */
		wrap.querySelectorAll("tr[data-name]").forEach(tr => {
			tr.addEventListener("click", () => this.openDrawer(tr.dataset.name));
		});
		wrap.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); this.openDrawer(b.dataset.view); }));
		wrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); this.openShipmentForm(b.dataset.edit); }));
		wrap.querySelectorAll("[data-track-id]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); this.openTrackModal(b.dataset.trackId); }));
		/* pagination */
		wrap.querySelectorAll("[data-pgn]").forEach(b => b.addEventListener("click", () => { this.pg = +b.dataset.pgn; this.load(); }));
		wrap.querySelectorAll("[data-pgo]").forEach(b => b.addEventListener("click", () => {
			const o = b.dataset.pgo;
			if      (o === "first" && this.pg > 1)          this.pg = 1;
			else if (o === "last"  && this.pg < this.pages) this.pg = this.pages;
			else if (o === "prev"  && this.pg > 1)          this.pg--;
			else if (o === "next"  && this.pg < this.pages) this.pg++;
			this.load();
		}));
	},

	refreshBulk() {
		const bar = this.q("dk-bulk");
		const n   = this.sel.size;
		bar.classList.toggle("visible", n > 0);
		this.q("dk-bulk-n").textContent = n;
	},

	/* ── DRAWER ───────────────────────────────────────────────────────────── */
	openDrawer(name) {
		this.q("dk-drw-title").textContent = "Shipment Details";
		this.q("dk-drw-meta").textContent = name;
		const badge = this.q("dk-drw-badge");
		badge.textContent = "View"; badge.className = "dk-drw-mode-badge view"; badge.style.display = "";
		this.q("dk-drw-body").innerHTML = `<div class="dk-empty"><p>Loading…</p></div>`;
		this.q("dk-drw-actions").innerHTML = "";
		this.q("dk-drawer").classList.add("open");
		this.q("dk-bd").classList.add("open");

		frappe.call({
			method: "courier_app.api.approval_api.get_shipment_detail",
			args: { shipment_id: name },
			callback: r => { if (r.message) this.renderDrawer(r.message); }
		});
	},

	closeDrawer() {
		this.q("dk-drawer").classList.remove("open");
		this.q("dk-bd").classList.remove("open");
		this.loadStats();
		this.load();
	},

	_deskInvoice(shipmentId, asPDF = false) {
		if (asPDF) {
			const url = `/api/method/courier_app.api.invoice_api.get_invoice_pdf?name=${encodeURIComponent(shipmentId)}`;
			const a = document.createElement("a");
			a.href = url; a.download = `Invoice-${shipmentId}.pdf`;
			document.body.appendChild(a); a.click(); document.body.removeChild(a);
			return;
		}
		const win = window.open("", "_blank", "width=960,height=740,scrollbars=yes,resizable=yes");
		if (!win) { this.toast("Allow pop-ups to print the invoice", "error"); return; }
		win.document.write("<html><head><title>Loading…</title></head><body style='display:flex;align-items:center;justify-content:center;height:100vh;color:#555;font-family:sans-serif'><p>Generating invoice…</p></body></html>");
		win.document.close();
		frappe.call({
			method: "courier_app.api.invoice_api.get_invoice_html",
			args: { name: shipmentId },
			callback: r => {
				if (!r.message) { win.close(); this.toast("Invoice generation failed", "error"); return; }
				win.document.open(); win.document.write(r.message); win.document.close();
			},
			error: () => { win.close(); this.toast("Failed to load invoice", "error"); }
		});
	},

	renderDrawer(d) {
		const ap  = d.approval_status || "Pending";
		const apBannerCls = {Approved:"dk-appr-approved",Rejected:"dk-appr-rejected",Pending:"dk-appr-waiting"}[ap];
		const apIcon = {Approved:"✓",Rejected:"✗",Pending:"⏳"}[ap];
		const apMsg  = ap==="Approved"
			? `Approved by ${d.approved_by||"admin"}${d.approved_on?" · "+new Date(d.approved_on).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}`
			: ap==="Rejected" ? `Rejected by ${d.approved_by||"admin"}` : "Awaiting approval";

		const custHtml = d.customer ? `
<div class="dk-detail-section">
  <div class="dk-form-section-title">Customer</div>
  <div class="dk-cust-card">
    <div class="dk-cust-avatar">${((d.customer_info?.customer_name||d.customer||"?")[0]).toUpperCase()}</div>
    <div>
      <div class="dk-cust-name">${d.customer_info?.customer_name||d.customer}</div>
      <div class="dk-cust-meta">${[d.customer_info?.mobile_no,d.customer_info?.email_id].filter(Boolean).join(" · ")||"—"}</div>
      <span class="dk-cust-link" onclick="frappe.set_route('Form','Customer','${d.customer}')">Open customer record →</span>
    </div>
  </div>
</div>` : "";

		const soHtml = d.sales_order ? `
<div class="dk-detail-section">
  <div class="dk-form-section-title">Sales Order</div>
  <div class="dk-so-card">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="opacity:.6;flex-shrink:0"><rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 8.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    <span class="dk-so-name">${d.sales_order}</span>
    <span class="dk-so-link" onclick="frappe.set_route('Form','Sales Order','${d.sales_order}')">Open SO →</span>
  </div>
</div>` : "";

		const pkgHtml = (d.packages||[]).length ? (() => {
			const pkgs = d.packages;
			const total = pkgs.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
			const rows  = pkgs.map((p, i) => {
				const amt = parseFloat(p.amount || 0);
				const wKg = (p.weight_unit === "lb") ? (parseFloat(p.weight||0) * 0.453592) : parseFloat(p.weight||0);
				const l = parseFloat(p.length||0), w = parseFloat(p.width||0), h = parseFloat(p.height||0);
				const volKg = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 5000 : 0;
				const isVol = volKg > wKg;
				const dispAw = wKg > 0 ? (isVol ? volKg : wKg).toFixed(3) : "—";
				const awStyle = isVol ? `background:red;color:#fff;border-radius:3px;padding:1px 5px;font-family:var(--dk-mono)` : `font-family:var(--dk-mono)`;
				return `<tr>
					<td>${i+1}</td>
					<td style="font-family:var(--dk-mono)">${p.weight} ${p.weight_unit}</td>
					<td style="font-family:var(--dk-mono)">${p.length||"—"} × ${p.width||"—"} × ${p.height||"—"}</td>
					<td style="text-align:center"><span style="${awStyle}">${dispAw}</span></td>
					<td style="font-family:var(--dk-mono);font-weight:600;text-align:right">${amt > 0 ? "PKR " + Math.round(amt).toLocaleString() : "—"}</td>
				</tr>`;
			}).join("");
			const tfoot = total > 0 ? `<tfoot><tr>
				<td colspan="4" style="text-align:right;font-weight:600;padding-right:8px">Total</td>
				<td style="font-family:var(--dk-mono);font-weight:700;text-align:right">PKR ${Math.round(total).toLocaleString()}</td>
			</tr></tfoot>` : "";
			return `
<div class="dk-detail-section">
  <div class="dk-form-section-title">Packages &amp; Rate Breakdown (${pkgs.length})</div>
  <table class="dk-pkg-table">
    <thead><tr><th>#</th><th>Weight</th><th>Dimensions (cm)</th><th style="text-align:center">Act. Wt (kg)</th><th style="text-align:right">Amount (PKR)</th></tr></thead>
    <tbody>${rows}</tbody>
    ${tfoot}
  </table>
</div>`;
		})() : "";

		const commHtml = (d.commodities||[]).length ? (() => {
			const comms = d.commodities;
			const total = comms.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
			const rows  = comms.map((c, i) => {
				const amt = parseFloat(c.amount || 0);
				return `<tr>
					<td>${i+1}</td>
					<td>${c.description||"—"}</td>
					<td style="font-family:var(--dk-mono)">${parseFloat(c.units||0).toFixed(3)}</td>
					<td>${c.uom||"—"}</td>
					<td style="font-family:var(--dk-mono)">${parseFloat(c.price||0).toFixed(2)}</td>
					<td style="font-family:var(--dk-mono)">${c.hs_code||"—"}</td>
					<td style="font-family:var(--dk-mono);font-weight:600;text-align:right">${amt > 0 ? amt.toFixed(2) : "—"}</td>
				</tr>`;
			}).join("");
			const tfoot = total > 0 ? `<tfoot><tr>
				<td colspan="6" style="text-align:right;font-weight:600;padding-right:8px">Declared Value</td>
				<td style="font-family:var(--dk-mono);font-weight:700;text-align:right">${total.toFixed(2)}</td>
			</tr></tfoot>` : "";
			return `
<div class="dk-detail-section">
  <div class="dk-form-section-title">Commodities (${comms.length})</div>
  <table class="dk-pkg-table dk-comm-table">
    <thead><tr><th>#</th><th>Description</th><th>Units</th><th>UOM</th><th>Price</th><th>HS Code</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    ${tfoot}
  </table>
</div>`;
		})() : "";

		const body = this.q("dk-drw-body");
		body.innerHTML = `
<div class="dk-appr-banner ${apBannerCls}">
  <span>${apIcon}</span>
  <span>${apMsg}</span>
</div>

${custHtml}${soHtml}

<div class="dk-detail-section">
  <div class="dk-form-section-title">Shipment Info</div>
  <div class="dk-detail-grid" style="grid-template-columns:repeat(4,1fr)">
    ${this.di("ID", d.name)} ${this.di("Status", d.status)} ${this.di("Type", d.shipment_type)} ${this.di("Provider", d.service_provider||"—")}
    ${this.di("Ship Date", d.ship_date)} ${this.di("Services", d.services)} ${this.di("Weight", d.total_weight ? d.total_weight + " kg" : "—")} ${this.di("Rate", d.calculated_rate ? "PKR " + Math.round(d.calculated_rate).toLocaleString() : "—")}
    ${this.di("Ref", d.customer_reference||"—")}
  </div>
</div>

<div class="dk-drw-addr-row">
  <div class="dk-detail-section">
    <div class="dk-form-section-title">Sender</div>
    <div class="dk-detail-grid" style="grid-template-columns:1fr 1fr">
      ${this.di("Name", d.sender_name||"—")} ${this.di("Company", d.sender_company||"—")}
      ${this.di("Phone", d.sender_phone||"—")} ${this.di("Email", d.sender_email||"—")}
      ${this.di("Address", [d.sender_address_line1,d.sender_address_line2].filter(Boolean).join(", ")||"—")}
      ${this.di("Country", d.sender_country||"—")} ${this.di("State", d.sender_state||"—")} ${this.di("City", d.sender_city||"—")} ${this.di("ZIP", d.sender_zip||"—")}
    </div>
  </div>
  <div class="dk-detail-section">
    <div class="dk-form-section-title">Recipient</div>
    <div class="dk-detail-grid" style="grid-template-columns:1fr 1fr">
      ${this.di("Name", d.recipient_name||"—")} ${this.di("Company", d.recipient_company||"—")}
      ${this.di("Phone", d.recipient_phone||"—")} ${this.di("Email", d.recipient_email||"—")}
      ${this.di("Address", [d.recipient_address_line1,d.recipient_address_line2].filter(Boolean).join(", ")||"—")}
      ${this.di("Country", d.recipient_country||"—")} ${this.di("State", d.recipient_state||"—")} ${this.di("City", d.recipient_city||"—")} ${this.di("ZIP", d.recipient_zip||"—")}
      ${this.di("Residential", d.is_residential?"Yes":"No")}
    </div>
  </div>
</div>

${commHtml}

${pkgHtml}

<div class="dk-detail-section">
  <div class="dk-form-section-title">Update Status</div>
  <div class="dk-radio-group">
    ${["Draft","Pending","Booked","In Transit","Out for Delivery","Delivered","Cancelled"].map(s=>`
    <label class="dk-radio-label${d.status===s?" dk-radio-active":""}">
      <input type="radio" name="dk-new-status" value="${s}"${d.status===s?" checked":""}>
      <span>${s}</span>
    </label>`).join("")}
  </div>
  <button class="dk-btn dk-btn-primary dk-btn-sm" id="dk-save-status" style="margin-top:10px">Update Status</button>
</div>
${d.special_instructions?`<div class="dk-detail-section"><div class="dk-form-section-title">Special Instructions</div><div class="dk-note-box">${d.special_instructions}</div></div>`:""}`;

		/* bind drawer buttons — all scoped to body */
		body.querySelectorAll('input[name="dk-new-status"]').forEach(radio => {
			radio.addEventListener("change", () => {
				body.querySelectorAll(".dk-radio-label").forEach(l => l.classList.remove("dk-radio-active"));
				radio.closest(".dk-radio-label").classList.add("dk-radio-active");
			});
		});
		body.querySelector("#dk-save-status").addEventListener("click", () => {
			const ns = (body.querySelector('input[name="dk-new-status"]:checked') || {}).value;
			frappe.call({
				method: "courier_app.api.shipment_api.update_status",
				args: { shipment_id: d.name, new_status: ns },
				callback: () => { this.toast("Status updated to " + ns, "success"); this.closeDrawer(); }
			});
		});

		/* action bar */
		const canApprove = ap !== "Approved";
		const canReject  = ap === "Pending";
		const actions = this.q("dk-drw-actions");
		actions.innerHTML = `
${canApprove ? `<button class="dk-btn dk-btn-success" id="dk-approve">✓ Approve &amp; Create SO</button>` : ""}
${canReject  ? `<button class="dk-btn dk-btn-danger"  id="dk-reject">✗ Reject</button>` : ""}
${d.docstatus < 1 ? `<button class="dk-btn dk-btn-primary" id="dk-edit-inline">Edit Shipment</button>` : ""}
<button class="dk-btn dk-btn-ghost" id="dk-print">Print Label</button>
<button class="dk-btn dk-btn-ghost" id="dk-invoice-print">
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 6V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
  Print Invoice
</button>
<button class="dk-btn dk-btn-ghost" id="dk-invoice-pdf">
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 10v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M7 2v7M4.5 6.5L7 9l2.5-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  Save PDF
</button>
${d.docstatus < 1 ? `<button class="dk-btn dk-btn-danger" id="dk-delete" style="margin-left:auto">Delete</button>` : ""}`;

		actions.querySelector("#dk-edit-inline")?.addEventListener("click", () => this.openShipmentForm(d.name));
		actions.querySelector("#dk-invoice-print").addEventListener("click", () => this._deskInvoice(d.name));
		actions.querySelector("#dk-invoice-pdf").addEventListener("click",   () => this._deskInvoice(d.name, true));

		if (canApprove) {
			actions.querySelector("#dk-approve").addEventListener("click", () => {
				frappe.confirm(
					`<b>Approve ${d.name}?</b><br>This will find/create a Customer and submit a Sales Order.`,
					() => {
						const btn = actions.querySelector("#dk-approve");
						btn.disabled = true; btn.textContent = "Processing…";
						frappe.call({
							method: "courier_app.api.approval_api.approve_shipment",
							args: { shipment_id: d.name },
							callback: r => {
								const res = r.message || {};
								frappe.msgprint({ title: "Shipment Approved", indicator: "green",
									message: `<div style="line-height:2">✓ Shipment: <b>${d.name}</b> → Booked<br>✓ Customer: <b>${res.customer||"—"}</b><br>✓ Sales Order: <b><a onclick="frappe.set_route('Form','Sales Order','${res.sales_order}')" style="cursor:pointer;color:var(--blue)">${res.sales_order||"—"}</a></b></div>` });
								this.closeDrawer();
							},
							error: err => {
								btn.disabled = false; btn.innerHTML = "✓ Approve &amp; Create SO";
								const msg = err._server_messages ? JSON.parse(err._server_messages).map(m=>JSON.parse(m).message).join("<br>") : "Approval failed";
								frappe.msgprint({ title: "Approval Failed", message: msg, indicator: "red" });
							}
						});
					}
				);
			});
		}
		if (canReject) {
			actions.querySelector("#dk-reject").addEventListener("click", () => {
				this.rejectModal([d.name], () => { this.closeDrawer(); });
			});
		}
		/* Edit Shipment opens inline form in drawer */
		actions.querySelector("#dk-print").addEventListener("click", () => frappe.set_route("print", "Courier Shipment", d.name));
		if (d.docstatus < 1) {
			actions.querySelector("#dk-delete").addEventListener("click", () => {
				frappe.confirm(`Permanently delete <b>${d.name}</b>?`, () => {
					frappe.call({
						method: "courier_app.api.shipment_api.delete_shipment",
						args: { shipment_id: d.name },
						callback: () => { this.toast(`${d.name} deleted`, "success"); this.closeDrawer(); }
					});
				});
			});
		}
	},

	di(label, val) {
		return `<div class="dk-detail-item"><div class="dk-di-label">${label}</div><div class="dk-di-val">${val||"—"}</div></div>`;
	},

	/* ── REJECT MODAL ─────────────────────────────────────────────────────── */
	rejectModal(names, onDone) {
		const bg = document.createElement("div");
		bg.className = "dk-modal-bg";
		bg.innerHTML = `<div class="dk-modal">
  <h3>Reject Shipment${names.length>1?"s":""}</h3>
  <p>Rejecting ${names.length} shipment${names.length>1?"s":""} will mark ${names.length>1?"them":"it"} as Cancelled.</p>
  <textarea id="dk-rej-reason" placeholder="Reason for rejection (optional)…"></textarea>
  <div class="dk-modal-actions">
    <button class="dk-btn dk-btn-ghost" id="dk-rej-cancel">Cancel</button>
    <button class="dk-btn dk-btn-danger" id="dk-rej-confirm">Reject</button>
  </div>
</div>`;
		this.root.appendChild(bg);
		bg.querySelector("#dk-rej-cancel").addEventListener("click", () => bg.remove());
		bg.querySelector("#dk-rej-confirm").addEventListener("click", () => {
			const reason = bg.querySelector("#dk-rej-reason").value.trim();
			bg.remove();
			let done = 0;
			names.forEach(name => frappe.call({
				method: "courier_app.api.approval_api.reject_shipment",
				args: { shipment_id: name, reason },
				callback: () => { if (++done === names.length) { this.toast(`${done} rejected`, "info"); onDone && onDone(); } }
			}));
		});
	},

	/* ── EXPORT CSV ───────────────────────────────────────────────────────── */
	/* shared field definitions for CSV / PDF pickers */
	_exportGroups() {
		return [
			{ label: "Shipment", color: "blue", fields: [
				{ k:"name",                  l:"Shipment ID",       def:true  },
				{ k:"status",                l:"Status",            def:true  },
				{ k:"approval_status",       l:"Approval Status",   def:false },
				{ k:"shipment_type",         l:"Type",              def:true  },
				{ k:"ship_date",             l:"Ship Date",         def:true  },
				{ k:"estimated_delivery",    l:"Est. Delivery",     def:false },
				{ k:"service_provider",      l:"Service Provider",  def:false },
				{ k:"services",              l:"Services",          def:true  },
				{ k:"total_weight",          l:"Total Weight (kg)", def:true  },
				{ k:"total_actual_weight",   l:"Actual Weight (kg)",def:false },
				{ k:"rate_per_kg",           l:"Rate/KG (PKR)",     def:false },
				{ k:"calculated_rate",       l:"Total Rate (PKR)",  def:true  },
				{ k:"total_commodity_amount",l:"Commodity Amount",  def:false },
			]},
			{ label: "Sender", color: "green", fields: [
				{ k:"sender_name",           l:"Sender Name",       def:false },
				{ k:"sender_company",        l:"Sender Company",    def:false },
				{ k:"sender_phone",          l:"Sender Phone",      def:false },
				{ k:"sender_email",          l:"Sender Email",      def:false },
				{ k:"sender_country",        l:"Sender Country",    def:false },
				{ k:"sender_state",          l:"Sender State",      def:false },
				{ k:"sender_city",           l:"Sender City",       def:false },
				{ k:"sender_zip",            l:"Sender ZIP",        def:false },
				{ k:"sender_address_line1",  l:"Sender Addr. 1",    def:false },
				{ k:"sender_address_line2",  l:"Sender Addr. 2",    def:false },
			]},
			{ label: "Recipient", color: "purple", fields: [
				{ k:"recipient_name",        l:"Recipient Name",    def:true  },
				{ k:"recipient_company",     l:"Recipient Company", def:false },
				{ k:"recipient_phone",       l:"Recipient Phone",   def:false },
				{ k:"recipient_email",       l:"Recipient Email",   def:false },
				{ k:"recipient_country",     l:"Recipient Country", def:true  },
				{ k:"recipient_state",       l:"Recipient State",   def:false },
				{ k:"recipient_city",        l:"Recipient City",    def:false },
				{ k:"recipient_zip",         l:"Recipient ZIP",     def:false },
				{ k:"recipient_address_line1",l:"Recipient Addr. 1",def:false },
				{ k:"recipient_address_line2",l:"Recipient Addr. 2",def:false },
				{ k:"is_residential",        l:"Residential",       def:false },
			]},
			{ label: "Billing & Options", color: "amber", fields: [
				{ k:"packaging_type",        l:"Packaging Type",    def:false },
				{ k:"bill_transportation_to",l:"Bill Transport",    def:false },
				{ k:"bill_duties_to",        l:"Bill Duties",       def:false },
				{ k:"signature_required",    l:"Signature Reqd.",   def:false },
				{ k:"hold_at_location",      l:"Hold at Location",  def:false },
			]},
			{ label: "Notes & Portal", color: "teal", fields: [
				{ k:"special_instructions",  l:"Special Instructions",def:false },
				{ k:"customer_reference",    l:"Customer Reference",  def:false },
				{ k:"submitted_by_portal",   l:"Via Portal",          def:false },
				{ k:"portal_email",          l:"Portal Email",        def:false },
			]},
			{ label: "CRM", color: "red", fields: [
				{ k:"customer",              l:"Customer",          def:false },
				{ k:"sales_order",           l:"Sales Order",       def:false },
				{ k:"approved_by",           l:"Approved By",       def:false },
				{ k:"approved_on",           l:"Approved On",       def:false },
			]},
		];
	},

	_exportPickerModal(title, chkClass, actionLabel, actionId, onExport) {
		const groups      = this._exportGroups();
		const totalFields = groups.reduce((n, g) => n + g.fields.length, 0);
		const defCount    = groups.reduce((n, g) => n + g.fields.filter(f => f.def).length, 0);
		const isCSV       = actionLabel.toLowerCase().includes("csv");

		const sectionsHtml = groups.map(g => `
<div class="dk-ep-section">
  <div class="dk-ep-sec-hd" data-c="${g.color}">${g.label}</div>
  <div class="dk-ep-grid">
    ${g.fields.map(f => `
    <label class="dk-ep-chk${f.def ? " on" : ""}">
      <input type="checkbox" class="${chkClass}" data-key="${f.k}"${f.def ? " checked" : ""}>
      <span class="dk-ep-box"></span>
      <span class="dk-ep-lbl">${f.l}${f.def ? '<span class="dk-ep-star">★</span>' : ""}</span>
    </label>`).join("")}
  </div>
</div>`).join("");

		const bg = document.createElement("div");
		bg.className = "dk-modal-bg";
		bg.innerHTML = `<div class="dk-modal dk-ep-modal">
  <div class="dk-ep-hd">
    <div class="dk-ep-hd-left">
      <div class="dk-ep-ico ${isCSV ? "dk-ep-ico-csv" : "dk-ep-ico-pdf"}">
        ${isCSV
          ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M4 6h8M4 9h8M4 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1h7l3 3v11H3V1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 1v3h3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 8h6M5 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`}
      </div>
      <div>
        <div class="dk-ep-title">${title}</div>
        <div class="dk-ep-sub">${this.rows.length} shipment${this.rows.length !== 1 ? "s" : ""} &middot; select columns</div>
      </div>
    </div>
    <div class="dk-ep-hd-right">
      <div class="dk-ep-pill"><strong id="${actionId}-cnt">${defCount}</strong>&thinsp;/&thinsp;${totalFields}</div>
      <button class="dk-ep-xbtn" id="${actionId}-x">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
  <div class="dk-ep-bar">
    <button class="dk-ep-tbtn" data-act="all">
      <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Select All
    </button>
    <span class="dk-ep-sep"></span>
    <button class="dk-ep-tbtn" data-act="none">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      Deselect All
    </button>
    <span style="flex:1"></span>
    <span class="dk-ep-leg"><span class="dk-ep-star">★</span>&nbsp;= included by default</span>
  </div>
  <div class="dk-ep-body">${sectionsHtml}</div>
  <div class="dk-ep-foot">
    <div class="dk-ep-foot-left">Columns appear left&#8594;right in the file</div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="dk-btn dk-btn-ghost" id="${actionId}-cancel">Cancel</button>
      <button class="dk-btn dk-btn-primary dk-ep-export-btn" id="${actionId}">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 10v2h10v-2M7 1v7M4 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${actionLabel}
        <span class="dk-ep-badge" id="${actionId}-badge">${defCount}</span>
      </button>
    </div>
  </div>
</div>`;
		this.root.appendChild(bg);

		const chkEls = () => bg.querySelectorAll("." + chkClass);
		const updateCount = () => {
			const n = [...chkEls()].filter(c => c.checked).length;
			bg.querySelector("#" + actionId + "-cnt").textContent   = n;
			bg.querySelector("#" + actionId + "-badge").textContent = n;
		};

		bg.addEventListener("change", e => {
			if (e.target.classList.contains(chkClass)) {
				e.target.closest(".dk-ep-chk").classList.toggle("on", e.target.checked);
				updateCount();
			}
		});

		const close = () => bg.remove();
		bg.querySelector("#" + actionId + "-x").onclick      = close;
		bg.querySelector("#" + actionId + "-cancel").onclick = close;
		bg.onclick = e => { if (e.target === bg) close(); };

		bg.querySelector('[data-act="all"]').onclick = () => {
			chkEls().forEach(c => { c.checked = true; c.closest(".dk-ep-chk").classList.add("on"); });
			updateCount();
		};
		bg.querySelector('[data-act="none"]').onclick = () => {
			chkEls().forEach(c => { c.checked = false; c.closest(".dk-ep-chk").classList.remove("on"); });
			updateCount();
		};

		bg.querySelector("#" + actionId).addEventListener("click", () => {
			const selected  = [...chkEls()].filter(c => c.checked).map(c => c.dataset.key);
			if (!selected.length) { this.toast("Please select at least one field", "error"); return; }
			const allFields = groups.flatMap(g => g.fields);
			close();
			onExport(allFields.filter(f => selected.includes(f.k)));
		});
	},

	exportCSV() {
		this._exportPickerModal("Export to CSV", "dk-csv-chk", "Download CSV", "dk-csv-do",
			fields => this._serverExport(fields, "csv"));
	},

	/* ── EXPORT PDF ────────────────────────────────────────────────────────── */
	exportPDF() {
		this._exportPickerModal("Export to PDF", "dk-pdf-chk", "Generate PDF", "dk-pdf-do",
			fields => this._serverExport(fields, "pdf"));
	},

	async _serverExport(fields, format) {
		this.toast(`Preparing ${format.toUpperCase()}…`, "info");
		try {
			const payload = new URLSearchParams({
				filters:       JSON.stringify(this.filters),
				fields:        JSON.stringify(fields.map(f => ({ k: f.k, l: f.l }))),
				sort_by:       this.sortBy   || "creation",
				sort_order:    this.sortDir  || "desc",
				export_format: format,
			});
			const resp = await fetch(
				"/api/method/courier_app.api.shipment_api.export_shipments",
				{
					method:  "POST",
					headers: {
						"Content-Type":        "application/x-www-form-urlencoded",
						"X-Frappe-CSRF-Token": frappe.csrf_token,
					},
					body: payload,
				}
			);
			if (!resp.ok) {
				const txt = await resp.text();
				throw new Error(txt.slice(0, 200));
			}
			const blob = await resp.blob();
			const url  = URL.createObjectURL(blob);
			const a    = document.createElement("a");
			a.href = url;
			a.download = `shipments_${frappe.datetime.now_date()}.${format}`;
			a.style.display = "none";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			this.toast(`Downloaded as ${format.toUpperCase()}`, "success");
		} catch (err) {
			console.error("Export error:", err);
			this.toast("Export failed: " + (err.message || "unknown error"), "error");
		}
	},

	_generatePDF() {/* replaced by _serverExport */},
	_downloadCSV()  {/* replaced by _serverExport */},


	/* ── SHIPMENT FORM (create / edit in drawer) ─────────────────────────── */
	openShipmentForm(name = null) {
		this.q("dk-drawer").classList.add("open");
		this.q("dk-bd").classList.add("open");
		const badge = this.q("dk-drw-badge");
		if (name) {
			this.q("dk-drw-title").textContent = "Edit Shipment";
			this.q("dk-drw-meta").textContent = name;
			badge.textContent = "Edit"; badge.className = "dk-drw-mode-badge edit"; badge.style.display = "";
		} else {
			this.q("dk-drw-title").textContent = "New Shipment";
			this.q("dk-drw-meta").textContent = "Fill in the details below to create a new shipment";
			badge.textContent = "New"; badge.className = "dk-drw-mode-badge create"; badge.style.display = "";
		}
		this.q("dk-drw-body").innerHTML = `<div class="dk-empty"><p>Loading…</p></div>`;
		this.q("dk-drw-actions").innerHTML = "";

		const render = doc => {
			this.renderShipmentForm(doc);
			const bar = this.q("dk-drw-actions");
			bar.innerHTML = `
<button class="dk-btn dk-btn-primary" id="dk-sf-save">${name ? "Update" : "Save"}</button>
<button class="dk-btn dk-btn-ghost"   id="dk-sf-cancel">Discard</button>
${name ? `
<button class="dk-btn dk-btn-ghost" id="dk-sf-invoice-print">
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 6V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
  Print Invoice
</button>
<button class="dk-btn dk-btn-ghost" id="dk-sf-invoice-pdf">
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 10v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M7 2v7M4.5 6.5L7 9l2.5-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  Save PDF
</button>` : ""}
<span style="margin-left:auto;font-size:11px;color:var(--dk-sub)"><span class="dk-req">*</span> required</span>`;
			bar.querySelector("#dk-sf-save").addEventListener("click", () => this._saveShipmentForm(name));
			bar.querySelector("#dk-sf-cancel").addEventListener("click", () => {
				if (name) this.openDrawer(name); else this.closeDrawer();
			});
			if (name) {
				bar.querySelector("#dk-sf-invoice-print")?.addEventListener("click", () => this._deskInvoice(name));
				bar.querySelector("#dk-sf-invoice-pdf")?.addEventListener("click",   () => this._deskInvoice(name, true));
			}
		};

		const doRender = doc => {
			/* Ensure providers are available before rendering the form */
			if (this.providers && this.providers.length) {
				render(doc);
			} else {
				frappe.call({
					method: "courier_app.api.shipment_api.get_calculator_providers",
					callback: r => {
						this.providers = r.message || [];
						render(doc);
					}
				});
			}
		};

		if (name) {
			frappe.call({
				method: "courier_app.api.approval_api.get_shipment_detail",
				args: { shipment_id: name },
				callback: r => { if (r.message) doRender(r.message); }
			});
		} else {
			doRender({});
		}
	},

	renderShipmentForm(doc) {
		const d = doc || {};
		const today = frappe.datetime.now_date();

		/* ── template helpers ── */
		const fi = (label, html, req = false, full = false) => `
<div class="dk-fi${full?" dk-fi-full":""}">
  <div class="dk-di-label">${label}${req?'<span class="dk-req"> *</span>':""}</div>
  ${html}
</div>`;
		const inp = (id, val, ph, type = "text") =>
			`<input id="${id}" type="${type}" class="dk-input" value="${(val||"").replace(/"/g,"&quot;")}" placeholder="${ph||""}">`;
		const sel = (id, val, opts) =>
			`<select id="${id}" class="dk-input dk-select">${opts.map(o =>
				typeof o === "string"
					? `<option${o===val?" selected":""}>${o}</option>`
					: `<option value="${o.v}"${o.v===val?" selected":""}>${o.l}</option>`
			).join("")}</select>`;
		/* combo: text input + hidden + dropdown panel */
		const combo = (id, val, ph) =>
			`<div class="dk-addr-combo" id="${id}-wrap">
  <input type="text" id="${id}-txt" class="dk-input" value="${(val||"").replace(/"/g,"&quot;")}" placeholder="${ph||""}" autocomplete="off">
  <input type="hidden" id="${id}" value="${(val||"").replace(/"/g,"&quot;")}">
  <div class="dk-addr-drop" id="${id}-drop"></div>
</div>`;
		/* state select: populated dynamically */
		const stsel = (id, val) =>
			`<select id="${id}" class="dk-input dk-select">
  <option value="${(val||"").replace(/"/g,"&quot;")}">${val||"— select country first —"}</option>
</select>`;
		const sec = (title, content, cols = 3) => `
<div class="dk-detail-section">
  <div class="dk-form-section-title">${title}</div>
  <div class="dk-detail-grid"${cols !== 3 ? ` style="grid-template-columns:repeat(${cols},1fr)"` : ""}>${content}</div>
</div>`;

		const provList = this.providers || [];
		const provDefault = d.service_provider || (provList.length === 1 ? provList[0].name : "");
		const provOpts = [{v:"",l:"— Select Provider —"},
			...provList.map(p=>({v:p.name,l:`${p.provider_name} (${p.provider_code})`}))];
		const pkgs   = d.packages?.length    ? d.packages    : [{}];
		const comms  = d.commodities?.length ? d.commodities : [{}];


		const body = this.q("dk-drw-body");
		body.innerHTML = `
<input type="hidden" id="sf-modified" value="${d.modified||""}">

${sec("Shipment Info",
  fi("Service Provider",sel("sf-provider",provDefault,provOpts)) +
  fi("Ship Date",inp("sf-date",d.ship_date||today,"","date"),true) +
  fi("Packaging Type",sel("sf-pkg-type",d.packaging_type||"",[{v:"",l:"— Select Type —"},"Others"])) +
  fi("Services",sel("sf-service",d.services||"",[{v:"",l:"— Select Service —"},"Via UK","Via Belfast","Via PK"])) +
  fi("Shipment Type",`<div class="dk-radio-group">${["Outbound","Inbound","Return"].map(opt=>`<label class="dk-radio-label"><input type="radio" name="sf-type" value="${opt}"${(d.shipment_type||"Outbound")===opt?" checked":""}>${opt}</label>`).join("")}</div>`,true)
, 4)}

${sec("Sender",
  fi("Full Name",inp("sf-sname",d.sender_name,"Sender's name"),true) +
  fi("Company",inp("sf-scomp",d.sender_company,"Optional")) +
  fi("Phone",inp("sf-sphone",d.sender_phone,"+92 300 0000000"),true) +
  fi("Email",inp("sf-semail",d.sender_email,"sender@example.com","email")) +
  fi("Street Address",inp("sf-saddr1",d.sender_address_line1,"House / Building, Street"),true,true) +
  fi("Address Line 2",inp("sf-saddr2",d.sender_address_line2,"Area / Floor / Suite"),false,true) +
  fi("Country",combo("sf-scountry",d.sender_country,"Search country…"),true) +
  fi("State / Province",stsel("sf-sstate",d.sender_state)) +
  fi("City",combo("sf-scity",d.sender_city,"Search city…"),true) +
  fi("ZIP / Postal",inp("sf-szip",d.sender_zip,"54000"))
)}

${sec("Recipient",
  fi("Full Name",inp("sf-rname",d.recipient_name,"Recipient's name"),true) +
  fi("Company",inp("sf-rcomp",d.recipient_company,"Optional")) +
  fi("Phone",inp("sf-rphone",d.recipient_phone,"+1 212 000 0000"),true) +
  fi("Email",inp("sf-remail",d.recipient_email,"recipient@example.com","email")) +
  fi("Street Address",inp("sf-raddr1",d.recipient_address_line1,"House / Building, Street"),true,true) +
  fi("Address Line 2",inp("sf-raddr2",d.recipient_address_line2,"Area / Floor / Suite"),false,true) +
  fi("Country",combo("sf-rcountry",d.recipient_country,"Search country…"),true) +
  fi("State / Province",stsel("sf-rstate",d.recipient_state)) +
  fi("City",combo("sf-rcity",d.recipient_city,"Search city…"),true) +
  fi("ZIP / Postal",inp("sf-rzip",d.recipient_zip,"10001")) +
  `<div class="dk-fi-check"><input type="checkbox" id="sf-residential"${d.is_residential?" checked":""}><label for="sf-residential">Residential address</label></div>`
)}

<div class="dk-detail-section">
  <div class="dk-form-section-title">Commodities</div>
  <div class="dk-sf-pkg-head dk-pkg-cols" id="sf-comms-head">
    <span>#</span><span>Units</span><span>UOM</span><span>Weight</span><span>Unit</span><span>Description</span><span>HS Code</span><span>Price</span><span></span><span>Amount (PKR)</span><span></span>
  </div>
  <div id="sf-comms">${comms.map((c,i)=>this._sfCommRow(c,i)).join("")}<div class="dk-child-add-bar"><button style="float:right" class="dk-btn dk-btn-ghost dk-btn-sm dk-btn-add-row" id="sf-add-comm" type="button"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Add Item</button></div></div>
  <div id="sf-comm-total" style="display:none" class="dk-child-total-row">
    <span class="dk-child-total-label">Total Declared Value</span>
    <span class="dk-child-total-val" id="sf-comm-total-val">—</span>
  </div>
  <div id="sf-comm-wt-total" style="display:none" class="dk-child-total-row">
    <span class="dk-child-total-label">Total Commodity Weight</span>
    <span class="dk-child-total-val" id="sf-comm-wt-total-val">—</span>
  </div>
</div>

<div class="dk-detail-section">
  <div class="dk-form-section-title">
    Packages
    <span id="sf-rate-live-badge" style="display:none;font-size:10px;font-weight:500;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:99px;padding:1px 8px;margin-left:6px;vertical-align:middle">● Live</span>
  </div>
  <div class="dk-sf-pkg-head dk-pkg-cols">
    <span>#</span><span>Weight *</span><span>Unit</span><span>L&nbsp;cm</span><span>W&nbsp;cm</span><span>H&nbsp;cm</span><span>Act. Wt</span><span>Amount (PKR)</span><span></span>
  </div>
  <div id="sf-pkgs">${pkgs.map((p,i)=>this._sfPkgRow(p,i)).join("")}<div class="dk-child-add-bar"><button style="float:right" class="dk-btn dk-btn-ghost dk-btn-sm dk-btn-add-row" id="sf-add-pkg" type="button"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Add Package</button></div></div>
  <div id="sf-pkg-total" style="display:none" class="dk-child-total-row">
    <span class="dk-child-total-label">Total</span>
    <span class="dk-child-total-val" id="sf-pkg-total-val">—</span>
  </div>
</div>

${sec("Notes &amp; Reference",
  fi("Customer / PO Reference",inp("sf-ref",d.customer_reference,"e.g. PO-2024-001")) +
  fi("Special Instructions",`<textarea id="sf-notes" class="dk-input" placeholder="Any special handling notes…">${d.special_instructions||""}</textarea>`,false,true)
)}`;

		/* ── wire up package add ── */
		const pkgCont = body.querySelector("#sf-pkgs");

		const _sfBindPkgRateRow = row => {
			row.querySelector(".sf-pkg-wt")?.addEventListener("input",  () => this._sfScheduleRateCalc(body));
			row.querySelector(".sf-pkg-unit")?.addEventListener("change", () => this._sfScheduleRateCalc(body));
			row.querySelector(".sf-pkg-l")?.addEventListener("input",  () => this._sfScheduleRateCalc(body));
			row.querySelector(".sf-pkg-w")?.addEventListener("input",  () => this._sfScheduleRateCalc(body));
			row.querySelector(".sf-pkg-h")?.addEventListener("input",  () => this._sfScheduleRateCalc(body));
		};

		body.querySelector("#sf-add-pkg").addEventListener("click", () => {
			const idx = pkgCont.querySelectorAll(".dk-sf-pkg-row").length;
			pkgCont.querySelector(".dk-child-add-bar").insertAdjacentHTML("beforebegin", this._sfPkgRow({}, idx));
			this._bindPkgRemove(pkgCont);
			const newRow = pkgCont.querySelectorAll(".dk-sf-pkg-row")[idx];
			if (newRow) _sfBindPkgRateRow(newRow);
		});
		this._bindPkgRemove(pkgCont);

		/* ── wire up rate calc triggers ── */
		pkgCont.querySelectorAll(".dk-sf-pkg-row").forEach(_sfBindPkgRateRow);
		body.querySelector("#sf-provider")?.addEventListener("change", () => this._sfScheduleRateCalc(body));

		/* ── wire up address combos + state/city dynamics ── */
		this._initAddressBlock(body, "s", d.sender_country, d.sender_state);
		this._initAddressBlock(body, "r", d.recipient_country, d.recipient_state, {
			onCountrySelect: () => this._sfScheduleRateCalc(body)
		});

		/* ── initial rate calc when editing existing record ── */
		if (d.recipient_country) {
			setTimeout(() => this._sfCalcRate(body), 200);
		}

		/* ── wire up commodities ── */
		const commCont = body.querySelector("#sf-comms");
		this._bindCommRemove(commCont);
		this._bindCommCalc(commCont);
		this._sfUpdateCommTotal(commCont, body);

		body.querySelector("#sf-add-comm").addEventListener("click", () => {
			const idx = commCont.querySelectorAll(".dk-sf-pkg-row").length;
			commCont.querySelector(".dk-child-add-bar").insertAdjacentHTML("beforebegin", this._sfCommRow({}, idx));
			const newRow = commCont.querySelectorAll(".dk-sf-pkg-row")[idx];
			this._bindCommRemove(commCont);
			this._bindCommCalc(commCont, newRow);
		});
	},

	/* ── DYNAMIC COUNTRY / STATE / CITY ─────────────────────────────────── */
	_initAddressBlock(body, prefix, initCountry, initState, opts) {
		const cTxt  = body.querySelector(`#sf-${prefix}country-txt`);
		const cHid  = body.querySelector(`#sf-${prefix}country`);
		const cDrop = body.querySelector(`#sf-${prefix}country-drop`);
		const sSel  = body.querySelector(`#sf-${prefix}state`);
		const cityTxt  = body.querySelector(`#sf-${prefix}city-txt`);
		const cityHid  = body.querySelector(`#sf-${prefix}city`);
		const cityDrop = body.querySelector(`#sf-${prefix}city-drop`);

		if (!cTxt) return;

		/* country combo search — uses Country doctype (all countries) */
		let cTimer;
		const searchCountries = q => {
			if (!q || q.length < 1) { this._closeAddrDrop(cDrop); return; }
			const all = this._allCountries || [];
			const ql  = q.toLowerCase();
			const items = all
				.filter(c => c.label.toLowerCase().startsWith(ql) ||
				             c.label.toLowerCase().includes(ql))
				.slice(0, 40);
			this._showAddrDrop(cDrop, items, val => {
				cTxt.value = val; cHid.value = val;
				this._loadStates(sSel, val, cityTxt, cityHid);
				if (opts?.onCountrySelect) opts.onCountrySelect(val);
			});
		};
		cTxt.addEventListener("input", () => {
			cHid.value = cTxt.value;
			clearTimeout(cTimer);
			cTimer = setTimeout(() => searchCountries(cTxt.value.trim()), 220);
		});
		cTxt.addEventListener("focus", () => {
			const q = cTxt.value.trim();
			if (q.length >= 1) searchCountries(q);
		});
		cTxt.addEventListener("click", () => {
			const q = cTxt.value.trim();
			if (q.length >= 1) searchCountries(q);
		});

		const _cClickOut = e => {
			if (!cTxt.closest(".dk-addr-combo")?.contains(e.target)) this._closeAddrDrop(cDrop);
		};
		document.addEventListener("click", _cClickOut);

		/* city combo search */
		let cityTimer;
		const searchCities = q => {
			const country = cHid.value || cTxt.value.trim();
			const state   = sSel?.value || "";
			if (!country) return;
			frappe.call({
				method: "courier_app.api.shipment_api.get_cities",
				args: { country, state },
				callback: r => {
					const all = r.message || [];
					const filtered = q ? all.filter(c => c.toLowerCase().startsWith(q.toLowerCase())) : all.slice(0,40);
					this._showAddrDrop(cityDrop, filtered.map(c=>({label:c,value:c})), val => {
						cityTxt.value = val; cityHid.value = val;
						const zipEl = body.querySelector(`#sf-${prefix}zip`);
						if (zipEl) {
							frappe.call({
								method: "courier_app.api.location_api.get_city_postal_code",
								args: { city_name: val, country: cHid.value || cTxt.value.trim(), state: sSel?.value || "" },
								callback: r => { if (zipEl) zipEl.value = r.message || ""; }
							});
						}
					});
				}
			});
		};
		cityTxt?.addEventListener("input", () => {
			cityHid.value = cityTxt.value;
			clearTimeout(cityTimer);
			cityTimer = setTimeout(() => searchCities(cityTxt.value.trim()), 200);
		});
		cityTxt?.addEventListener("focus", () => {
			if (cHid.value || cTxt.value.trim()) searchCities(cityTxt.value.trim());
		});
		cityTxt?.addEventListener("click", () => {
			if (cHid.value || cTxt.value.trim()) searchCities(cityTxt.value.trim());
		});

		const _cityClickOut = e => {
			if (!cityTxt?.closest(".dk-addr-combo")?.contains(e.target)) this._closeAddrDrop(cityDrop);
		};
		document.addEventListener("click", _cityClickOut);

		/* initialise states if country already has a value */
		if (initCountry) {
			this._loadStates(sSel, initCountry, cityTxt, cityHid, initState);
		}
	},

	_loadStates(sSel, country, cityTxt, cityHid, selectVal) {
		if (!sSel) return;
		frappe.call({
			method: "courier_app.api.shipment_api.get_states",
			args: { country },
			callback: r => {
				const states = r.message || [];
				if (!states.length) {
					sSel.innerHTML = '<option value="">— No states available —</option>';
					sSel.disabled = true;
				} else {
					sSel.disabled = false;
					sSel.innerHTML = '<option value="">— Select state / province —</option>' +
						states.map(s => `<option value="${s}"${s===selectVal?" selected":""}>${s}</option>`).join("");
				}
				/* when state changes, reload cities */
				sSel.onchange = () => {
					if (cityTxt) { cityTxt.value = ""; if (cityHid) cityHid.value = ""; }
				};
			}
		});
	},

	_showAddrDrop(dropEl, items, onSelect) {
		if (!dropEl) return;
		if (!items.length) { dropEl.innerHTML = '<div class="dk-addr-empty">No results</div>'; dropEl.style.display = "block"; return; }
		dropEl.innerHTML = items.slice(0, 40).map((item, i) =>
			`<div class="dk-addr-item" data-idx="${i}">
  <span>${item.label}</span>${item.sub ? `<span class="dk-addr-sub">${item.sub}</span>` : ""}
</div>`).join("");
		dropEl.querySelectorAll(".dk-addr-item").forEach((el, i) => {
			el.addEventListener("mousedown", e => { e.preventDefault(); onSelect(items[i].value); dropEl.style.display = "none"; });
		});
		dropEl.style.display = "block";
	},

	_closeAddrDrop(dropEl) {
		if (dropEl) dropEl.style.display = "none";
	},

	_sfPkgRow(p = {}, idx = 0) {
		const v = x => (x != null && x !== "") ? x : "";
		const amt = parseFloat(p.amount || 0);
		const amtTxt = amt > 0 ? "PKR " + Math.round(amt).toLocaleString() : "—";
		const wKg = (p.weight_unit === "lb") ? (parseFloat(p.weight||0) * 0.453592) : parseFloat(p.weight||0);
		const l = parseFloat(p.length||0), w = parseFloat(p.width||0), h = parseFloat(p.height||0);
		const volKg = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 5000 : 0;
		const isVol = volKg > wKg;
		const awVal = wKg > 0 ? (isVol ? volKg : wKg) : 0;
		const awTxt = awVal > 0 ? awVal.toFixed(3) : "—";
		const awStyle = isVol ? 'background:red;color:#fff' : '';
		return `
<div class="dk-sf-pkg-row">
  <div class="dk-sf-pkg-num">${idx + 1}</div>
  <input class="dk-input sf-pkg-wt"   type="number" min="0.001" step="0.001" value="${v(p.weight)}"      placeholder="0.000">
  <select class="dk-input sf-pkg-unit">
    <option${p.weight_unit!=="lb"?" selected":""}>kg</option>
    <option${p.weight_unit==="lb"?" selected":""}>lb</option>
  </select>
  <input class="dk-input sf-pkg-l"    type="number" min="0" step="0.1"    value="${v(p.length)}"      placeholder="—">
  <input class="dk-input sf-pkg-w"    type="number" min="0" step="0.1"    value="${v(p.width)}"       placeholder="—">
  <input class="dk-input sf-pkg-h"    type="number" min="0" step="0.1"    value="${v(p.height)}"      placeholder="—">
  <input type="hidden" class="sf-pkg-desc" value="${(p.description||"").replace(/"/g,"&quot;")}">
  <div class="dk-sf-pkg-aw" style="${awStyle}" data-aw="${awVal.toFixed(3)}">${awTxt}</div>
  <div class="dk-sf-pkg-amt" data-amount="${amt}">${amtTxt}</div>
  <button class="dk-sf-pkg-rm" type="button" title="Remove row">✕</button>
</div>`;
	},

	_renumberPkgRows(container) {
		container.querySelectorAll(".dk-sf-pkg-row").forEach((row, i) => {
			const num = row.querySelector(".dk-sf-pkg-num");
			if (num) num.textContent = i + 1;
		});
	},

	_bindPkgRemove(container) {
		container.querySelectorAll(".dk-sf-pkg-rm").forEach(btn => {
			btn.onclick = () => {
				if (container.querySelectorAll(".dk-sf-pkg-row").length > 1) {
					btn.closest(".dk-sf-pkg-row").remove();
					this._renumberPkgRows(container);
				} else {
					this.toast("At least one package row is required", "error");
				}
			};
		});
	},

	/* ── COMMODITY ROW ───────────────────────────────────────────────────── */
	_sfCommRow(c = {}, idx = 0) {
		const v = x => (x != null && x !== "") ? String(x).replace(/"/g, "&quot;") : "";
		const amt = parseFloat(c.amount || 0) || (parseFloat(c.units||0) * parseFloat(c.price||0));
		const amtTxt = amt > 0 ? amt.toFixed(2) : "";
		return `
<div class="dk-sf-pkg-row">
  <div class="dk-sf-pkg-num">${idx + 1}</div>
  <input class="dk-input sf-comm-units" type="number" value="${v(c.units)}" placeholder="0.000" min="0" step="0.001">
  <select class="dk-input sf-comm-uom">
    <option${(c.uom||"Kg")==="Kg"?" selected":""}>Kg</option>
    <option${c.uom==="Doz"?" selected":""}>Doz</option>
    <option${c.uom==="Pcs"?" selected":""}>Pcs</option>
  </select>
  <input class="dk-input sf-comm-weight" type="number" value="${v(c.weight)}" placeholder="0.000" min="0" step="0.001">
  <select class="dk-input sf-comm-wt-unit">
    <option${(c.wt_unit||"kgs")==="kgs"?" selected":""}>kgs</option>
    <option${c.wt_unit==="lbs"?" selected":""}>lbs</option>
  </select>
  <input class="dk-input sf-comm-desc"  type="text"   value="${v(c.description)}" placeholder="Item description…">
  <input class="dk-input sf-comm-hs" type="text" value="${v(c.hs_code)}" placeholder="HS Code" autocomplete="off" readonly style="cursor:pointer">
  <input class="dk-input sf-comm-price" type="number" value="${v(c.price)}" placeholder="0.00" min="0" step="0.01">
  <div></div>
  <div class="dk-sf-pkg-amt sf-comm-amt-display" data-amt="${amt}">${amtTxt ? "PKR " + parseFloat(amtTxt).toLocaleString() : "—"}</div>
  <button class="dk-sf-pkg-rm" type="button" title="Remove item">✕</button>
</div>`;
	},

	_bindCommRemove(container) {
		container.querySelectorAll(".dk-sf-pkg-rm").forEach(btn => {
			btn.onclick = () => {
				btn.closest(".dk-sf-pkg-row").remove();
				const body = this.q("dk-drw-body");
				this._renumberCommRows(container);
				this._sfUpdateCommTotal(container, body);
			};
		});
	},

	_renumberCommRows(container) {
		container.querySelectorAll(".dk-sf-pkg-row").forEach((row, i) => {
			const num = row.querySelector(".dk-sf-pkg-num");
			if (num) num.textContent = i + 1;
		});
	},

	_bindCommCalc(container, scopeRow) {
		const body = this.q("dk-drw-body");
		const rows = scopeRow
			? [scopeRow]
			: Array.from(container.querySelectorAll(".dk-sf-pkg-row"));

		rows.forEach(row => {
			const descEl   = row.querySelector(".sf-comm-desc");
			const unitsEl  = row.querySelector(".sf-comm-units");
			const priceEl  = row.querySelector(".sf-comm-price");
			const weightEl = row.querySelector(".sf-comm-weight");
			const wtUnitEl = row.querySelector(".sf-comm-wt-unit");
			const hsEl     = row.querySelector(".sf-comm-hs");
			if (!descEl || !unitsEl || !priceEl || !hsEl) return;

			const recalc = () => {
				const u = parseFloat(unitsEl.value) || 0;
				const p = parseFloat(priceEl.value) || 0;
				const a = u * p;
				const dispEl = row.querySelector(".sf-comm-amt-display");
				if (dispEl) { dispEl.textContent = a > 0 ? "PKR " + a.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; dispEl.dataset.amt = a > 0 ? a.toFixed(2) : "0"; }
				this._sfUpdateCommTotal(container, body);
			};
			unitsEl.addEventListener("input", recalc);
			priceEl.addEventListener("input", recalc);
			if (weightEl) weightEl.addEventListener("input", () => this._sfUpdateCommTotal(container, body));
			if (wtUnitEl) wtUnitEl.addEventListener("change", () => this._sfUpdateCommTotal(container, body));

			/* description change → clear HS and pre-fetch in background */
			let _hsItems = [];
			descEl.addEventListener("change", () => {
				const kw = descEl.value.trim();
				hsEl.value = "";
				_hsItems = [];
				if (kw.length < 2) return;
				frappe.call({
					method: "courier_app.api.shipment_api.search_hs_codes",
					args: { keyword: kw },
					callback: r => {
						_hsItems = (r.message || []).filter(it => it.htsno && it.htsno.includes("."));
					}
				});
			});

			/* HS input click → open modal */
			hsEl.addEventListener("click", () => {
				const kw = descEl.value.trim();
				if (_hsItems.length) {
					this._openHsModal(hsEl, _hsItems, kw);
					return;
				}
				if (kw.length < 2) { this._openHsModal(hsEl, [], kw); return; }
				this._openHsModal(hsEl, null, kw);
				frappe.call({
					method: "courier_app.api.shipment_api.search_hs_codes",
					args: { keyword: kw },
					callback: r => {
						_hsItems = (r.message || []).filter(it => it.htsno && it.htsno.includes("."));
						this._openHsModal(hsEl, _hsItems, kw);
					}
				});
			});
		});
	},

	_ensureHsModal() {
		let el = document.getElementById("dk-hs-modal");
		if (el) return el;
		el = document.createElement("div");
		el.id = "dk-hs-modal";
		el.className = "dk-hs-modal-overlay";
		el.innerHTML = `
<div class="dk-hs-modal-panel">
  <div class="dk-hs-modal-head">
    <div class="dk-hs-modal-head-info">
      <svg class="dk-hs-modal-head-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <div>
        <div class="dk-hs-modal-title">HTS Code Lookup</div>
        <div class="dk-hs-modal-subtitle" id="dk-hs-modal-kw"></div>
      </div>
    </div>
    <div class="dk-hs-modal-actions">
      <span class="dk-hs-modal-count">—</span>
      <button class="dk-hs-modal-close" type="button" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
  <div class="dk-hs-modal-search-wrap">
    <svg class="dk-hs-modal-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input class="dk-hs-modal-filter" type="text" placeholder="Search by code or description…" autocomplete="off">
  </div>
  <div class="dk-hs-modal-body"></div>
</div>`;
		this.root.appendChild(el);
		return el;
	},

	_openHsModal(hsEl, items, descText) {
		const overlay   = this._ensureHsModal();
		const countEl   = overlay.querySelector(".dk-hs-modal-count");
		const filterEl  = overlay.querySelector(".dk-hs-modal-filter");
		const body      = overlay.querySelector(".dk-hs-modal-body");
		const subtitleEl = overlay.querySelector("#dk-hs-modal-kw");

		if (subtitleEl) subtitleEl.textContent = descText ? `"${descText}"` : "";

		const close = () => overlay.classList.remove("open");

		const renderItems = filter => {
			const fl = (filter || "").toLowerCase();
			const filtered = fl
				? items.filter(it => it.htsno.toLowerCase().includes(fl) || it.description.toLowerCase().includes(fl))
				: items;
			countEl.textContent = filtered.length + " result" + (filtered.length === 1 ? "" : "s");
			if (!filtered.length) {
				body.innerHTML = '<div class="dk-hs-empty"><div class="dk-hs-empty-icon">🔍</div>No matching HS codes found</div>';
				return;
			}
			body.innerHTML = filtered.slice(0, 60).map(it => {
				const duty   = (it.general || "").trim();
				const isFree = duty && duty.toLowerCase() === "free";
				const dutyHtml = duty ? `<span class="dk-hs-duty${isFree ? "" : " dk-hs-duty--paid"}">${duty}</span>` : "";
				const safeCode = (it.htsno || "").replace(/"/g, "&quot;");
				return `<div class="dk-hs-opt" data-code="${safeCode}">
  <div class="dk-hs-opt-row"><span class="dk-hs-code">${it.htsno}</span>${dutyHtml}</div>
  <div class="dk-hs-desc">${it.description}</div>
</div>`;
			}).join("");
			body.querySelectorAll(".dk-hs-opt").forEach(opt => {
				opt.addEventListener("click", () => { hsEl.value = opt.dataset.code; close(); });
			});
		};

		filterEl.value = "";
		filterEl.oninput = () => items && renderItems(filterEl.value);
		overlay.querySelector(".dk-hs-modal-close").onclick = close;
		overlay.onclick = e => { if (e.target === overlay) close(); };

		if (items === null) {
			countEl.textContent = "—";
			body.innerHTML = '<div class="dk-hs-empty"><span class="dk-hs-spinner"></span>Searching…</div>';
		} else if (!items.length) {
			countEl.textContent = "0 results";
			body.innerHTML = '<div class="dk-hs-empty"><div class="dk-hs-empty-icon">📦</div>No HS codes found. Fill in the description field first.</div>';
		} else {
			renderItems("");
		}

		overlay.classList.add("open");
		setTimeout(() => filterEl.focus(), 60);
	},

	_sfUpdateCommTotal(container, body) {
		let total = 0;
		let totalWtKg = 0;
		container.querySelectorAll(".dk-sf-pkg-row").forEach(row => {
			total += parseFloat(row.querySelector(".sf-comm-amt-display")?.dataset.amt) || 0;
			const w  = parseFloat(row.querySelector(".sf-comm-weight")?.value) || 0;
			const u  = row.querySelector(".sf-comm-wt-unit")?.value || "kgs";
			const kg = u === "lbs" ? w * 0.453592 : w;
			totalWtKg += kg;
		});
		const totalEl    = body.querySelector("#sf-comm-total");
		const totalValEl = body.querySelector("#sf-comm-total-val");
		if (totalEl) totalEl.style.display = total > 0 ? "flex" : "none";
		if (totalValEl) totalValEl.textContent = total > 0 ? total.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : "—";
		const wtTotalEl    = body.querySelector("#sf-comm-wt-total");
		const wtTotalValEl = body.querySelector("#sf-comm-wt-total-val");
		if (wtTotalEl) wtTotalEl.style.display = totalWtKg > 0 ? "flex" : "none";
		if (wtTotalValEl) wtTotalValEl.textContent = totalWtKg > 0 ? totalWtKg.toFixed(3) + " kg" : "—";
	},

	/* ── DESK FORM LIVE RATE ─────────────────────────────────────────────── */
	_sfScheduleRateCalc(body) {
		clearTimeout(this._sfRateDebounce);
		this._sfRateDebounce = setTimeout(() => this._sfCalcRate(body), 500);
	},

	_sfCalcRate(body) {
		const country   = body.querySelector("#sf-rcountry")?.value?.trim() || "";
		const provider  = body.querySelector("#sf-provider")?.value?.trim() || "";
		const liveBadge = body.querySelector("#sf-rate-live-badge");
		const rows      = Array.from(body.querySelector("#sf-pkgs")?.querySelectorAll(".dk-sf-pkg-row") || []);

		const pkgData = rows.map(row => {
			const wRaw     = parseFloat(row.querySelector(".sf-pkg-wt")?.value) || 0;
			const unit     = row.querySelector(".sf-pkg-unit")?.value || "kg";
			const weightKg = unit === "lb" ? wRaw * 0.453592 : wRaw;
			const l = parseFloat(row.querySelector(".sf-pkg-l")?.value) || 0;
			const w = parseFloat(row.querySelector(".sf-pkg-w")?.value) || 0;
			const h = parseFloat(row.querySelector(".sf-pkg-h")?.value) || 0;
			const volKg = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 5000 : 0;
			const isVol = volKg > weightKg;
			const effectiveKg = isVol ? volKg : weightKg;
			const awEl = row.querySelector(".dk-sf-pkg-aw");
			if (awEl) {
				if (weightKg <= 0) {
					awEl.textContent = "—";
					awEl.style.backgroundColor = "";
					awEl.style.color = "";
					awEl.dataset.aw = "0";
				} else {
					awEl.textContent = effectiveKg.toFixed(3);
					awEl.dataset.aw = effectiveKg.toFixed(3);
					awEl.style.backgroundColor = isVol ? "red" : "";
					awEl.style.color = isVol ? "#fff" : "";
				}
			}
			return { row, weightKg: effectiveKg };
		});
		const validPkgs = pkgData.filter(p => p.weightKg > 0);

		const totalEl    = body.querySelector("#sf-pkg-total");
		const totalValEl = body.querySelector("#sf-pkg-total-val");

		if (!country || !validPkgs.length) {
			if (liveBadge) liveBadge.style.display = "none";
			if (totalEl) totalEl.style.display = "none";
			pkgData.forEach(({ row }) => {
				const a = row.querySelector(".dk-sf-pkg-amt");
				if (a) a.textContent = "—";
			});
			return;
		}

		/* loading indicator */
		validPkgs.forEach(({ row }) => {
			const a = row.querySelector(".dk-sf-pkg-amt");
			if (a) a.textContent = "…";
		});

		const calls = validPkgs.map(({ weightKg }) =>
			fetch("/api/method/courier_app.api.shipment_api.get_rates_all_providers", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"X-Frappe-CSRF-Token": frappe.csrf_token || "fetch",
				},
				body: new URLSearchParams({ country, weight: weightKg.toFixed(3) }).toString()
			}).then(r => r.json()).then(d => ({ weightKg, rates: (d.message || {}).rates || [] }))
		);

		Promise.all(calls).then(results => {
			let idx = 0, grandTotal = 0;
			pkgData.forEach(({ row, weightKg }) => {
				const a = row.querySelector(".dk-sf-pkg-amt");
				if (!a) return;
				if (weightKg <= 0) { a.textContent = "—"; return; }
				const { rates } = results[idx++];
				if (!rates.length) { a.textContent = "—"; return; }
				const sorted = [...rates].sort((a, b) => (a.rate || 0) - (b.rate || 0));
				const match  = provider
					? (rates.find(r => r.provider_id === provider) || sorted[0])
					: sorted[0];
				const pkgRate = match?.rate > 0 ? match.rate : 0;
				grandTotal += pkgRate;
				a.textContent = pkgRate > 0 ? `PKR ${Math.round(pkgRate).toLocaleString()}` : "—";
				a.dataset.amount = pkgRate > 0 ? pkgRate : 0;
			});
			if (totalEl) {
				totalEl.style.display = grandTotal > 0 ? "block" : "none";
				if (totalValEl) totalValEl.textContent = `PKR ${Math.round(grandTotal).toLocaleString()}`;
			}
			if (liveBadge) liveBadge.style.display = "inline";
		}).catch(() => {
			pkgData.forEach(({ row }) => {
				const a = row.querySelector(".dk-sf-pkg-amt");
				if (a) a.textContent = "—";
			});
			if (totalEl) totalEl.style.display = "none";
			if (liveBadge) liveBadge.style.display = "none";
		});
	},

	_collectFormData() {
		const body = this.q("dk-drw-body");
		const v   = id => body.querySelector("#"+id)?.value?.trim()||"";
		const chk = id => body.querySelector("#"+id)?.checked||false;

		const packages = [];
		body.querySelector("#sf-pkgs")?.querySelectorAll(".dk-sf-pkg-row").forEach((row, i) => {
			const wt = parseFloat(row.querySelector(".sf-pkg-wt")?.value)||0;
			if (wt > 0) packages.push({
				doctype:      "Shipment Package",
				package_no:   i + 1,
				weight:       wt,
				weight_unit:  row.querySelector(".sf-pkg-unit")?.value||"kg",
				length:       parseFloat(row.querySelector(".sf-pkg-l")?.value)||0,
				width:        parseFloat(row.querySelector(".sf-pkg-w")?.value)||0,
				height:       parseFloat(row.querySelector(".sf-pkg-h")?.value)||0,
				description:  row.querySelector(".sf-pkg-desc")?.value?.trim()||"",
				actual_weight: parseFloat(row.querySelector(".dk-sf-pkg-aw")?.dataset.aw)||0,
				amount:       parseFloat(row.querySelector(".dk-sf-pkg-amt")?.dataset.amount)||0,
			});
		});

		const commodities = [];
		body.querySelector("#sf-comms")?.querySelectorAll(".dk-sf-pkg-row").forEach(row => {
			const desc  = row.querySelector(".sf-comm-desc")?.value?.trim() || "";
			const units = parseFloat(row.querySelector(".sf-comm-units")?.value) || 0;
			const price = parseFloat(row.querySelector(".sf-comm-price")?.value) || 0;
			if (!desc && !units && !price) return;
			commodities.push({
				doctype:     "Shipment Commodity",
				description: desc,
				units:       units,
				uom:         row.querySelector(".sf-comm-uom")?.value || "Kg",
				weight:      parseFloat(row.querySelector(".sf-comm-weight")?.value) || 0,
				wt_unit:     row.querySelector(".sf-comm-wt-unit")?.value || "kgs",
				price:       price,
				hs_code:     row.querySelector(".sf-comm-hs")?.value?.trim() || "",
				amount:      parseFloat(row.querySelector(".sf-comm-amt-display")?.dataset.amt) || 0,
			});
		});

		const modified = v("sf-modified") || null;
		return {
			doctype:                 "Courier Shipment",
			...(modified ? { modified } : {}),
			shipment_type:           body.querySelector('input[name="sf-type"]:checked')?.value||"Outbound",
			ship_date:               v("sf-date"),
			packaging_type:          v("sf-pkg-type")||null,
			services:                v("sf-service")||null,
			service_provider:        v("sf-provider")||null,
			sender_name:             v("sf-sname"),
			sender_company:          v("sf-scomp"),
			sender_phone:            v("sf-sphone"),
			sender_email:            v("sf-semail"),
			sender_address_line1:    v("sf-saddr1"),
			sender_address_line2:    v("sf-saddr2"),
			sender_country:          v("sf-scountry"),
			sender_state:            v("sf-sstate"),
			sender_city:             v("sf-scity"),
			sender_zip:              v("sf-szip"),
			recipient_name:          v("sf-rname"),
			recipient_company:       v("sf-rcomp"),
			recipient_phone:         v("sf-rphone"),
			recipient_email:         v("sf-remail"),
			recipient_address_line1: v("sf-raddr1"),
			recipient_address_line2: v("sf-raddr2"),
			recipient_country:       v("sf-rcountry"),
			recipient_state:         v("sf-rstate"),
			recipient_city:          v("sf-rcity"),
			recipient_zip:           v("sf-rzip"),
			is_residential:          chk("sf-residential") ? 1 : 0,
			special_instructions:    v("sf-notes"),
			customer_reference:      v("sf-ref"),
			packages,
			commodities,
		};
	},

	_saveShipmentForm(existingName) {
		const data = this._collectFormData();
		const errs = [];
		if (!data.ship_date)               errs.push("Ship Date");
		if (!data.sender_name)             errs.push("Sender Name");
		if (!data.sender_phone)            errs.push("Sender Phone");
		if (!data.sender_address_line1)    errs.push("Sender Address");
		if (!data.sender_city)             errs.push("Sender City");
		if (!data.sender_country)          errs.push("Sender Country");
		if (!data.recipient_name)          errs.push("Recipient Name");
		if (!data.recipient_phone)         errs.push("Recipient Phone");
		if (!data.recipient_address_line1) errs.push("Recipient Address");
		if (!data.recipient_city)          errs.push("Recipient City");
		if (!data.recipient_country)       errs.push("Recipient Country");
		if (errs.length) { this.toast("Required: " + errs.join(", "), "error"); return; }

		const btn = this.q("dk-drw-actions")?.querySelector("#dk-sf-save");
		const btnLabel = existingName ? "Update" : "Save";
		if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

		const _onErr = () => { if (btn) { btn.disabled = false; btn.textContent = btnLabel; } };

		if (existingName) {
			frappe.call({
				method: "courier_app.api.shipment_api.update_shipment",
				args: { name: existingName, data: JSON.stringify(data) },
				callback: r => {
					if (r.message?.status === "ok") {
						this.toast(`Saved ${existingName}`, "success");
						this.closeDrawer();
					} else _onErr();
				},
				error: _onErr
			});
		} else {
			frappe.call({
				method: "frappe.client.insert",
				args: { doc: { ...data, doctype: "Courier Shipment" } },
				callback: r => {
					if (r.message) {
						this.toast(`Created ${r.message.name}`, "success");
						this.closeDrawer();
					} else _onErr();
				},
				error: _onErr
			});
		}
	},

	/* ── PROVIDERS (cached for form + rate calc) ─────────────────────────── */
	_loadProviders() {
		frappe.call({
			method: "courier_app.api.shipment_api.get_calculator_providers",
			callback: r => { this.providers = r.message || []; }
		});
	},

	_loadAllCountries() {
		/* Fetch all countries from the Country doctype once; used by address combos. */
		frappe.call({
			method: "courier_app.api.shipment_api.get_countries",
			callback: r => {
				this._allCountries = (r.message || []).map(c => ({
					label: c.country_name,
					value: c.name,
				}));
			}
		});
	},

	/* ── RATE CALCULATOR MODAL ───────────────────────────────────────────── */
	openRateCalc() {
		/* Remove any existing instance */
		const existing = document.getElementById("dk-rcm");
		if (existing) existing.remove();

		const overlay = document.createElement("div");
		overlay.id = "dk-rcm";
		overlay.className = "dk-rcm-overlay";
		overlay.innerHTML = `
<div class="dk-rcm-box">
  <div class="dk-rcm-head">
    <div class="dk-rcm-head-icon">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1.5" y="1.5" width="15" height="15" rx="3.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M5 5.5h3M5 8.5h8M5 11.5h8M10.5 5.5h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="dk-rcm-head-text">
      <div class="dk-rcm-title">Rate Calculator</div>
      <div class="dk-rcm-subtitle">Calculate shipping rates for any destination</div>
    </div>
    <button class="dk-rcm-close" id="rcm-close" title="Close">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
  </div>
  <div class="dk-rcm-body">
    <div class="dk-rcm-fields">
      <div class="dk-rcm-field full">
        <div class="dk-rcm-label">Destination Country</div>
        <div class="dk-rcm-combo-wrap" id="rcm-combo-wrap">
          <input class="dk-rcm-input" id="rcm-country-txt" type="text"
            placeholder="Search destination…" autocomplete="off">
          <input type="hidden" id="rcm-country-val">
          <div class="dk-rcm-combo-drop" id="rcm-combo-drop"></div>
        </div>
      </div>
      <div class="dk-rcm-field">
        <div class="dk-rcm-label">Service Provider</div>
        <select class="dk-rcm-input" id="rcm-provider">
          <option value="">— Select Provider —</option>
        </select>
      </div>
      <div class="dk-rcm-field">
        <div class="dk-rcm-label">Parcel Weight</div>
        <div class="dk-rcm-weight-row">
          <input class="dk-rcm-input" id="rcm-weight" type="number"
            min="0.001" step="0.001" placeholder="0.000">
          <select class="dk-rcm-input" id="rcm-unit">
            <option value="kg">kg</option>
            <option value="lbs">lbs</option>
          </select>
        </div>
      </div>
    </div>
    <div class="dk-rcm-error" id="rcm-error"></div>
    <button class="dk-rcm-calc-btn" id="rcm-calc">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1.5" y="1.5" width="12" height="12" rx="3" stroke="currentColor" stroke-width="1.5"/>
        <path d="M5 7.5h5M8.5 5.5l2 2-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Calculate Rate
    </button>
    <div class="dk-rcm-results" id="rcm-results"></div>
  </div>
</div>`;

		this.root.appendChild(overlay);
		this._rcmInit(overlay);
	},

	_rcmInit(overlay) {
		/* Populate providers */
		const provSel = overlay.querySelector("#rcm-provider");
		const fillProviders = (list) => {
			list.forEach(p => {
				const opt = document.createElement("option");
				opt.value = p.name;
				opt.textContent = `${p.provider_name} (${p.provider_code})`;
				provSel.appendChild(opt);
			});
			/* Auto-select first provider */
			if (list.length === 1) provSel.value = list[0].name;
		};
		if (this.providers && this.providers.length) {
			fillProviders(this.providers);
		} else {
			frappe.call({
				method: "courier_app.api.shipment_api.get_calculator_providers",
				callback: r => {
					this.providers = r.message || [];
					fillProviders(this.providers);
				}
			});
		}

		/* Close handlers */
		const close = () => overlay.remove();
		overlay.querySelector("#rcm-close").addEventListener("click", close);
		overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
		document.addEventListener("keydown", function onEsc(e) {
			if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
		});

		/* Unit toggle */
		overlay.querySelector("#rcm-unit").addEventListener("change", e => {
			const wEl = overlay.querySelector("#rcm-weight");
			const val = parseFloat(wEl.value);
			if (!val) return;
			wEl.value = e.target.value === "lbs"
				? (val * 2.20462).toFixed(3)
				: (val / 2.20462).toFixed(3);
		});

		/* Provider change → reset country */
		provSel.addEventListener("change", () => {
			overlay.querySelector("#rcm-country-txt").value = "";
			overlay.querySelector("#rcm-country-val").value = "";
			overlay.querySelector("#rcm-combo-drop").style.display = "none";
		});

		/* Country combo */
		this._rcmBindCombo(overlay);

		/* Calculate */
		overlay.querySelector("#rcm-calc").addEventListener("click", () => this._rcmCalculate(overlay));
		overlay.querySelector("#rcm-weight").addEventListener("keydown", e => {
			if (e.key === "Enter") this._rcmCalculate(overlay);
		});
	},

	_rcmBindCombo(overlay) {
		const txt  = overlay.querySelector("#rcm-country-txt");
		const drop = overlay.querySelector("#rcm-combo-drop");
		let timer, items = [], idx = -1;

		const close = () => { drop.style.display = "none"; idx = -1; };
		const move  = dir => {
			const els = drop.querySelectorAll(".dk-rcm-combo-item");
			if (!els.length) return;
			idx = Math.max(-1, Math.min(els.length - 1, idx + dir));
			els.forEach((el, i) => el.classList.toggle("hovered", i === idx));
			if (idx >= 0) els[idx].scrollIntoView({ block: "nearest" });
		};
		const pick = i => {
			if (i < 0 || i >= items.length) return;
			txt.value = items[i].country_name;
			overlay.querySelector("#rcm-country-val").value = items[i].country_name;
			close();
		};

		txt.addEventListener("input", () => {
			clearTimeout(timer);
			const q = txt.value.trim();
			if (!q) { close(); return; }
			/* Clear hidden value when user types */
			overlay.querySelector("#rcm-country-val").value = "";
			timer = setTimeout(() => {
				const sp = overlay.querySelector("#rcm-provider").value;
				const method = sp
					? "courier_app.api.shipment_api.get_countries_for_provider"
					: "courier_app.api.shipment_api.get_countries_for_calc";
				const args = sp
					? { query: q, service_provider: sp }
					: { query: q };
				frappe.call({
					method, args,
					callback: r => {
						items = r.message || [];
						if (!items.length) {
							drop.innerHTML = '<div class="dk-rcm-combo-empty">No matching countries</div>';
							drop.style.display = "block";
							return;
						}
						idx = -1;
						drop.innerHTML = items.map((c, i) => `
<div class="dk-rcm-combo-item" data-idx="${i}">
  <span class="dk-rcm-combo-name">${c.country_name}</span>
  <span class="dk-rcm-combo-code">${c.country_code || ""}${c.zone_code ? " · Z" + c.zone_code : ""}</span>
</div>`).join("");
						drop.querySelectorAll(".dk-rcm-combo-item").forEach(el => {
							el.addEventListener("mousedown", e => {
								e.preventDefault();
								pick(+el.dataset.idx);
							});
						});
						drop.style.display = "block";
					}
				});
			}, 220);
		});

		txt.addEventListener("keydown", e => {
			if (drop.style.display === "none") return;
			if (e.key === "ArrowDown")  { e.preventDefault(); move(1); }
			if (e.key === "ArrowUp")    { e.preventDefault(); move(-1); }
			if (e.key === "Enter")      { e.preventDefault(); pick(idx); }
			if (e.key === "Escape")     { close(); }
		});
		txt.addEventListener("blur", () => setTimeout(close, 180));
		document.addEventListener("click", e => {
			if (!overlay.querySelector("#rcm-combo-wrap").contains(e.target)) close();
		}, { passive: true });
	},

	_rcmShowError(overlay, msg) {
		const el = overlay.querySelector("#rcm-error");
		el.textContent = msg; el.classList.add("visible");
	},
	_rcmClearError(overlay) {
		const el = overlay.querySelector("#rcm-error");
		el.textContent = ""; el.classList.remove("visible");
	},

	_rcmCalculate(overlay) {
		this._rcmClearError(overlay);
		const country = overlay.querySelector("#rcm-country-val").value ||
		                overlay.querySelector("#rcm-country-txt").value.trim();
		const sp      = overlay.querySelector("#rcm-provider").value;
		const wRaw    = parseFloat(overlay.querySelector("#rcm-weight").value);
		const unit    = overlay.querySelector("#rcm-unit").value;

		if (!country) { this._rcmShowError(overlay, "Please select a destination country"); return; }
		if (!sp)      { this._rcmShowError(overlay, "Please select a service provider"); return; }
		if (!wRaw || wRaw <= 0) { this._rcmShowError(overlay, "Please enter a valid parcel weight"); return; }

		const weightKg = unit === "lbs" ? wRaw / 2.20462 : wRaw;

		const btn = overlay.querySelector("#rcm-calc");
		btn.disabled = true;
		btn.innerHTML = '<span class="dk-rcm-spinner"></span> Calculating…';

		const done = () => {
			btn.disabled = false;
			btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1.5" y="1.5" width="12" height="12" rx="3" stroke="currentColor" stroke-width="1.5"/>
        <path d="M5 7.5h5M8.5 5.5l2 2-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Calculate Rate`;
		};

		/* ── Rate + slab table ── */
		let rateRes = null, tableRes = null, count = 0;
		const finish = () => {
			count++;
			if (count < 2) return;
			done();
			if (rateRes?.error)  { this._rcmShowError(overlay, rateRes.error);  return; }
			if (tableRes?.error) { this._rcmShowError(overlay, tableRes.error); return; }
			this._rcmRenderSingle(overlay, rateRes, tableRes, weightKg, unit, wRaw);
		};
		frappe.call({
			method: "courier_app.api.shipment_api.get_live_rate",
			args: { country, weight: weightKg.toFixed(4), service_provider: sp },
			callback: r => { rateRes = r.message || {}; finish(); },
			error:    () => { rateRes = { error: "Rate lookup failed" }; finish(); }
		});
		frappe.call({
			method: "courier_app.api.shipment_api.get_zone_rate_table",
			args: { country, service_provider: sp },
			callback: r => { tableRes = r.message || {}; finish(); },
			error:    () => { tableRes = { error: "Table lookup failed" }; finish(); }
		});
	},

	_rcmRenderAll(overlay, res, weightKg, unit, wRaw) {
		const rates   = res.rates || [];
		const bestId  = res.best_provider_id;
		const wDisp   = unit === "lbs"
			? `${wRaw.toFixed(3)} lbs (${weightKg.toFixed(3)} kg)`
			: `${weightKg.toFixed(3)} kg`;
		const countryDisplay = rates.length ? rates[0].country_name || res.country : res.country;

		let html = `
<div class="dk-rcm-results-header">Results</div>
<div class="dk-rcm-compare-info">
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 6.5h11M6.5 1c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5M6.5 1c1.5 2 2 3.5 2 5.5S8 10 6.5 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
  <span><strong>${countryDisplay}</strong> &nbsp;·&nbsp; <strong>${wDisp}</strong></span>
</div>
<div class="dk-rcm-provider-cards">`;

		if (!rates.length) {
			html += `<div class="dk-rcm-no-rates">No rates available for this country with any active provider.</div>`;
		} else {
			rates.forEach(r => {
				const isBest = r.provider_id === bestId;
				html += `
<div class="dk-rcm-pcard${isBest ? " best" : ""}">
  <div class="dk-rcm-pcard-left">
    <div class="dk-rcm-pcard-name">${r.provider_name}<span style="font-size:11px;font-weight:400;color:var(--dk-sub);margin-left:6px">${r.provider_code}</span></div>
    <div class="dk-rcm-pcard-zone">Zone ${r.zone_code}${r.zone_label ? " · " + r.zone_label : ""}</div>
  </div>
  <div class="dk-rcm-pcard-rate">PKR ${Math.round(r.rate).toLocaleString()}</div>
  ${isBest ? '<div class="dk-rcm-best-badge">Best</div>' : ""}
</div>`;
			});
		}
		html += `</div>`;

		const sec = overlay.querySelector("#rcm-results");
		sec.innerHTML = html;
		sec.classList.add("visible");
		sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
	},

	_rcmRenderSingle(overlay, rate, table, weightKg, unit, wRaw) {
		const wDisp   = unit === "lbs"
			? `${wRaw.toFixed(3)} lbs (${weightKg.toFixed(3)} kg)`
			: `${weightKg.toFixed(3)} kg`;
		const spName  = overlay.querySelector("#rcm-provider").selectedOptions[0]?.text || "";
		const country = table.country_name || rate.country || "";
		const zoneCode  = table.zone_code  || rate.zone_code  || "—";
		const zoneLabel = table.zone_label || rate.zone_label || "";

		let slabRows = "";
		if (table.slabs && table.slabs.length) {
			table.slabs.forEach((s, i) => {
				const isPkg = s.is_per_kg_above_max;
				const label = isPkg
					? `Above ${table.slabs[i-1]?.max_weight_kg || "—"} kg`
					: `Up to ${s.max_weight_kg} kg`;
				const rateCell = isPkg
					? `PKR ${s.rate.toLocaleString(undefined,{minimumFractionDigits:2})} / kg extra`
					: `PKR ${Math.round(s.rate).toLocaleString()}`;

				let isActive = false;
				if (!isPkg) {
					const prevMax = table.slabs.slice(0,i).filter(x=>!x.is_per_kg_above_max).reduce((m,x)=>Math.max(m,x.max_weight_kg||0),0);
					isActive = weightKg > prevMax && weightKg <= s.max_weight_kg;
				} else {
					const lastNorm = table.slabs.filter(x=>!x.is_per_kg_above_max).slice(-1)[0];
					isActive = lastNorm ? weightKg > lastNorm.max_weight_kg : false;
				}
				slabRows += `<tr class="${isActive?"active":""}">
  <td>${label}</td>
  <td class="dk-rcm-tbl-rate">${rateCell}</td>
  <td class="dk-rcm-tbl-note">${isActive ? "← your weight" : ""}</td>
</tr>`;
			});
		}

		const sec = overlay.querySelector("#rcm-results");
		sec.innerHTML = `
<div class="dk-rcm-results-header">Results</div>
<div class="dk-rcm-rate-card">
  <div class="dk-rcm-rate-label">Estimated Shipping Rate</div>
  <div class="dk-rcm-rate-value"><span>PKR</span>${Math.round(rate.rate || 0).toLocaleString()}</div>
  <div class="dk-rcm-meta-grid">
    <div class="dk-rcm-meta-item">
      <div class="dk-rcm-meta-key">Destination</div>
      <div class="dk-rcm-meta-val">${country}</div>
    </div>
    <div class="dk-rcm-meta-item">
      <div class="dk-rcm-meta-key">Provider</div>
      <div class="dk-rcm-meta-val">${spName}</div>
    </div>
    <div class="dk-rcm-meta-item">
      <div class="dk-rcm-meta-key">Weight</div>
      <div class="dk-rcm-meta-val">${wDisp}</div>
    </div>
    <div class="dk-rcm-meta-item">
      <div class="dk-rcm-meta-key">Zone</div>
      <div class="dk-rcm-meta-val">
        <span class="dk-rcm-zone-badge">Zone ${zoneCode}</span>${zoneLabel ? " · " + zoneLabel : ""}
      </div>
    </div>
  </div>
  ${rate.note ? `<div class="dk-rcm-rate-note">${rate.note}</div>` : ""}
</div>
${slabRows ? `
<div class="dk-rcm-table-header">
  Rate Table — Zone ${zoneCode}${zoneLabel?" ("+zoneLabel+")":""}
  <span class="dk-rcm-table-country">${country}</span>
</div>
<table class="dk-rcm-slab-table">
  <thead><tr><th>Weight</th><th>Rate (PKR)</th><th></th></tr></thead>
  <tbody>${slabRows}</tbody>
</table>` : ""}`;

		sec.classList.add("visible");
		sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
	},

	/* ── TRACK MODAL ─────────────────────────────────────────────────────── */
	openTrackModal(trackingId) {
		const bg = document.createElement("div");
		bg.className = "dk-trkm-bg";
		const prefill = trackingId ? this._escH(String(trackingId)) : "";

		bg.innerHTML = `
<div class="dk-trkm" id="dk-trkm-box">

  <!-- Header -->
  <div class="dk-trkm-head">
    <div class="dk-trkm-head-left">
      <div class="dk-trkm-head-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <div class="dk-trkm-head-text">
        <h3>Track Shipment</h3>
        <p>Live status · checkpoints · delivery updates</p>
      </div>
    </div>
    <button class="dk-btn dk-btn-ghost dk-btn-icon dk-btn-sm" id="dk-trkm-close">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
  </div>

  <!-- Always-visible search bar -->
  <div class="dk-trkm-search">
    <input class="dk-trkm-search-input" id="dk-trkm-input" type="text"
      value="${prefill}" placeholder="Enter tracking number or Shipment ID…"
      autocomplete="off" spellcheck="false">
    <button class="dk-trkm-search-btn" id="dk-trkm-go">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      Track
    </button>
  </div>

  <!-- Scrollable body: idle / loading / result / error -->
  <div class="dk-trkm-body" id="dk-trkm-body">
    <div class="dk-trkm-welcome">
      <div class="dk-trkm-welcome-icon">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <h3>Real-time Tracking</h3>
      <p>Enter a tracking number or Shipment ID above to get live status, checkpoints, and delivery updates.</p>
    </div>
  </div>

</div>`;

		this.root.appendChild(bg);

		const box   = bg.querySelector("#dk-trkm-box");
		const input = bg.querySelector("#dk-trkm-input");
		const body  = bg.querySelector("#dk-trkm-body");

		/* close helpers */
		const close = () => {
			bg.style.animation = "dk-trkm-bg-in 0.14s ease reverse";
			setTimeout(() => bg.remove(), 130);
		};
		bg.querySelector("#dk-trkm-close").addEventListener("click", close);
		bg.addEventListener("click", e => { if (e.target === bg) close(); });
		const _esc = e => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", _esc); } };
		document.addEventListener("keydown", _esc);

		/* track logic */
		const doTrack = id => {
			if (!id) { input.focus(); return; }

			/* loading state */
			box.classList.remove("dk-trkm-wide");
			body.innerHTML = `
<div class="dk-trkm-loading">
  <div class="dk-trkm-spinner"></div>
  <p>Fetching tracking data for<br><strong style="color:var(--dk-text);font-family:var(--dk-mono)">${this._escH(id)}</strong></p>
</div>`;

			frappe.call({
				method: "courier_app.api.shipment_api.track_aftership",
				args: { tracking_id: id },
				callback: r => {
					const d = r.message;

					/* ── Not found ── */
					if (!d || !d.found) {
						box.classList.remove("dk-trkm-wide");
						const msg = (d?.error && !d.error.toLowerCase().includes("api key"))
							? this._escH(d.error)
							: "No tracking information found for this ID. Please verify the number and try again.";
						body.innerHTML = `
<div class="dk-trkm-feedback">
  <div class="dk-trkm-fb-icon not-found">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      <path d="M8 11h6" stroke-width="2.2"/>
    </svg>
  </div>
  <h4>Shipment Not Found</h4>
  <p>${msg}</p>
  <div class="dk-trkm-fb-id">${this._escH(id)}</div>
</div>`;
						return;
					}

					/* ── Success: expand to wide and render card ── */
					box.classList.add("dk-trkm-wide");
					body.innerHTML = this._buildTrackCard(d.tracking);
					body.scrollTop = 0;
					window._deskPrintTracking = () => this._openTrackPrintWindow(d.tracking, "print");
					window._deskDownloadPDF   = () => this._openTrackPrintWindow(d.tracking, "pdf");
				},
				error: () => {
					/* ── Connection / server error ── */
					box.classList.remove("dk-trkm-wide");
					body.innerHTML = `
<div class="dk-trkm-feedback">
  <div class="dk-trkm-fb-icon conn-err">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8v4"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>
    </svg>
  </div>
  <h4>Connection Error</h4>
  <p>Could not reach the tracking service. Check your internet connection and try again.</p>
</div>`;
				}
			});
		};

		bg.querySelector("#dk-trkm-go").addEventListener("click", () => doTrack(input.value.trim()));
		input.addEventListener("keydown", e => { if (e.key === "Enter") doTrack(input.value.trim()); });

		if (prefill) {
			setTimeout(() => doTrack(String(trackingId).trim()), 80);
		} else {
			setTimeout(() => input.focus(), 120);
		}
	},

	_buildTrackCard(t) {
		const _e  = s => this._escH(String(s ?? ""));
		const _j  = a => a.filter(Boolean).join(", ");
		const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "";

		const tag        = t.tag || "Pending";
		const tagCls     = this._tagCls(tag);
		const statusTxt  = _e(t.subtag_message || t.tag || "Unknown");

		const origin = _j([t.origin_city, t.origin_state, t.origin_country_region]);
		const dest   = _j([t.destination_city, t.destination_state, t.destination_country_region]);

		const pickupDt   = t.shipment_pickup_date   ? this._fmtDate(t.shipment_pickup_date)   : "—";
		const deliveryDt = t.shipment_delivery_date  ? this._fmtDate(t.shipment_delivery_date)  : "—";
		const estDt      = t.courier_estimated_delivery_date?.estimated_delivery_date
		                   ? this._fmtDate(t.courier_estimated_delivery_date.estimated_delivery_date) : "—";
		const updatedDt  = t.updated_at ? this._fmtDate(t.updated_at) : "—";

		const checkpoints  = [...(t.checkpoints || [])].reverse();
		const onTimeStatus = t.on_time_status ? cap(t.on_time_status) : "—";
		const onTimeCls    = { early: "as-ontime-early", on_time: "as-ontime-ontime", late: "as-ontime-late" }[t.on_time_status] || "";

		const companyName = frappe.boot?.company_name || frappe.sys_defaults?.company || "";
		const companyLogo = frappe.boot?.company_logo || "";

		const cpHtml = checkpoints.length
			? checkpoints.map((cp, i) => this._buildCp(cp, i === 0)).join("")
			: `<p class="as-empty">No checkpoints available yet.</p>`;

		function detRow(label, value) {
			if (value === null || value === undefined || value === "" || value === "—") return "";
			const val = typeof value === "string" && value.startsWith("<") ? value : _e(String(value));
			return `<div class="as-det-row"><dt>${_e(label)}</dt><dd>${val}</dd></div>`;
		}

		return `
<div class="as-card">

  ${(companyName || companyLogo) ? `
  <div class="as-company-bar">
    ${companyLogo ? `<img src="${_e(companyLogo)}" alt="${_e(companyName)}" class="as-company-logo">` : ""}
    ${companyName ? `<span class="as-company-name">${_e(companyName)}</span>` : ""}
  </div>` : ""}

  <div class="as-header">
    <div class="as-header-left">
      <div class="as-tracking-eyebrow">Tracking Number</div>
      <div class="as-tracking-num">${_e(t.tracking_number || t.title || "—")}</div>
      ${t.slug ? `<div class="as-carrier-pill">${_e(t.slug)}</div>` : ""}
    </div>
    <div class="as-header-right">
      <span class="as-status-badge ${tagCls}">${statusTxt}</span>
      <div class="as-action-row">
        <button class="as-action-btn" onclick="window._deskPrintTracking()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print
        </button>
        <button class="as-action-btn as-action-pdf" onclick="window._deskDownloadPDF()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Save PDF
        </button>
      </div>
    </div>
  </div>

  <div class="as-route">
    <div class="as-route-point">
      <div class="as-route-icon as-route-icon-origin">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="as-route-city">${_e(origin || "Origin")}</div>
      <div class="as-route-sublabel">Picked up ${pickupDt !== "—" ? pickupDt : ""}</div>
    </div>
    <div class="as-route-track">
      <div class="as-route-line-wrap">
        <div class="as-route-line-fill ${tag === "Delivered" ? "as-route-line-done" : "as-route-line-active"}"></div>
      </div>
      <div class="as-route-mid-badge ${tagCls}">${statusTxt}</div>
    </div>
    <div class="as-route-point as-route-point-right">
      <div class="as-route-icon ${tag === "Delivered" ? "as-route-icon-delivered" : "as-route-icon-dest"}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="as-route-city">${_e(dest || "Destination")}</div>
      <div class="as-route-sublabel">${deliveryDt !== "—" ? "Delivered " + deliveryDt : estDt !== "—" ? "Est. " + estDt : ""}</div>
    </div>
  </div>

  <div class="as-stats-row">
    <div class="as-stat-box"><div class="as-stat-icon">📦</div><div class="as-stat-label">Picked Up</div><div class="as-stat-value">${pickupDt}</div></div>
    <div class="as-stat-box"><div class="as-stat-icon">✅</div><div class="as-stat-label">Delivered</div><div class="as-stat-value">${deliveryDt}</div></div>
    <div class="as-stat-box"><div class="as-stat-icon">📅</div><div class="as-stat-label">Est. Delivery</div><div class="as-stat-value">${estDt}</div></div>
    <div class="as-stat-box"><div class="as-stat-icon">⏱</div><div class="as-stat-label">On-Time Status</div><div class="as-stat-value"><span class="${onTimeCls}">${onTimeStatus}</span></div></div>
    <div class="as-stat-box"><div class="as-stat-icon">🔄</div><div class="as-stat-label">Last Updated</div><div class="as-stat-value">${updatedDt}</div></div>
  </div>

  <div class="as-body">
    <div class="as-section as-timeline-section">
      <h4 class="as-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Tracking History
      </h4>
      <div class="as-timeline">${cpHtml}</div>
    </div>
    <div class="as-section as-details-section">
      <h4 class="as-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
        Shipment Details
      </h4>
      <dl class="as-details-list">
        ${detRow("Tracking Number",  t.tracking_number)}
        ${detRow("Status",           t.subtag_message || t.tag)}
        ${detRow("Carrier / Slug",   t.slug)}
        ${detRow("Source",           cap(t.source || ""))}
        ${detRow("Pickup Date",      pickupDt !== "—" ? pickupDt : null)}
        ${detRow("Delivery Date",    deliveryDt !== "—" ? deliveryDt : null)}
        ${detRow("Est. Delivery",    estDt !== "—" ? estDt : null)}
        ${detRow("On-Time Status",   `<span class="${onTimeCls}">${onTimeStatus}</span>`)}
        ${t.transit_time         ? detRow("Transit Days",    t.transit_time)                    : ""}
        ${t.signed_by            ? detRow("Signed By",       t.signed_by)                       : ""}
        ${t.failed_delivery_attempts ? detRow("Failed Attempts", t.failed_delivery_attempts)    : ""}
        ${t.tracked_count        ? detRow("Times Tracked",   t.tracked_count)                   : ""}
      </dl>
    </div>
  </div>

  <div class="as-address-row">
    <div class="as-address-box">
      <div class="as-address-label">Origin Address</div>
      <div class="as-address-value">${_e(t.origin_raw_location || origin || "—")}</div>
    </div>
    <div class="as-address-arrow">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </div>
    <div class="as-address-box">
      <div class="as-address-label">Destination Address</div>
      <div class="as-address-value">${_e(t.destination_raw_location || dest || "—")}</div>
    </div>
  </div>

</div>`;
	},

	_openTrackPrintWindow(t, mode) {
		const _e  = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
		const join = a => a.filter(Boolean).join(", ");
		const fmtD = iso => { try { return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); } catch { return iso; } };
		const fmtDT = iso => { try { return new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true}); } catch { return iso; } };

		const checkpoints = [...(t.checkpoints || [])].reverse();
		const origin   = join([t.origin_city, t.origin_state]);
		const dest     = join([t.destination_city, t.destination_state]);
		const pickup   = t.shipment_pickup_date   ? fmtD(t.shipment_pickup_date)   : "—";
		const delivery = t.shipment_delivery_date  ? fmtD(t.shipment_delivery_date)  : "—";
		const estDel   = t.courier_estimated_delivery_date?.estimated_delivery_date
		                 ? fmtD(t.courier_estimated_delivery_date.estimated_delivery_date) : "—";

		const companyName = frappe.boot?.company_name || frappe.sys_defaults?.company || "";
		const companyLogo = frappe.boot?.company_logo || "";

		const tagColorMap = {
			Delivered:"#15803d", InTransit:"#7c3aed", InfoReceived:"#1d4ed8",
			OutForDelivery:"#b45309", Exception:"#b91c1c", Failed:"#b91c1c",
			AttemptFail:"#c2410c", Pending:"#6b7280",
		};
		const tagBgMap = {
			Delivered:"#dcfce7", InTransit:"#ede9fe", InfoReceived:"#dbeafe",
			OutForDelivery:"#fef3c7", Exception:"#fee2e2", Failed:"#fee2e2",
			AttemptFail:"#ffedd5", Pending:"#f3f4f6",
		};
		const tagColor = tagColorMap[t.tag] || "#6b7280";
		const tagBg    = tagBgMap[t.tag]    || "#f3f4f6";

		const cpRows = checkpoints.map(cp => `
<tr>
  <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-size:11px;color:#4b5563">${cp.checkpoint_time ? fmtDT(cp.checkpoint_time) : "—"}</td>
  <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb">
    <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600;background:${tagBgMap[cp.tag]||"#f3f4f6"};color:${tagColorMap[cp.tag]||"#6b7280"}">${_e(cp.subtag_message||cp.tag||"")}</span>
  </td>
  <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:12px">${_e(cp.message||"")}</td>
  <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#4b5563">${_e(join([cp.city,cp.state,cp.country_region_name]))}</td>
</tr>`).join("");

		const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tracking Report — ${_e(t.tracking_number || t.title || "Shipment")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#111827;background:#fff;padding:28px}
  h1{font-size:18px;font-weight:700;color:#05174A;margin-bottom:3px}
  .subtitle{font-size:11px;color:#6b7280;margin-bottom:20px}
  .company-bar{display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #05174A}
  .company-bar img{height:36px;width:36px;object-fit:contain;border-radius:6px}
  .company-bar span{font-size:18px;font-weight:700;color:#05174A}
  .header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;border-bottom:1px solid #e5e7eb;padding-bottom:14px}
  .badge{display:inline-block;padding:4px 12px;border-radius:99px;font-size:11px;font-weight:700;background:${tagBg};color:${tagColor}}
  .route-box{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:14px}
  .route-city{font-size:13px;font-weight:600;color:#1e293b}
  .route-sub{font-size:10px;color:#6b7280;margin-top:2px}
  .route-arrow{flex:1;text-align:center;font-size:16px;color:#94a3b8}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .stat{background:#f8fafc;border:1px solid #e5e7eb;border-radius:7px;padding:10px;text-align:center}
  .stat-label{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
  .stat-val{font-size:12px;font-weight:600;color:#1e293b}
  .section-title{font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;border-left:3px solid #05174A;padding-left:8px}
  table{width:100%;border-collapse:collapse;margin-bottom:18px}
  th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#374151;border-bottom:2px solid #e5e7eb}
  .details-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:18px}
  .det-row{display:flex;gap:6px;font-size:11px;padding:5px 0;border-bottom:1px solid #f1f5f9}
  .det-label{color:#6b7280;min-width:120px;flex-shrink:0}
  .det-val{color:#1e293b;font-weight:500}
  .footer{border-top:1px solid #e5e7eb;padding-top:10px;margin-top:6px;display:flex;justify-content:space-between;font-size:9px;color:#9ca3af}
  @media print{body{padding:0} @page{margin:8mm}}
</style>
</head>
<body>
${(companyName || companyLogo) ? `
<div class="company-bar">
  ${companyLogo ? `<img src="${_e(companyLogo)}" alt="${_e(companyName)}">` : ""}
  ${companyName ? `<span>${_e(companyName)}</span>` : ""}
</div>` : ""}
<div class="header-row">
  <div>
    <h1>${_e(t.tracking_number || t.title || "Tracking Report")}</h1>
    <div class="subtitle">Carrier: ${_e(t.slug||"—")} &nbsp;·&nbsp; Source: ${_e(t.source||"—")}</div>
  </div>
  <span class="badge">${_e(t.subtag_message||t.tag||"Unknown")}</span>
</div>
<div class="route-box">
  <div>
    <div class="route-city">📍 ${_e(origin||"Origin")}</div>
    <div class="route-sub">Picked up: ${pickup}</div>
  </div>
  <div class="route-arrow">──────────────►</div>
  <div style="text-align:right">
    <div class="route-city">📍 ${_e(dest||"Destination")}</div>
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
    ${[["Tracking Number",t.tracking_number],["Status",t.subtag_message||t.tag],["Carrier",t.slug],["Source",t.source]].map(([l,v])=>v?`<div class="det-row"><span class="det-label">${l}</span><span class="det-val">${_e(v)}</span></div>`:"").join("")}
  </div>
  <div>
    ${[["Pickup Date",pickup],["Delivery Date",delivery],["On-Time",t.on_time_status],["Transit Days",t.transit_time?t.transit_time+"d":null]].map(([l,v])=>v&&v!=="—"?`<div class="det-row"><span class="det-label">${l}</span><span class="det-val">${_e(String(v))}</span></div>`:"").join("")}
  </div>
</div>
<div class="section-title">Tracking History</div>
<table>
  <thead><tr>
    <th>Date &amp; Time</th><th>Status</th><th>Details</th><th>Location</th>
  </tr></thead>
  <tbody>${cpRows}</tbody>
</table>
${(t.origin_raw_location || t.destination_raw_location) ? `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
  <div><div class="section-title" style="margin-bottom:5px">Origin</div><div style="font-size:11px;color:#374151">${_e(t.origin_raw_location||origin||"—")}</div></div>
  <div><div class="section-title" style="margin-bottom:5px">Destination</div><div style="font-size:11px;color:#374151">${_e(t.destination_raw_location||dest||"—")}</div></div>
</div>` : ""}
<div class="footer">
  <span>Tracking ID: ${_e(t.id||t.tracking_number||"")}</span>
  <span>Generated ${new Date().toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"})}</span>
</div>
</body>
</html>`;

		if (mode === "pdf") {
			const filename = `tracking-${t.tracking_number || t.id || "report"}.pdf`;
			const opts = {
				margin: 10,
				filename: filename,
				image: { type: "jpeg", quality: 0.98 },
				html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false },
				jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
			};
			const doSave = () => window.html2pdf().set(opts).from(html, "string").save();
			if (window.html2pdf) {
				doSave();
			} else {
				const script = document.createElement("script");
				script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
				script.onload = doSave;
				document.head.appendChild(script);
			}
		} else {
			const win = window.open("about:blank", "_blank");
			if (!win) { frappe.msgprint("Please allow popups for this site to use Print."); return; }
			win.document.write(html);
			win.document.close();
			setTimeout(() => { win.focus(); win.print(); }, 600);
		}
	},

	_buildCp(cp, isLatest) {
		const _e  = s => this._escH(String(s ?? ""));
		const cls = this._tagCls(cp.tag || "Pending");
		const txt = _e(cp.subtag_message || cp.tag || "Update");
		const tim = cp.checkpoint_time ? this._fmtDateTime(cp.checkpoint_time) : "";
		const loc = cp.location || [cp.city, cp.state, cp.country_region_name].filter(Boolean).join(", ");
		return `
<div class="as-cp ${isLatest ? "as-cp-latest" : ""}">
  <div class="as-cp-spine">
    <div class="as-cp-dot ${cls}-dot${isLatest ? " as-cp-dot-pulse" : ""}"></div>
    <div class="as-cp-connector"></div>
  </div>
  <div class="as-cp-body">
    <div class="as-cp-top">
      <span class="as-cp-badge ${cls}">${txt}</span>
      ${tim ? `<span class="as-cp-time">${tim}</span>` : ""}
    </div>
    ${cp.message ? `<div class="as-cp-msg">${_e(cp.message)}</div>` : ""}
    ${loc ? `<div class="as-cp-loc">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1C4.34 1 3 2.34 3 4c0 2.44 3 7 3 7s3-4.56 3-7c0-1.66-1.34-3-3-3z" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="4" r="1.2" stroke="currentColor" stroke-width="1.2"/></svg>
      ${_e(loc)}
    </div>` : ""}
  </div>
</div>`;
	},

	_tagCls(tag) {
		return ({
			InfoReceived:   "as-tag-info",
			InTransit:      "as-tag-transit",
			OutForDelivery: "as-tag-out",
			Delivered:      "as-tag-delivered",
			Exception:      "as-tag-exception",
			Failed:         "as-tag-exception",
			AttemptFail:    "as-tag-attempt",
			Pending:        "as-tag-pending",
		}[tag] || "as-tag-pending");
	},

	_fmtDate(iso) {
		try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; }
	},

	_fmtDateTime(iso) {
		try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }); } catch { return iso; }
	},

	_escH(s) {
		return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	},

	/* ── TOAST ────────────────────────────────────────────────────────────── */
	toast(msg, type = "info") {
		document.querySelectorAll(".dk-toast").forEach(e => e.remove());
		const el = document.createElement("div");
		el.className = `dk-toast ${type}`;
		el.textContent = msg;
		this.root.appendChild(el);
		setTimeout(() => { el.style.cssText += "opacity:0;transition:opacity .3s"; setTimeout(()=>el.remove(), 350); }, 3000);
	},
};
