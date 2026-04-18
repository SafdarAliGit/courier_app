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
			{ k:"service",          l:"Service",      s:false },
			{ k:"total_weight",     l:"Wt (kg)",      s:true  },
			{ k:"calculated_rate",  l:"Rate (PKR)",   s:true  },
			{ k:"tracking_number",  l:"Tracking #",   s:false },
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
  <td class="dk-td-muted" style="font-size:12px">${r.service||"—"}</td>
  <td class="dk-td-right dk-td-mono">${r.total_weight?(+r.total_weight).toFixed(2):"—"}</td>
  <td class="dk-td-right dk-td-mono" style="font-weight:600">${r.calculated_rate?Math.round(r.calculated_rate).toLocaleString():"—"}</td>
  <td class="dk-td-mono" style="font-size:11px;color:var(--dk-sub)">${r.tracking_number||"—"}</td>
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

	renderDrawer(d) {
		const ap  = d.approval_status || "Pending";
		const apBannerCls = {Approved:"dk-appr-approved",Rejected:"dk-appr-rejected",Pending:"dk-appr-waiting"}[ap];
		const apIcon = {Approved:"✓",Rejected:"✗",Pending:"⏳"}[ap];
		const apMsg  = ap==="Approved"
			? `Approved by ${d.approved_by||"admin"}${d.approved_on?" · "+new Date(d.approved_on).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}`
			: ap==="Rejected" ? `Rejected by ${d.approved_by||"admin"}` : "Awaiting approval";

		const custHtml = d.customer ? `
<div class="dk-detail-section">
  <div class="dk-detail-section-title">Customer</div>
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
  <div class="dk-detail-section-title">Sales Order</div>
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
				return `<tr>
					<td>${i+1}</td>
					<td style="font-family:var(--dk-mono)">${p.weight} ${p.weight_unit}</td>
					<td style="font-family:var(--dk-mono)">${p.length||"—"} × ${p.width||"—"} × ${p.height||"—"}</td>
					<td style="font-family:var(--dk-mono);font-weight:500">${amt > 0 ? "PKR " + Math.round(amt).toLocaleString() : "—"}</td>
				</tr>`;
			}).join("");
			const tfoot = total > 0 ? `<tfoot><tr>
				<td colspan="3" style="text-align:right;font-weight:600;padding-right:8px">Total</td>
				<td style="font-family:var(--dk-mono);font-weight:700">PKR ${Math.round(total).toLocaleString()}</td>
			</tr></tfoot>` : "";
			return `
<div class="dk-detail-section">
  <div class="dk-detail-section-title">Packages &amp; Rate Breakdown (${pkgs.length})</div>
  <table class="dk-pkg-table">
    <thead><tr><th>#</th><th>Weight</th><th>Dimensions (cm)</th><th>Amount (PKR)</th></tr></thead>
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

<div class="dk-detail-section">
  <div class="dk-detail-section-title">Tracking Number</div>
  <div class="dk-trk-row">
    <input class="dk-input dk-trk-input" id="dk-trk" type="text" value="${d.tracking_number||""}" placeholder="Enter tracking number">
    <button class="dk-btn dk-btn-primary dk-btn-sm" id="dk-trk-save">Save</button>
  </div>
</div>

${custHtml}${soHtml}

<div class="dk-detail-section">
  <div class="dk-detail-section-title">Shipment Info</div>
  <div class="dk-detail-grid">
    ${this.di("ID", d.name)} ${this.di("Status", d.status)} ${this.di("Type", d.shipment_type)}
    ${this.di("Provider", d.service_provider||"—")} ${this.di("Ship Date", d.ship_date)} ${this.di("Service", d.service)}
    ${this.di("Weight", d.total_weight ? d.total_weight + " kg" : "—")}
    ${this.di("Rate", d.calculated_rate ? "PKR " + Math.round(d.calculated_rate).toLocaleString() : "—")}
    ${this.di("Ref", d.customer_reference||"—")}
  </div>
</div>
  
<div class="dk-detail-section">
  <div class="dk-detail-section-title">Sender</div>
  <div class="dk-detail-grid">
    ${this.di("Name", d.sender_name||"—")} ${this.di("Company", d.sender_company||"—")}
    ${this.di("Phone", d.sender_phone||"—")} ${this.di("Email", d.sender_email||"—")}
    ${this.di("Address", [d.sender_address_line1,d.sender_address_line2].filter(Boolean).join(", ")||"—")}
    ${this.di("Country", d.sender_country||"—")} ${this.di("State", d.sender_state||"—")} ${this.di("City", d.sender_city||"—")} ${this.di("ZIP", d.sender_zip||"—")}
  </div>
</div>

<div class="dk-detail-section">
  <div class="dk-detail-section-title">Recipient</div>
  <div class="dk-detail-grid">
    ${this.di("Name", d.recipient_name||"—")} ${this.di("Company", d.recipient_company||"—")}
    ${this.di("Phone", d.recipient_phone||"—")} ${this.di("Email", d.recipient_email||"—")}
    ${this.di("Address", [d.recipient_address_line1,d.recipient_address_line2].filter(Boolean).join(", ")||"—")}
    ${this.di("Country", d.recipient_country||"—")} ${this.di("State", d.recipient_state||"—")} ${this.di("City", d.recipient_city||"—")} ${this.di("ZIP", d.recipient_zip||"—")}
    ${this.di("Residential", d.is_residential?"Yes":"No")}
  </div>
</div>

${pkgHtml}

<div class="dk-detail-section">
  <div class="dk-detail-section-title">Update Status</div>
  <div class="dk-radio-group">
    ${["Draft","Pending","Booked","In Transit","Out for Delivery","Delivered","Cancelled"].map(s=>`
    <label class="dk-radio-label${d.status===s?" dk-radio-active":""}">
      <input type="radio" name="dk-new-status" value="${s}"${d.status===s?" checked":""}>
      <span>${s}</span>
    </label>`).join("")}
  </div>
  <button class="dk-btn dk-btn-primary dk-btn-sm" id="dk-save-status" style="margin-top:10px">Update Status</button>
</div>
${d.special_instructions?`<div class="dk-detail-section"><div class="dk-detail-section-title">Special Instructions</div><div class="dk-note-box">${d.special_instructions}</div></div>`:""}`;

		/* bind drawer buttons — all scoped to body */
		body.querySelector("#dk-trk-save").addEventListener("click", () => {
			const val = body.querySelector("#dk-trk").value.trim();
			frappe.db.set_value("Courier Shipment", d.name, "tracking_number", val).then(() => {
				this.toast("Tracking number saved", "success"); this.load();
			});
		});
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
${d.docstatus < 1 ? `<button class="dk-btn dk-btn-danger" id="dk-delete" style="margin-left:auto">Delete</button>` : ""}`;

		actions.querySelector("#dk-edit-inline")?.addEventListener("click", () => this.openShipmentForm(d.name));


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
		document.body.appendChild(bg);
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
	exportCSV() {
		const h = ["ID","Status","Approval","Type","Recipient","Country","Ship Date","Service","Weight","Rate (PKR)","Tracking #","Customer","Sales Order"];
		const rows = this.rows.map(r => [
			r.name, r.status, r.approval_status||"Pending", r.shipment_type,
			r.recipient_name, r.recipient_country, r.ship_date, r.service,
			r.total_weight, r.calculated_rate, r.tracking_number||"", r.customer||"", r.sales_order||""
		].map(v=>`"${(v||"").toString().replace(/"/g,'""')}"`).join(","));
		const csv = [h.join(","), ...rows].join("\n");
		const blob = new Blob([csv], {type:"text/csv"});
		const url  = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `shipments_${frappe.datetime.now_date()}.csv`;
		a.style.display = "none";
		document.body.appendChild(a); // Firefox requires the element to be in DOM
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		this.toast(`Exported ${this.rows.length} rows`, "success");
	},

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
<button class="dk-btn dk-btn-primary" id="dk-sf-save">Save Draft</button>
<button class="dk-btn dk-btn-ghost"   id="dk-sf-cancel">Discard</button>
<span style="margin-left:auto;font-size:11px;color:var(--dk-sub)"><span class="dk-req">*</span> required</span>`;
			bar.querySelector("#dk-sf-save").addEventListener("click", () => this._saveShipmentForm(name));
			bar.querySelector("#dk-sf-cancel").addEventListener("click", () => {
				if (name) this.openDrawer(name); else this.closeDrawer();
			});
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
		const sec = (title, content) => `
<div class="dk-detail-section">
  <div class="dk-form-section-title">${title}</div>
  <div class="dk-detail-grid">${content}</div>
</div>`;

		const provList = this.providers || [];
		const provDefault = d.service_provider || (provList.length === 1 ? provList[0].name : "");
		const provOpts = [{v:"",l:"— Select Provider —"},
			...provList.map(p=>({v:p.name,l:`${p.provider_name} (${p.provider_code})`}))];
		const pkgs = d.packages?.length ? d.packages : [{}];


		const body = this.q("dk-drw-body");
		body.innerHTML = `
<input type="hidden" id="sf-modified" value="${d.modified||""}">

<div class="dk-sf-layout">
  <!-- LEFT: Info + Sender + Recipient -->
  <div class="dk-sf-left">

    ${sec("Shipment Info",
      fi("Service Provider",sel("sf-provider",provDefault,provOpts)) +
      fi("Ship Date",inp("sf-date",d.ship_date||today,"","date"),true) +
      fi("Service",sel("sf-service",d.service||"",[{v:"",l:"— Select Service —"},"Express Plus","Express","Express Saver","Ground","Ground Economy"])) +
      fi("Shipment Type",sel("sf-type",d.shipment_type||"Outbound",["Outbound","Inbound","Return"]),true)
    )}

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

  </div><!-- /left -->

  <!-- RIGHT: Packages + Notes -->
  <div class="dk-sf-right">

    <div class="dk-detail-section">
      <div class="dk-form-section-title">
        Packages
        <span id="sf-rate-live-badge" style="display:none;font-size:10px;font-weight:500;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:99px;padding:1px 8px;margin-left:6px;vertical-align:middle">● Live</span>
        <button class="dk-btn dk-btn-ghost dk-btn-sm" id="sf-add-pkg" type="button">+ Add Package</button>
      </div>
      <div class="dk-sf-pkg-head dk-pkg-cols">
        <span>#</span><span>Weight *</span><span>Unit</span><span>L&nbsp;cm</span><span>W&nbsp;cm</span><span>H&nbsp;cm</span><span>Amount</span><span></span>
      </div>
      <div id="sf-pkgs">${pkgs.map((p,i)=>this._sfPkgRow(p,i)).join("")}</div>
      <div id="sf-pkg-total" style="display:none;text-align:right;padding:6px 8px 2px;border-top:1px solid var(--dk-border,#e5e7eb);margin-top:4px;font-size:12px;color:var(--dk-sub)">
        Total: <strong id="sf-pkg-total-val" style="font-family:var(--dk-mono,monospace);font-size:13px;color:var(--dk-text)">—</strong>
      </div>
    </div>

    ${sec("Notes &amp; Reference",
      fi("Customer / PO Reference",inp("sf-ref",d.customer_reference,"e.g. PO-2024-001")) +
      fi("Special Instructions",`<textarea id="sf-notes" class="dk-input" placeholder="Any special handling notes…">${d.special_instructions||""}</textarea>`,false,true)
    )}

  </div><!-- /right -->
</div><!-- /layout -->`;

		/* ── wire up package add ── */
		const pkgCont = body.querySelector("#sf-pkgs");

		const _sfBindPkgRateRow = row => {
			row.querySelector(".sf-pkg-wt")?.addEventListener("input",  () => this._sfScheduleRateCalc(body));
			row.querySelector(".sf-pkg-unit")?.addEventListener("change", () => this._sfScheduleRateCalc(body));
		};

		body.querySelector("#sf-add-pkg").addEventListener("click", () => {
			const idx = pkgCont.querySelectorAll(".dk-sf-pkg-row").length;
			pkgCont.insertAdjacentHTML("beforeend", this._sfPkgRow({}, idx));
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
  <div class="dk-sf-pkg-amt">${amtTxt}</div>
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

	/* ── DESK FORM LIVE RATE ─────────────────────────────────────────────── */
	_sfScheduleRateCalc(body) {
		clearTimeout(this._sfRateDebounce);
		this._sfRateDebounce = setTimeout(() => this._sfCalcRate(body), 500);
	},

	_sfCalcRate(body) {
		const country   = body.querySelector("#sf-rcountry")?.value?.trim() || "";
		const provider  = body.querySelector("#sf-provider")?.value?.trim() || "";
		const liveBadge = body.querySelector("#sf-rate-live-badge");
		const rows      = Array.from(body.querySelectorAll(".dk-sf-pkg-row"));

		const pkgData = rows.map(row => {
			const wRaw     = parseFloat(row.querySelector(".sf-pkg-wt")?.value) || 0;
			const unit     = row.querySelector(".sf-pkg-unit")?.value || "kg";
			const weightKg = unit === "lb" ? wRaw * 0.453592 : wRaw;
			return { row, weightKg };
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
		body.querySelectorAll(".dk-sf-pkg-row").forEach((row, i) => {
			const wt = parseFloat(row.querySelector(".sf-pkg-wt")?.value)||0;
			if (wt > 0) packages.push({
				doctype:     "Shipment Package",
				package_no:  i + 1,
				weight:      wt,
				weight_unit: row.querySelector(".sf-pkg-unit")?.value||"kg",
				length:      parseFloat(row.querySelector(".sf-pkg-l")?.value)||0,
				width:       parseFloat(row.querySelector(".sf-pkg-w")?.value)||0,
				height:      parseFloat(row.querySelector(".sf-pkg-h")?.value)||0,
				description: row.querySelector(".sf-pkg-desc")?.value?.trim()||"",
			});
		});

		const modified = v("sf-modified") || null;
		return {
			doctype:                 "Courier Shipment",
			...(modified ? { modified } : {}),
			shipment_type:           v("sf-type"),
			ship_date:               v("sf-date"),
			service:                 v("sf-service")||null,
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
		if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

		const _onErr = () => { if (btn) { btn.disabled = false; btn.textContent = "Save Draft"; } };

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

		document.body.appendChild(overlay);
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

	/* ── TOAST ────────────────────────────────────────────────────────────── */
	toast(msg, type = "info") {
		document.querySelectorAll(".dk-toast").forEach(e => e.remove());
		const el = document.createElement("div");
		el.className = `dk-toast ${type}`;
		el.textContent = msg;
		document.body.appendChild(el);
		setTimeout(() => { el.style.cssText += "opacity:0;transition:opacity .3s"; setTimeout(()=>el.remove(), 350); }, 3000);
	},
};
