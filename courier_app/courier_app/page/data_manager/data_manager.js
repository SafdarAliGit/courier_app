/* ── CourierApp Data Manager — Desk Page ──────────────────────────────────── */

frappe.pages["data-manager"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Data Manager",
		single_column: true,
	});

	/* inject CSS */
	if (!document.getElementById("rm-css")) {
		const lnk = document.createElement("link");
		lnk.id = "rm-css";
		lnk.rel = "stylesheet";
		lnk.href = "/assets/courier_app/css/data_manager.css";
		document.head.appendChild(lnk);
	}
	if (!document.getElementById("ca-desk-font")) {
		const lnk = document.createElement("link");
		lnk.id = "ca-desk-font";
		lnk.rel = "stylesheet";
		lnk.href = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap";
		document.head.appendChild(lnk);
	}

	/* Hide Frappe's sticky page-head (we use our own toolbar) — also
	   prevents the sticky z-index from blocking clicks on our content */
	const pageHead = wrapper.querySelector(".page-head");
	if (pageHead) pageHead.style.display = "none";

	/* Strip Bootstrap container / grid gutters for full-width layout */
	const pbody = wrapper.querySelector(".page-body");
	if (pbody) { pbody.style.maxWidth = "none"; pbody.style.padding = "0 8px"; }
	const lm = wrapper.querySelector(".layout-main");
	if (lm) { lm.style.marginLeft = "0"; lm.style.marginRight = "0"; }
	const lmw = wrapper.querySelector(".layout-main-section-wrapper");
	if (lmw) { lmw.style.paddingLeft = "0"; lmw.style.paddingRight = "0"; }

	$(page.main).html('<div id="rm-root"></div>');
	RateManager.init(page.main[0].querySelector("#rm-root"), page);
};

/* ═══════════════════════════════════════════════════════════════════════════ */
window.RateManager = {

	/* ── STATE ──────────────────────────────────────────────────────────── */
	activeTab: "upload",
	providers: [],
	zones: [],
	uploadFileUrl: null,
	previewData: null,
	adjPreviewData: null,

	/* ── INIT ───────────────────────────────────────────────────────────── */
	init(root, page) {
		this.root = root;
		this.page = page;
		this.renderShell();
		this.loadProviders();
	},

	/* ── SHELL ──────────────────────────────────────────────────────────── */
	renderShell() {
		this.root.innerHTML = `
<div class="rm-wrap">

<!-- TOOLBAR -->
<div class="rm-toolbar">
  <span class="rm-toolbar-title">Data Manager</span>
  <div class="rm-toolbar-actions">
    <div class="rm-dropdown">
      <button class="rm-btn rm-btn-ghost" id="rm-btn-tpl">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10v2h10v-2M7 1v7M4 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Download Templates
      </button>
      <div class="rm-dropdown-menu" id="rm-tpl-menu">
        <a class="rm-dropdown-item" href="/assets/courier_app/rate_templates/rate_zones_template.xlsx" download>
          Rate Zones Template
        </a>
        <a class="rm-dropdown-item" href="/assets/courier_app/rate_templates/country_zones_template.xlsx" download>
          Country Zones Template
        </a>
        <hr class="rm-dropdown-divider">
        <a class="rm-dropdown-item" href="/assets/courier_app/rate_templates/AAA_Logistics_rate_zones.xlsx" download>
          AAA Logistics — Rate Zones Data
        </a>
        <a class="rm-dropdown-item" href="/assets/courier_app/rate_templates/AAA_Logistics_country_zones.xlsx" download>
          AAA Logistics — Country Zones Data
        </a>
        <hr class="rm-dropdown-divider">
        <a class="rm-dropdown-item" id="rm-tpl-states" href="#">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:-1px;margin-right:4px"><circle cx="6" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 10c0-2.2 2.24-4 5-4s5 1.8 5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          States / Provinces Template
        </a>
        <a class="rm-dropdown-item" id="rm-tpl-cities" href="#">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:-1px;margin-right:4px"><rect x="1" y="5" width="4" height="6" stroke="currentColor" stroke-width="1.1"/><rect x="7" y="3" width="4" height="8" stroke="currentColor" stroke-width="1.1"/><path d="M1 5l4-3 2 1.5L11 1v2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Cities Template
        </a>
      </div>
    </div>
  </div>
</div>

<!-- TABS -->
<div class="rm-tabs">
  <button class="rm-tab active" data-tab="upload">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 9V2M4 5l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 10v2h10v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Upload Rates
  </button>
  <button class="rm-tab" data-tab="adjust">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M5 3l-4 4 4 4M9 3l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Adjust Rates
  </button>
 
  <button class="rm-tab" data-tab="location">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="5" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M2 12c0-2.2 1.79-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    Location Data
  </button>

   <button class="rm-tab" data-tab="history">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M4 5h6M4 7h4M4 9h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    Import History
  </button>
</div>

<!-- TAB PANELS -->
<div class="rm-panel" id="rm-panel-upload">
  ${this.renderUploadPanel()}
</div>

<div class="rm-panel rm-panel-hidden" id="rm-panel-adjust">
  ${this.renderAdjustPanel()}
</div>

<div class="rm-panel rm-panel-hidden" id="rm-panel-history">
  ${this.renderHistoryPanel()}
</div>

<div class="rm-panel rm-panel-hidden" id="rm-panel-location">
  ${this.renderLocationPanel()}
</div>

</div><!-- /.rm-wrap -->`;

		this.bindTabs();
		this.bindDropdown();
		this.bindUpload();
		this.bindAdjust();
		this.bindHistory();
		this.bindLocation();
	},

	/* ── TAB NAVIGATION ─────────────────────────────────────────────────── */
	bindTabs() {
		this.root.querySelectorAll(".rm-tab").forEach(btn => {
			btn.addEventListener("click", () => {
				this.root.querySelectorAll(".rm-tab").forEach(t => t.classList.remove("active"));
				btn.classList.add("active");
				const tab = btn.dataset.tab;
				this.activeTab = tab;
				["upload", "adjust", "history", "location"].forEach(t => {
					document.getElementById(`rm-panel-${t}`)?.classList.toggle("rm-panel-hidden", t !== tab);
				});
				if (tab === "history")  this.loadHistory();
				if (tab === "location") this.loadLocationStats();
			});
		});
	},

	bindDropdown() {
		const btn = document.getElementById("rm-btn-tpl");
		const menu = document.getElementById("rm-tpl-menu");
		btn?.addEventListener("click", e => {
			e.stopPropagation();
			menu.classList.toggle("visible");
		});
		document.addEventListener("click", () => menu?.classList.remove("visible"));

		// Dynamic template downloads for States and Cities
		document.getElementById("rm-tpl-states")?.addEventListener("click", e => {
			e.preventDefault();
			window.location.href = "/api/method/courier_app.api.location_api.get_states_template";
		});
		document.getElementById("rm-tpl-cities")?.addEventListener("click", e => {
			e.preventDefault();
			window.location.href = "/api/method/courier_app.api.location_api.get_cities_template";
		});
	},

	/* ── UPLOAD PANEL ───────────────────────────────────────────────────── */
	renderUploadPanel() {
		return `
<div class="rm-upload-layout">

  <!-- LEFT COLUMN: form + danger zone -->
  <div class="rm-upload-left">

    <div class="rm-card">
      <div class="rm-card-title">Import Rates from Excel</div>

      <div class="rm-form-row">
        <div class="rm-form-group">
          <label class="rm-label">Service Provider <span class="rm-req">*</span></label>
          <select class="rm-select" id="rm-up-provider">
            <option value="">— Select Provider —</option>
          </select>
        </div>
        <div class="rm-form-group">
          <label class="rm-label">Import Type <span class="rm-req">*</span></label>
          <select class="rm-select" id="rm-up-type">
            <option value="Zone Rates">Zone Rates (rates per zone &amp; weight)</option>
            <option value="Country Zones">Country Zones (country → zone mapping)</option>
          </select>
        </div>
      </div>
      <div class="rm-form-row">
        <div class="rm-form-group">
          <label class="rm-label">Import Mode</label>
          <select class="rm-select" id="rm-up-mode">
            <option value="upsert">Upsert — create new, update existing (safe default)</option>
            <option value="replace">Replace — delete all then re-import fresh</option>
            <option value="skip_existing">Skip Existing — only create, never update</option>
          </select>
        </div>
        <div class="rm-form-group" style="display:flex;align-items:flex-end;gap:10px;padding-bottom:2px">
          <label class="rm-label rm-checkbox-label">
            <input type="checkbox" id="rm-up-dryrun" style="margin-right:6px">
            Dry Run (validate without saving)
          </label>
        </div>
      </div>

      <!-- DROP ZONE -->
      <div class="rm-dropzone" id="rm-dropzone">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M20 26V14M14 20l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 28v4h28v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p class="rm-dropzone-title">Drop your Excel (.xlsx) file here</p>
        <p class="rm-dropzone-sub">or <label class="rm-link" for="rm-file-input">browse to upload</label></p>
        <input type="file" id="rm-file-input" accept=".xlsx,.xls" style="display:none">
      </div>
      <div class="rm-file-selected" id="rm-file-selected" style="display:none">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        <span id="rm-file-name">file.xlsx</span>
        <button class="rm-btn-icon-only rm-btn-remove" id="rm-file-remove" title="Remove file">×</button>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
        <button class="rm-btn rm-btn-secondary" id="rm-btn-preview" disabled>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="2" fill="currentColor"/></svg>
          Preview
        </button>
        <button class="rm-btn rm-btn-primary" id="rm-btn-import" disabled>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 8V1M3 5l3.5-4L10 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 9v3h11V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Import
        </button>
        <span class="rm-spinner" id="rm-up-spinner" style="display:none"></span>
      </div>
    </div>

    <!-- PREVIEW AREA -->
    <div id="rm-preview-area" style="display:none"></div>

    <!-- DANGER ZONE -->
    <div class="rm-card rm-danger-zone">
      <div class="rm-card-title rm-danger-title">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style="vertical-align:-2px;margin-right:6px"><path d="M7.5 1L1 13h13L7.5 1Z" stroke="#b91c1c" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 6v3.5" stroke="#b91c1c" stroke-width="1.4" stroke-linecap="round"/><circle cx="7.5" cy="11.5" r="0.7" fill="#b91c1c"/></svg>
        Danger Zone — Clear Provider Data
      </div>
      <p style="font-size:12px;color:var(--text-muted,#6b7280);margin:0 0 12px">
        Permanently delete all Rate Zones, Country Zone mappings, and Import Logs for a selected provider.
        This cannot be undone. Use "Preview" first to see what will be deleted.
      </p>
      <div class="rm-form-row" style="align-items:flex-end;gap:10px">
        <div class="rm-form-group" style="max-width:280px">
          <label class="rm-label">Service Provider <span class="rm-req">*</span></label>
          <select class="rm-select" id="rm-clr-provider">
            <option value="">— Select Provider —</option>
          </select>
        </div>
        <button class="rm-btn rm-btn-ghost rm-btn-sm rm-btn-danger-outline" id="rm-btn-clr-preview">
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="2" fill="currentColor"/></svg>
          Preview Delete
        </button>
        <button class="rm-btn rm-btn-danger rm-btn-sm" id="rm-btn-clr-confirm" disabled>
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M2 3h9M5 3V2h3v1M4 3v7h5V3H4ZM6 5v3M8 5v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Delete All Data
        </button>
        <span class="rm-spinner" id="rm-clr-spinner" style="display:none"></span>
      </div>
      <div id="rm-clr-preview" style="display:none;margin-top:12px;padding:10px 12px;background:var(--bg-light,#fef2f2);border-radius:6px;border:1px solid #fca5a5;font-size:12px"></div>
    </div>

  </div><!-- /.rm-upload-left -->

  <!-- RIGHT COLUMN: recent import history -->
  <div class="rm-upload-right">
    <div class="rm-card rm-side-history-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="rm-card-title" style="margin:0">Recent Imports</div>
        <button class="rm-btn rm-btn-ghost rm-btn-sm" id="rm-btn-side-hist-refresh" title="Refresh">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.65-3.6L12.5 2M12.5 5V2h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 7a5.5 5.5 0 0 1-9.65 3.6L1.5 12M1.5 9v3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div id="rm-side-history"><div class="rm-empty">Loading…</div></div>
    </div>
  </div><!-- /.rm-upload-right -->

</div><!-- /.rm-upload-layout -->`;
	},

	bindUpload() {
		const dropzone = document.getElementById("rm-dropzone");
		const fileInput = document.getElementById("rm-file-input");

		dropzone.addEventListener("click", () => fileInput.click());
		dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
		dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
		dropzone.addEventListener("drop", e => {
			e.preventDefault();
			dropzone.classList.remove("dragover");
			const file = e.dataTransfer.files[0];
			if (file) this.handleFileSelect(file);
		});

		fileInput.addEventListener("change", e => {
			if (e.target.files[0]) this.handleFileSelect(e.target.files[0]);
		});

		document.getElementById("rm-file-remove")?.addEventListener("click", () => this.clearFile());
		document.getElementById("rm-btn-preview")?.addEventListener("click", () => this.runPreview());
		document.getElementById("rm-btn-import")?.addEventListener("click", () => this.runImport());

		document.getElementById("rm-btn-clr-preview")?.addEventListener("click", () => this.runClearPreview());
		document.getElementById("rm-btn-clr-confirm")?.addEventListener("click", () => this.runClearConfirm());
		document.getElementById("rm-clr-provider")?.addEventListener("change", () => {
			document.getElementById("rm-clr-preview").style.display = "none";
			document.getElementById("rm-btn-clr-confirm").disabled = true;
		});

		// Side history — load on init, refresh button
		document.getElementById("rm-btn-side-hist-refresh")?.addEventListener("click", () => this.loadSideHistory());
		this.loadSideHistory();
	},

	handleFileSelect(file) {
		if (!file.name.match(/\.(xlsx|xls)$/i)) {
			this.toast("Only .xlsx / .xls files are supported", "error");
			return;
		}
		// Upload to Frappe (no doctype attachment — log is created during import)
		const formData = new FormData();
		formData.append("file", file, file.name);
		formData.append("is_private", 1);

		const spinner = document.getElementById("rm-up-spinner");
		spinner.style.display = "inline-block";

		fetch("/api/method/upload_file", {
			method: "POST",
			headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
			body: formData,
		})
		.then(r => r.json())
		.then(res => {
			spinner.style.display = "none";
			if (res.message?.file_url) {
				this.uploadFileUrl = res.message.file_url;
				document.getElementById("rm-dropzone").style.display = "none";
				const sel = document.getElementById("rm-file-selected");
				sel.style.display = "flex";
				document.getElementById("rm-file-name").textContent = file.name;
				document.getElementById("rm-btn-preview").disabled = false;
				document.getElementById("rm-btn-import").disabled = false;
				this.previewData = null;
				document.getElementById("rm-preview-area").style.display = "none";
			} else {
				this.toast("Upload failed: " + (res.exc_type || "unknown error"), "error");
			}
		})
		.catch(err => {
			spinner.style.display = "none";
			this.toast("Upload error: " + err.message, "error");
		});
	},

	clearFile() {
		this.uploadFileUrl = null;
		this.previewData = null;
		document.getElementById("rm-dropzone").style.display = "";
		document.getElementById("rm-file-selected").style.display = "none";
		document.getElementById("rm-btn-preview").disabled = true;
		document.getElementById("rm-btn-import").disabled = true;
		document.getElementById("rm-preview-area").style.display = "none";
		document.getElementById("rm-file-input").value = "";
	},

	runPreview() {
		const provider = document.getElementById("rm-up-provider").value;
		const importType = document.getElementById("rm-up-type").value;

		if (!provider) { this.toast("Please select a Service Provider", "warning"); return; }
		if (!this.uploadFileUrl) { this.toast("Please upload a file first", "warning"); return; }

		const spinner = document.getElementById("rm-up-spinner");
		spinner.style.display = "inline-block";
		document.getElementById("rm-btn-preview").disabled = true;

		frappe.call({
			method: "courier_app.api.rate_api.preview_import",
			args: { file_url: this.uploadFileUrl, service_provider: provider, import_type: importType },
			callback: r => {
				spinner.style.display = "none";
				document.getElementById("rm-btn-preview").disabled = false;
				if (r.message) {
					this.previewData = r.message;
					this.renderPreview(r.message);
				}
			},
			error: () => {
				spinner.style.display = "none";
				document.getElementById("rm-btn-preview").disabled = false;
			}
		});
	},

	renderPreview(data) {
		const area = document.getElementById("rm-preview-area");
		area.style.display = "block";

		if (data.import_type === "Zone Rates") {
			const rows = (data.preview || []).map(p => `
<tr>
  <td>${p.zone_code}</td>
  <td>${p.zone_label}</td>
  <td>${p.slab_count}</td>
  <td><span class="rm-badge ${p.action === 'Create' ? 'rm-badge-create' : 'rm-badge-update'}">${p.action}</span></td>
</tr>`).join("");

			area.innerHTML = `
<div class="rm-card">
  <div class="rm-preview-header">
    <div class="rm-preview-stats">
      <span class="rm-stat-chip">Zones: <b>${data.zones}</b></span>
      <span class="rm-stat-chip">Total slabs: <b>${data.total_slabs}</b></span>
      ${data.errors?.length ? `<span class="rm-stat-chip rm-chip-error">Errors: <b>${data.errors.length}</b></span>` : ""}
    </div>
    <div class="rm-preview-legend">
      <span class="rm-badge rm-badge-create">Create</span> new &nbsp;
      <span class="rm-badge rm-badge-update">Update</span> existing
    </div>
  </div>
  <table class="rm-table">
    <thead><tr><th>Zone Code</th><th>Label</th><th>Rate Slabs</th><th>Action</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${data.errors?.length ? `<div class="rm-error-box"><b>Errors:</b><ul>${data.errors.map(e=>`<li>${e}</li>`).join("")}</ul></div>` : ""}
</div>`;
		} else {
			const rows = (data.preview || []).map(p => `
<tr>
  <td>${p.country_code}</td>
  <td>${p.country_name}</td>
  <td>${p.zone_code}</td>
  <td>${p.zone_exists ? '<span class="rm-zone-ok">✓</span>' : '<span class="rm-zone-warn">⚠ Missing</span>'}</td>
  <td><span class="rm-badge ${p.action === 'Create' ? 'rm-badge-create' : 'rm-badge-update'}">${p.action}</span></td>
</tr>`).join("");

			area.innerHTML = `
<div class="rm-card">
  <div class="rm-preview-header">
    <div class="rm-preview-stats">
      <span class="rm-stat-chip">Countries: <b>${data.total}</b></span>
      ${data.zones_missing ? `<span class="rm-stat-chip rm-chip-warn">Zones missing: <b>${data.zones_missing}</b></span>` : ""}
      ${data.errors?.length ? `<span class="rm-stat-chip rm-chip-error">Errors: <b>${data.errors.length}</b></span>` : ""}
    </div>
    <p class="rm-preview-note">Showing first ${data.preview.length} of ${data.total} rows</p>
  </div>
  <div class="rm-table-scroll">
    <table class="rm-table">
      <thead><tr><th>Code</th><th>Country Name</th><th>Zone</th><th>Zone Status</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${data.errors?.length ? `<div class="rm-error-box"><b>Errors:</b><ul>${data.errors.map(e=>`<li>${e}</li>`).join("")}</ul></div>` : ""}
</div>`;
		}
	},

	runImport() {
		const provider  = document.getElementById("rm-up-provider").value;
		const importType= document.getElementById("rm-up-type").value;
		const mode      = document.getElementById("rm-up-mode").value;
		const dryRun    = document.getElementById("rm-up-dryrun").checked;

		if (!provider) { this.toast("Please select a Service Provider", "warning"); return; }
		if (!this.uploadFileUrl) { this.toast("Please upload a file first", "warning"); return; }

		const label = importType === "Zone Rates"
			? (this.previewData ? `${this.previewData.zones} zones / ${this.previewData.total_slabs} slabs` : "zone rates")
			: (this.previewData ? `${this.previewData.total} countries` : "country zones");

		const modeNote = {
			upsert:        "Existing records will be <b>updated</b>. New records will be <b>created</b>.",
			replace:       "<b style='color:#b91c1c'>All existing zones/countries will be DELETED</b> then re-imported fresh.",
			skip_existing: "Only <b>new</b> records will be created. Existing records will be skipped.",
		}[mode];

		const dryNote = dryRun ? "<br><span style='color:#0369a1'><b>Dry Run:</b> nothing will be saved.</span>" : "";

		frappe.confirm(
			`${dryRun ? "Dry-run" : "Import"} ${label} for <b>${provider}</b>?<br><br>${modeNote}${dryNote}`,
			() => this._doImport(provider, importType, mode, dryRun)
		);
	},

	_doImport(provider, importType, mode, dryRun) {
		const spinner = document.getElementById("rm-up-spinner");
		spinner.style.display = "inline-block";
		document.getElementById("rm-btn-import").disabled = true;

		frappe.call({
			method: "courier_app.api.rate_api.execute_import",
			args: {
				file_url:         this.uploadFileUrl,
				service_provider: provider,
				import_type:      importType,
				mode:             mode,
				dry_run:          dryRun,
			},
			callback: r => {
				spinner.style.display = "none";
				document.getElementById("rm-btn-import").disabled = false;
				const d = r.message;
				if (d) {
					const statusLabel = d.dry_run ? "Dry Run" : d.status;
					const type = d.status === "Success" || d.dry_run ? "success"
					           : d.status === "Partial" ? "warning" : "error";
					const skippedPart = d.skipped ? `, Skipped ${d.skipped}` : "";
					this.toast(
						`${statusLabel}: Created ${d.created}, Updated ${d.updated}${skippedPart}, Failed ${d.failed}  [${d.log_id}]`,
						type
					);
					if (!d.dry_run) this.clearFile();
					if (this.activeTab === "history") this.loadHistory();
					this.loadSideHistory();
				}
			},
			error: () => {
				spinner.style.display = "none";
				document.getElementById("rm-btn-import").disabled = false;
			}
		});
	},

	/* ── ADJUST PANEL ───────────────────────────────────────────────────── */
	renderAdjustPanel() {
		return `
<div class="rm-card">
  <div class="rm-card-title">Adjust Rates</div>

  <div class="rm-form-row">
    <div class="rm-form-group">
      <label class="rm-label">Service Provider <span class="rm-req">*</span></label>
      <select class="rm-select" id="rm-adj-provider">
        <option value="">— Select Provider —</option>
      </select>
    </div>
    <div class="rm-form-group">
      <label class="rm-label">Apply To</label>
      <select class="rm-select" id="rm-adj-scope">
        <option value="all">All Zones</option>
        <option value="selected">Selected Zones</option>
      </select>
    </div>
  </div>

  <div class="rm-form-group rm-zones-selector" id="rm-zones-selector" style="display:none">
    <label class="rm-label">Select Zones</label>
    <div class="rm-zones-list" id="rm-zones-list"></div>
  </div>

  <div class="rm-form-row rm-adj-row">
    <div class="rm-form-group">
      <label class="rm-label">Adjustment Type <span class="rm-req">*</span></label>
      <select class="rm-select" id="rm-adj-type">
        <option value="Percentage">Percentage (%)</option>
        <option value="Fixed Amount">Fixed Amount (PKR)</option>
      </select>
    </div>
    <div class="rm-form-group">
      <label class="rm-label">Direction <span class="rm-req">*</span></label>
      <select class="rm-select" id="rm-adj-dir">
        <option value="increase">Increase</option>
        <option value="decrease">Decrease</option>
      </select>
    </div>
    <div class="rm-form-group">
      <label class="rm-label">Value <span class="rm-req">*</span></label>
      <div class="rm-input-suffix-wrap">
        <input type="number" class="rm-input" id="rm-adj-value" min="0.001" step="0.001" placeholder="e.g. 5">
        <span class="rm-input-suffix" id="rm-adj-suffix">%</span>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
    <button class="rm-btn rm-btn-secondary" id="rm-btn-adj-preview" disabled>Preview Changes</button>
    <button class="rm-btn rm-btn-primary rm-btn-danger-action" id="rm-btn-adj-apply" disabled>Apply Changes</button>
    <span class="rm-spinner" id="rm-adj-spinner" style="display:none"></span>
  </div>
</div>

<!-- ADJUSTMENT PREVIEW -->
<div id="rm-adj-preview-area" style="display:none"></div>`;
	},

	bindAdjust() {
		document.getElementById("rm-adj-provider")?.addEventListener("change", e => {
			const p = e.target.value;
			if (p) this.loadZonesForAdjust(p);
			else {
				document.getElementById("rm-zones-list").innerHTML = "";
				document.getElementById("rm-btn-adj-preview").disabled = true;
			}
			document.getElementById("rm-adj-preview-area").style.display = "none";
		});

		document.getElementById("rm-adj-scope")?.addEventListener("change", e => {
			document.getElementById("rm-zones-selector").style.display =
				e.target.value === "selected" ? "block" : "none";
		});

		document.getElementById("rm-adj-type")?.addEventListener("change", e => {
			document.getElementById("rm-adj-suffix").textContent =
				e.target.value === "Percentage" ? "%" : "PKR";
		});

		document.getElementById("rm-btn-adj-preview")?.addEventListener("click", () => this.runAdjPreview());
		document.getElementById("rm-btn-adj-apply")?.addEventListener("click", () => this.runAdjApply());
	},

	loadZonesForAdjust(provider) {
		frappe.call({
			method: "courier_app.api.rate_api.get_zones",
			args: { service_provider: provider },
			callback: r => {
				this.zones = r.message || [];
				const list = document.getElementById("rm-zones-list");
				list.innerHTML = this.zones.map(z => `
<label class="rm-zone-check">
  <input type="checkbox" class="rm-zone-cb" value="${z.zone_code}" checked>
  <span>${z.zone_code} — ${z.zone_label || "Zone " + z.zone_code}</span>
  ${!z.is_active ? '<span class="rm-badge rm-badge-inactive">Inactive</span>' : ""}
</label>`).join("");

				document.getElementById("rm-btn-adj-preview").disabled = this.zones.length === 0;
				document.getElementById("rm-btn-adj-apply").disabled = true;
			}
		});
	},

	_getAdjZoneCodes() {
		const scope = document.getElementById("rm-adj-scope").value;
		if (scope === "all") return ["all"];
		return [...document.querySelectorAll(".rm-zone-cb:checked")].map(cb => cb.value);
	},

	runAdjPreview() {
		const provider = document.getElementById("rm-adj-provider").value;
		const adjType = document.getElementById("rm-adj-type").value;
		const dir = document.getElementById("rm-adj-dir").value;
		const val = parseFloat(document.getElementById("rm-adj-value").value);
		const zoneCodes = this._getAdjZoneCodes();

		if (!provider) { this.toast("Select a provider", "warning"); return; }
		if (!val || val <= 0) { this.toast("Enter a valid adjustment value > 0", "warning"); return; }
		if (!zoneCodes.length) { this.toast("Select at least one zone", "warning"); return; }

		const spinner = document.getElementById("rm-adj-spinner");
		spinner.style.display = "inline-block";
		document.getElementById("rm-btn-adj-preview").disabled = true;

		frappe.call({
			method: "courier_app.api.rate_api.preview_rate_adjustment",
			args: {
				service_provider: provider,
				zone_codes: JSON.stringify(zoneCodes),
				adjustment_type: adjType,
				adjustment_value: val,
				direction: dir,
			},
			callback: r => {
				spinner.style.display = "none";
				document.getElementById("rm-btn-adj-preview").disabled = false;
				if (r.message) {
					this.adjPreviewData = r.message;
					this.renderAdjPreview(r.message, adjType, dir, val);
					document.getElementById("rm-btn-adj-apply").disabled = false;
				}
			},
			error: () => {
				spinner.style.display = "none";
				document.getElementById("rm-btn-adj-preview").disabled = false;
			}
		});
	},

	renderAdjPreview(data, adjType, dir, val) {
		const area = document.getElementById("rm-adj-preview-area");
		area.style.display = "block";

		const dirLabel = dir === "increase" ? "↑" : "↓";
		const suffix = adjType === "Percentage" ? "%" : " PKR";
		const title = `${dirLabel} ${val}${suffix} — ${data.zones_affected} zone(s), ${data.slabs_affected} slab(s) affected`;

		const rows = (data.preview || []).map(p => `
<tr>
  <td>${p.zone_code}</td>
  <td class="rm-td-muted">${p.zone_label}</td>
  <td class="rm-td-right">${p.is_per_kg ? "71+ /kg" : p.max_weight_kg + " kg"}</td>
  <td class="rm-td-right rm-td-mono">${p.old_rate.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
  <td class="rm-td-right rm-td-mono rm-td-new">${p.new_rate.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
  <td class="rm-td-right rm-td-mono ${p.change >= 0 ? 'rm-td-up' : 'rm-td-down'}">${p.change >= 0 ? '+' : ''}${p.change.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
</tr>`).join("");

		area.innerHTML = `
<div class="rm-card">
  <div class="rm-card-title">${title}</div>
  ${data.preview.length < data.slabs_affected ? `<p class="rm-preview-note">Showing first ${data.preview.length} of ${data.slabs_affected} slabs</p>` : ""}
  <div class="rm-table-scroll">
    <table class="rm-table">
      <thead>
        <tr>
          <th>Zone</th><th>Label</th><th>Weight</th>
          <th class="rm-th-right">Old Rate</th>
          <th class="rm-th-right">New Rate</th>
          <th class="rm-th-right">Change</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
	},

	runAdjApply() {
		const provider = document.getElementById("rm-adj-provider").value;
		const adjType = document.getElementById("rm-adj-type").value;
		const dir = document.getElementById("rm-adj-dir").value;
		const val = parseFloat(document.getElementById("rm-adj-value").value);
		const zoneCodes = this._getAdjZoneCodes();
		const d = this.adjPreviewData;

		const dirLabel = dir === "increase" ? "increase" : "decrease";
		const suffix = adjType === "Percentage" ? "%" : " PKR";

		frappe.confirm(
			`Apply <b>${dirLabel} ${val}${suffix}</b> to <b>${d?.zones_affected || "selected"} zone(s)</b>, affecting <b>${d?.slabs_affected || "all"} slabs</b>?<br><br>⚠ This will <b>permanently update</b> the rate slabs.`,
			() => {
				const spinner = document.getElementById("rm-adj-spinner");
				spinner.style.display = "inline-block";
				document.getElementById("rm-btn-adj-apply").disabled = true;

				frappe.call({
					method: "courier_app.api.rate_api.apply_rate_adjustment",
					args: {
						service_provider: provider,
						zone_codes: JSON.stringify(zoneCodes),
						adjustment_type: adjType,
						adjustment_value: val,
						direction: dir,
					},
					callback: r => {
						spinner.style.display = "none";
						if (r.message?.status === "ok") {
							this.toast(
								`Rates updated: ${r.message.zones_updated} zones, ${r.message.slabs_updated} slabs`,
								"success"
							);
							document.getElementById("rm-adj-preview-area").style.display = "none";
							document.getElementById("rm-btn-adj-apply").disabled = true;
						}
					},
					error: () => {
						spinner.style.display = "none";
						document.getElementById("rm-btn-adj-apply").disabled = false;
					}
				});
			}
		);
	},

	/* ── HISTORY PANEL ──────────────────────────────────────────────────── */
	renderHistoryPanel() {
		return `
<div class="rm-card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <div class="rm-card-title" style="margin:0">Import History</div>
    <div style="display:flex;gap:10px">
      <select class="rm-select rm-select-sm" id="rm-hist-provider">
        <option value="">All Providers</option>
      </select>
      <button class="rm-btn rm-btn-ghost rm-btn-sm" id="rm-btn-hist-refresh">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.65-3.6L12.5 2M12.5 5V2h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 7a5.5 5.5 0 0 1-9.65 3.6L1.5 12M1.5 9v3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh
      </button>
    </div>
  </div>
  <div id="rm-history-table">
    <div class="rm-empty">Loading…</div>
  </div>
</div>`;
	},

	bindHistory() {
		document.getElementById("rm-hist-provider")?.addEventListener("change", () => this.loadHistory());
		document.getElementById("rm-btn-hist-refresh")?.addEventListener("click", () => this.loadHistory());
	},

	loadHistory() {
		const provider = document.getElementById("rm-hist-provider")?.value || "";
		frappe.call({
			method: "courier_app.api.rate_api.get_import_history",
			args: { service_provider: provider, limit: 50 },
			callback: r => this.renderHistory(r.message || [])
		});
	},

	renderHistory(rows) {
		const wrap = document.getElementById("rm-history-table");
		if (!rows.length) {
			wrap.innerHTML = `<div class="rm-empty"><p>No import records found</p></div>`;
			return;
		}
		const statusClass = { Success: "rm-badge-success", Partial: "rm-badge-warn", Failed: "rm-badge-error", Processing: "rm-badge-processing" };
		const trs = rows.map(r => `
<tr>
  <td class="rm-td-mono rm-td-sm"><a href="/app/rate-import-log/${r.name}" target="_blank">${r.name}</a></td>
  <td>${r.service_provider || "—"}</td>
  <td>${r.import_type || "—"}</td>
  <td><span class="rm-badge ${statusClass[r.status] || ''}">${r.status}</span></td>
  <td class="rm-td-right">${r.rows_created ?? "—"}</td>
  <td class="rm-td-right">${r.rows_updated ?? "—"}</td>
  <td class="rm-td-right ${r.rows_failed ? 'rm-td-fail' : ''}">${r.rows_failed ?? "—"}</td>
  <td class="rm-td-muted rm-td-sm">${r.import_date ? frappe.datetime.str_to_user(r.import_date) : "—"}</td>
  <td class="rm-td-muted rm-td-sm">${r.imported_by || "—"}</td>
</tr>`).join("");

		wrap.innerHTML = `
<div class="rm-table-scroll">
  <table class="rm-table">
    <thead>
      <tr>
        <th>Log ID</th><th>Provider</th><th>Type</th><th>Status</th>
        <th class="rm-th-right">Created</th><th class="rm-th-right">Updated</th>
        <th class="rm-th-right">Failed</th><th>Date</th><th>By</th>
      </tr>
    </thead>
    <tbody>${trs}</tbody>
  </table>
</div>`;
	},

	/* ── SIDE HISTORY (right column of Upload tab) ─────────────────────── */
	loadSideHistory() {
		const wrap = document.getElementById("rm-side-history");
		if (!wrap) return;
		wrap.innerHTML = '<div class="rm-empty" style="padding:10px 0">Loading…</div>';
		frappe.call({
			method: "courier_app.api.rate_api.get_import_history",
			args: { service_provider: "", limit: 15 },
			callback: r => this.renderSideHistory(r.message || [])
		});
	},

	renderSideHistory(rows) {
		const wrap = document.getElementById("rm-side-history");
		if (!wrap) return;
		if (!rows.length) {
			wrap.innerHTML = `<div class="rm-empty"><p>No imports yet</p></div>`;
			return;
		}
		const statusClass = { Success: "rm-badge-success", Partial: "rm-badge-warn", Failed: "rm-badge-error", Processing: "rm-badge-processing" };
		wrap.innerHTML = rows.map(r => `
<div class="rm-sh-row">
  <div class="rm-sh-top">
    <a class="rm-sh-id" href="/app/rate-import-log/${r.name}" target="_blank">${r.name}</a>
    <span class="rm-badge ${statusClass[r.status] || ''}">${r.status}</span>
  </div>
  <div class="rm-sh-meta">
    <span class="rm-sh-provider">${r.service_provider || "—"}</span>
    <span class="rm-sh-dot">·</span>
    <span>${r.import_type || "—"}</span>
    <span class="rm-sh-dot">·</span>
    <span class="rm-td-muted">${r.import_date ? frappe.datetime.str_to_user(r.import_date) : "—"}</span>
  </div>
  <div class="rm-sh-counts">
    <span class="rm-sh-cnt rm-sh-cnt--ok">+${r.rows_created ?? 0}</span>
    <span class="rm-sh-cnt rm-sh-cnt--upd">~${r.rows_updated ?? 0}</span>
    ${r.rows_failed ? `<span class="rm-sh-cnt rm-sh-cnt--err">✕${r.rows_failed}</span>` : ""}
  </div>
</div>`).join("");
	},

	/* ── CLEAR PROVIDER DATA ────────────────────────────────────────────── */
	runClearPreview() {
		const provider = document.getElementById("rm-clr-provider").value;
		if (!provider) { this.toast("Please select a Service Provider", "warning"); return; }
		const spinner  = document.getElementById("rm-clr-spinner");
		const preview  = document.getElementById("rm-clr-preview");
		spinner.style.display = "inline-block";
		preview.style.display = "none";
		document.getElementById("rm-btn-clr-confirm").disabled = true;

		frappe.call({
			method: "courier_app.api.rate_api.clear_provider_data",
			args: { service_provider: provider, confirm: false },
			callback: r => {
				spinner.style.display = "none";
				const d = r.message;
				if (d) {
					preview.style.display = "block";
					preview.innerHTML = `
<b style="color:#b91c1c">Will permanently delete for <em>${provider}</em>:</b><br>
<span style="padding-left:12px">• <b>${d.zones}</b> Rate Zone(s) (${d.zone_slabs} rate slabs)</span><br>
<span style="padding-left:12px">• <b>${d.country_zones}</b> Country Zone mapping(s)</span><br>
<span style="padding-left:12px">• <b>${d.import_logs}</b> Import Log(s)</span><br>
${d.zones || d.country_zones || d.import_logs
	? `<span style="color:#b91c1c;margin-top:6px;display:block">Click <b>Delete All Data</b> to proceed — this cannot be undone.</span>`
	: `<span style="color:#059669">Nothing to delete — provider has no data.</span>`}`;
					if (d.zones || d.country_zones || d.import_logs) {
						document.getElementById("rm-btn-clr-confirm").disabled = false;
					}
				}
			},
			error: () => { spinner.style.display = "none"; }
		});
	},

	runClearConfirm() {
		const provider = document.getElementById("rm-clr-provider").value;
		if (!provider) return;
		frappe.confirm(
			`<span style="color:#b91c1c"><b>Permanently delete ALL data for ${provider}?</b></span><br><br>
This will remove all Rate Zones, Country Zone mappings, and Import Logs. <b>This cannot be undone.</b>`,
			() => {
				const spinner = document.getElementById("rm-clr-spinner");
				spinner.style.display = "inline-block";
				document.getElementById("rm-btn-clr-confirm").disabled = true;
				frappe.call({
					method: "courier_app.api.rate_api.clear_provider_data",
					args: { service_provider: provider, confirm: true },
					callback: r => {
						spinner.style.display = "none";
						const d = r.message;
						if (d) {
							document.getElementById("rm-clr-preview").style.display = "none";
							this.toast(
								`Deleted: ${d.zones} zones, ${d.country_zones} country mappings, ${d.import_logs} logs`,
								"success"
							);
						}
					},
					error: () => {
						spinner.style.display = "none";
						document.getElementById("rm-btn-clr-confirm").disabled = false;
					}
				});
			}
		);
	},

	/* ── PROVIDER LOADER ────────────────────────────────────────────────── */
	loadProviders() {
		frappe.call({
			method: "courier_app.api.rate_api.get_service_providers",
			callback: r => {
				this.providers = r.message || [];
				const opts = this.providers.map(p =>
					`<option value="${p.name}">${p.provider_name} (${p.provider_code})</option>`
				).join("");

				["rm-up-provider", "rm-adj-provider", "rm-hist-provider", "rm-clr-provider"].forEach(id => {
					const el = document.getElementById(id);
					if (el) el.innerHTML = (id === "rm-hist-provider" ? '<option value="">All Providers</option>' : '<option value="">— Select Provider —</option>') + opts;
				});
			}
		});
	},

	/* ── LOCATION DATA ──────────────────────────────────────────────────── */
	renderLocationPanel() {
		const dropSvg = `<svg width="36" height="36" viewBox="0 0 40 40" fill="none"><path d="M20 26V14M14 20l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 28v4h28v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		const fileSvg  = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

		const mkSection = (id, title) => `
<div class="rm-card" style="margin-bottom:16px">
  <div class="rm-card-title">${title}</div>
  <div class="rm-form-row">
    <div class="rm-form-group">
      <label class="rm-label">Import Mode</label>
      <select class="rm-select" id="loc-${id}-mode">
        <option value="upsert">Upsert — create new, update existing</option>
        <option value="skip_existing">Skip Existing — only create new</option>
      </select>
    </div>
  </div>
  <div class="rm-dropzone" id="loc-${id}-dropzone">
    ${dropSvg}
    <p class="rm-dropzone-title">Drop Excel (.xlsx) here</p>
    <p class="rm-dropzone-sub">or <label class="rm-link" for="loc-${id}-file-input">browse to upload</label></p>
    <input type="file" id="loc-${id}-file-input" accept=".xlsx,.xls" style="display:none">
  </div>
  <div class="rm-file-selected" id="loc-${id}-file-selected" style="display:none">
    ${fileSvg}
    <span id="loc-${id}-file-name">file.xlsx</span>
    <button class="rm-btn-icon-only rm-btn-remove" id="loc-${id}-file-remove" title="Remove">×</button>
  </div>
  <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
    <button class="rm-btn rm-btn-primary" id="loc-btn-import-${id}" disabled>
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 8V1M3 5l3.5-4L10 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 9v3h11V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Import
    </button>
    <span class="rm-spinner" id="loc-${id}-spinner" style="display:none"></span>
  </div>
  <div id="loc-${id}-result" style="display:none;margin-top:10px"></div>
</div>`;

		return `
<!-- Stats + Seed -->
<div class="rm-card" style="margin-bottom:16px">
  <div class="rm-card-title">Location Data Overview</div>
  <div id="loc-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    <div class="rm-stat-chip"><span id="loc-stat-states" style="font-size:22px;font-weight:600;display:block">—</span>States / Provinces</div>
    <div class="rm-stat-chip"><span id="loc-stat-cities" style="font-size:22px;font-weight:600;display:block">—</span>Cities</div>
    <div class="rm-stat-chip"><span id="loc-stat-countries" style="font-size:22px;font-weight:600;display:block">—</span>Countries with Data</div>
  </div>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <button class="rm-btn rm-btn-primary" id="loc-btn-seed">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="4" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 11c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Seed from App Defaults
    </button>
    <span style="font-size:12px;color:var(--text-muted,#6b7280)">
      Seeds States/Provinces and Cities only — does not affect Country Zone or rate data
    </span>
    <span class="rm-spinner" id="loc-seed-spinner" style="display:none"></span>
  </div>
  <div id="loc-seed-result" style="display:none;margin-top:10px"></div>
</div>

<!-- Excel Import (collapsible) — placed before Manage panels -->
<details class="rm-loc-import-details">
  <summary class="rm-loc-import-summary">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 8V1M3 5l3.5-4L10 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 9v3h11V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Bulk Import via Excel
  </summary>
  <div style="padding-top:14px">
    ${mkSection("states", "Import States / Provinces")}
    ${mkSection("cities",  "Import Cities")}
  </div>
</details>

<!-- Manage Defaults — two column -->
<div class="rm-loc-manage-layout">

  <!-- States -->
  <div class="rm-card rm-loc-col">
    <div class="rm-card-title">Manage States / Provinces</div>
    <div class="rm-form-row" style="margin-bottom:10px;grid-template-columns:1fr">
      <div class="rm-form-group">
        <label class="rm-label">Country</label>
        <select class="rm-select" id="loc-mgr-state-country">
          <option value="">— Select Country —</option>
        </select>
      </div>
    </div>
    <!-- Add form -->
    <div class="rm-loc-add-row" id="loc-state-add-row" style="display:none">
      <input class="rm-input" id="loc-state-new-name" placeholder="State / Province name" style="flex:1">
      <button class="rm-btn rm-btn-primary rm-btn-sm" id="loc-btn-add-state">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Add
      </button>
    </div>
    <!-- Search -->
    <div class="rm-loc-search-wrap" id="loc-state-search-wrap" style="display:none">
      <svg class="rm-loc-search-icon" width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/><path d="M9 9l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      <input class="rm-loc-search-input" id="loc-state-search" placeholder="Search states…" autocomplete="off">
    </div>
    <div class="rm-loc-list-wrap" id="loc-state-list"><div class="rm-empty" style="padding:16px 0">Select a country to load states</div></div>
  </div>

  <!-- Cities -->
  <div class="rm-card rm-loc-col">
    <div class="rm-card-title">Manage Cities</div>
    <div class="rm-form-row" style="margin-bottom:10px">
      <div class="rm-form-group">
        <label class="rm-label">Country</label>
        <select class="rm-select" id="loc-mgr-city-country">
          <option value="">— Select Country —</option>
        </select>
      </div>
      <div class="rm-form-group">
        <label class="rm-label">State / Province</label>
        <select class="rm-select" id="loc-mgr-city-state">
          <option value="">All States</option>
        </select>
      </div>
    </div>
    <!-- Add form -->
    <div class="rm-loc-add-row" id="loc-city-add-row" style="display:none">
      <input class="rm-input" id="loc-city-new-name" placeholder="City name" style="flex:1">
      <button class="rm-btn rm-btn-primary rm-btn-sm" id="loc-btn-add-city">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Add
      </button>
    </div>
    <!-- Search -->
    <div class="rm-loc-search-wrap" id="loc-city-search-wrap" style="display:none">
      <svg class="rm-loc-search-icon" width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/><path d="M9 9l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      <input class="rm-loc-search-input" id="loc-city-search" placeholder="Search cities…" autocomplete="off">
    </div>
    <div class="rm-loc-list-wrap" id="loc-city-list"><div class="rm-empty" style="padding:16px 0">Select a country to load cities</div></div>
  </div>

</div><!-- /.rm-loc-manage-layout -->
`;
	},

	bindLocation() {
		this._bindLocSection("states", "courier_app.api.location_api.import_states");
		this._bindLocSection("cities",  "courier_app.api.location_api.import_cities");

		document.getElementById("loc-btn-seed")?.addEventListener("click", () => {
			frappe.confirm(
				"Seed all built-in States/Provinces and Cities into the database?<br>Country Zone data will NOT be affected. Existing records will not be overwritten.",
				() => {
					document.getElementById("loc-seed-spinner").style.display = "inline-block";
					document.getElementById("loc-btn-seed").disabled = true;
					frappe.call({
						method: "courier_app.api.location_api.seed_location_data",
						callback: r => {
							document.getElementById("loc-seed-spinner").style.display = "none";
							document.getElementById("loc-btn-seed").disabled = false;
							const d   = r.message || {};
							const res = document.getElementById("loc-seed-result");
							res.style.display = "block";
							res.className = "rm-result-box rm-result-success";
							res.innerHTML = `<b>Seeded successfully.</b> &nbsp; Created states: <b>${d.created_states}</b> &nbsp; Created cities: <b>${d.created_cities}</b> &nbsp; Skipped (already exist): <b>${d.skipped}</b>`;
							this.loadLocationStats();
							// Refresh manager if a country is already selected
							this._reloadStateMgr();
							this._reloadCityMgr();
						},
						error: () => {
							document.getElementById("loc-seed-spinner").style.display = "none";
							document.getElementById("loc-btn-seed").disabled = false;
							this.toast("Seed failed — check error log", "error");
						}
					});
				}
			);
		});

		this._bindLocationManager();
	},

	_bindLocationManager() {
		// Populate country dropdowns from providers/countries list
		this._fillCountrySelects();

		// ── States manager ──
		const stateCountrySel = document.getElementById("loc-mgr-state-country");
		stateCountrySel?.addEventListener("change", () => this._reloadStateMgr());

		document.getElementById("loc-btn-add-state")?.addEventListener("click", () => {
			const country = document.getElementById("loc-mgr-state-country")?.value;
			const name    = document.getElementById("loc-state-new-name")?.value.trim();
			if (!country || !name) { this.toast("Select a country and enter a state name", "warning"); return; }
			frappe.call({
				method: "courier_app.api.location_api.add_state",
				args:   { country, state_name: name },
				callback: r => {
					document.getElementById("loc-state-new-name").value = "";
					this._reloadStateMgr();
					this.loadLocationStats();
					this.toast(`Added: ${r.message?.state_name}`, "success");
				},
				error: () => {}
			});
		});
		document.getElementById("loc-state-new-name")?.addEventListener("keydown", e => {
			if (e.key === "Enter") document.getElementById("loc-btn-add-state")?.click();
		});

		// ── Cities manager ──
		const cityCountrySel = document.getElementById("loc-mgr-city-country");
		const cityStateSel   = document.getElementById("loc-mgr-city-state");

		cityCountrySel?.addEventListener("change", () => {
			// Populate state dropdown for the chosen country
			const country = cityCountrySel.value;
			cityStateSel.innerHTML = '<option value="">All States</option>';
			if (!country) { this._reloadCityMgr(); return; }
			frappe.call({
				method: "courier_app.api.location_api.list_states",
				args:   { country },
				callback: r => {
					(r.message || []).forEach(s => {
						const opt = document.createElement("option");
						opt.value = s.name; opt.textContent = s.state_name;
						cityStateSel.appendChild(opt);
					});
					this._reloadCityMgr();
					document.getElementById("loc-city-add-row").style.display = "flex";
				}
			});
		});

		cityStateSel?.addEventListener("change", () => this._reloadCityMgr());

		document.getElementById("loc-btn-add-city")?.addEventListener("click", () => {
			const country = document.getElementById("loc-mgr-city-country")?.value;
			const state   = document.getElementById("loc-mgr-city-state")?.value;
			const name    = document.getElementById("loc-city-new-name")?.value.trim();
			if (!country || !name) { this.toast("Select a country and enter a city name", "warning"); return; }
			frappe.call({
				method: "courier_app.api.location_api.add_city",
				args:   { country, city_name: name, state_or_province: state },
				callback: r => {
					document.getElementById("loc-city-new-name").value = "";
					this._reloadCityMgr();
					this.loadLocationStats();
					this.toast(`Added: ${r.message?.city_name}`, "success");
				},
				error: () => {}
			});
		});
		document.getElementById("loc-city-new-name")?.addEventListener("keydown", e => {
			if (e.key === "Enter") document.getElementById("loc-btn-add-city")?.click();
		});
	},

	_fillCountrySelects() {
		// Use the already-loaded providers list for known countries, plus fetch distinct countries from DB
		frappe.call({
			method: "frappe.client.get_list",
			args:   { doctype: "Country", fields: ["name"], order_by: "name asc", limit_page_length: 300 },
			callback: r => {
				const countries = (r.message || []).map(c => c.name);
				["loc-mgr-state-country", "loc-mgr-city-country"].forEach(id => {
					const sel = document.getElementById(id);
					if (!sel) return;
					const current = sel.value;
					sel.innerHTML = '<option value="">— Select Country —</option>';
					countries.forEach(c => {
						const opt = document.createElement("option");
						opt.value = c; opt.textContent = c;
						if (c === current) opt.selected = true;
						sel.appendChild(opt);
					});
				});
			}
		});
	},

	_reloadStateMgr() {
		const country     = document.getElementById("loc-mgr-state-country")?.value;
		const listEl      = document.getElementById("loc-state-list");
		const addRow      = document.getElementById("loc-state-add-row");
		const searchWrap  = document.getElementById("loc-state-search-wrap");
		const searchInput = document.getElementById("loc-state-search");
		if (!listEl) return;
		if (!country) {
			listEl.innerHTML = '<div class="rm-empty" style="padding:16px 0">Select a country to load states</div>';
			if (addRow) addRow.style.display = "none";
			if (searchWrap) searchWrap.style.display = "none";
			if (searchInput) searchInput.value = "";
			return;
		}
		listEl.innerHTML = '<div class="rm-empty" style="padding:10px 0">Loading…</div>';
		if (addRow) addRow.style.display = "flex";
		frappe.call({
			method: "courier_app.api.location_api.list_states",
			args:   { country },
			callback: r => {
				const rows = r.message || [];
				if (!rows.length) {
					listEl.innerHTML = '<div class="rm-empty" style="padding:10px 0">No states found. Add one above.</div>';
					if (searchWrap) searchWrap.style.display = "none";
					return;
				}
				if (searchWrap) searchWrap.style.display = "flex";
				if (searchInput) searchInput.value = "";

				listEl.innerHTML = `
<div class="rm-loc-list-head rm-loc-list-head--sticky"><span>State / Province</span><span></span></div>
<div class="rm-loc-scroll" id="loc-state-scroll">` +
				rows.map(s => `
<div class="rm-loc-row" data-name="${s.name}" data-search="${s.state_name.toLowerCase()}">
  <span class="rm-loc-row-name">${s.state_name}</span>
  <button class="rm-loc-del-btn" data-name="${s.name}" data-label="${s.state_name}" title="Delete">
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
  </button>
</div>`).join("") + `
<div class="rm-loc-no-results" style="display:none">No matches</div>
</div>`;

				// search filter
				searchInput?.addEventListener("input", () => {
					const q = searchInput.value.toLowerCase();
					const scroll = document.getElementById("loc-state-scroll");
					if (!scroll) return;
					let visible = 0;
					scroll.querySelectorAll(".rm-loc-row").forEach(row => {
						const match = !q || row.dataset.search.includes(q);
						row.style.display = match ? "" : "none";
						if (match) visible++;
					});
					const noRes = scroll.querySelector(".rm-loc-no-results");
					if (noRes) noRes.style.display = visible === 0 ? "" : "none";
				});

				listEl.querySelectorAll(".rm-loc-del-btn").forEach(btn => {
					btn.addEventListener("click", () => {
						frappe.confirm(`Delete state "<b>${btn.dataset.label}</b>"?<br><small>All its cities will also be removed.</small>`, () => {
							frappe.call({
								method: "courier_app.api.location_api.delete_state",
								args:   { name: btn.dataset.name },
								callback: r => {
									this._reloadStateMgr();
									this._reloadCityMgr();
									this.loadLocationStats();
									const removed = r.message?.cities_removed || 0;
									this.toast(`Deleted${removed ? ` (+ ${removed} cities)` : ""}`, "info");
								},
								error: () => {}
							});
						});
					});
				});
			}
		});
	},

	_reloadCityMgr() {
		const country     = document.getElementById("loc-mgr-city-country")?.value;
		const state       = document.getElementById("loc-mgr-city-state")?.value;
		const listEl      = document.getElementById("loc-city-list");
		const addRow      = document.getElementById("loc-city-add-row");
		const searchWrap  = document.getElementById("loc-city-search-wrap");
		const searchInput = document.getElementById("loc-city-search");
		if (!listEl) return;
		if (!country) {
			listEl.innerHTML = '<div class="rm-empty" style="padding:16px 0">Select a country to load cities</div>';
			if (addRow) addRow.style.display = "none";
			if (searchWrap) searchWrap.style.display = "none";
			if (searchInput) searchInput.value = "";
			return;
		}
		listEl.innerHTML = '<div class="rm-empty" style="padding:10px 0">Loading…</div>';
		if (addRow) addRow.style.display = "flex";
		frappe.call({
			method: "courier_app.api.location_api.list_cities",
			args:   { country, state_or_province: state },
			callback: r => {
				const rows = r.message || [];
				if (!rows.length) {
					listEl.innerHTML = '<div class="rm-empty" style="padding:10px 0">No cities found. Add one above.</div>';
					if (searchWrap) searchWrap.style.display = "none";
					return;
				}
				if (searchWrap) searchWrap.style.display = "flex";
				if (searchInput) searchInput.value = "";

				listEl.innerHTML = `
<div class="rm-loc-list-head rm-loc-list-head--sticky"><span>City</span><span>${state ? "" : "State"}</span><span></span></div>
<div class="rm-loc-scroll" id="loc-city-scroll">` +
				rows.map(c => {
					const stateLabel = state ? "" : (c.state_or_province ? c.state_or_province.split("-").slice(1).join("-") : "—");
					const searchVal  = [c.city_name, stateLabel].join(" ").toLowerCase();
					return `
<div class="rm-loc-row" data-name="${c.name}" data-search="${searchVal}">
  <span class="rm-loc-row-name">${c.city_name}</span>
  <span class="rm-loc-row-state">${stateLabel}</span>
  <button class="rm-loc-del-btn" data-name="${c.name}" data-label="${c.city_name}" title="Delete">
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
  </button>
</div>`;
				}).join("") + `
<div class="rm-loc-no-results" style="display:none">No matches</div>
</div>`;

				// search filter
				searchInput?.addEventListener("input", () => {
					const q = searchInput.value.toLowerCase();
					const scroll = document.getElementById("loc-city-scroll");
					if (!scroll) return;
					let visible = 0;
					scroll.querySelectorAll(".rm-loc-row").forEach(row => {
						const match = !q || row.dataset.search.includes(q);
						row.style.display = match ? "" : "none";
						if (match) visible++;
					});
					const noRes = scroll.querySelector(".rm-loc-no-results");
					if (noRes) noRes.style.display = visible === 0 ? "" : "none";
				});

				listEl.querySelectorAll(".rm-loc-del-btn").forEach(btn => {
					btn.addEventListener("click", () => {
						frappe.confirm(`Delete city "<b>${btn.dataset.label}</b>"?`, () => {
							frappe.call({
								method: "courier_app.api.location_api.delete_city",
								args:   { name: btn.dataset.name },
								callback: () => {
									this._reloadCityMgr();
									this.loadLocationStats();
									this.toast("Deleted", "info");
								},
								error: () => {}
							});
						});
					});
				});
			}
		});
	},

	_bindLocSection(id, apiMethod) {
		const dropzone  = document.getElementById(`loc-${id}-dropzone`);
		const fileInput = document.getElementById(`loc-${id}-file-input`);
		const selBox    = document.getElementById(`loc-${id}-file-selected`);
		const fileName  = document.getElementById(`loc-${id}-file-name`);
		const removeBtn = document.getElementById(`loc-${id}-file-remove`);
		const importBtn = document.getElementById(`loc-btn-import-${id}`);
		const spinner   = document.getElementById(`loc-${id}-spinner`);
		const resultBox = document.getElementById(`loc-${id}-result`);

		let fileUrl = null;

		const setFile = file => {
			if (!file.name.match(/\.(xlsx|xls)$/i)) {
				this.toast("Only .xlsx / .xls files are supported", "error"); return;
			}
			// Upload via Frappe file manager
			const fd = new FormData();
			fd.append("file", file, file.name);
			fd.append("is_private", "1");
			fetch("/api/method/upload_file", {
				method: "POST",
				headers: { "X-Frappe-CSRF-Token": frappe.csrf_token || "fetch" },
				body: fd,
			}).then(r => r.json()).then(res => {
				if (res.message?.file_url) {
					fileUrl = res.message.file_url;
					fileName.textContent = file.name;
					dropzone.style.display = "none";
					selBox.style.display   = "flex";
					importBtn.disabled     = false;
				} else {
					this.toast("Upload failed", "error");
				}
			}).catch(() => this.toast("Upload error", "error"));
		};

		dropzone.addEventListener("click",    () => fileInput.click());
		dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
		dropzone.addEventListener("dragleave",  () => dropzone.classList.remove("dragover"));
		dropzone.addEventListener("drop", e => {
			e.preventDefault();
			dropzone.classList.remove("dragover");
			if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
		});
		fileInput.addEventListener("change", e => { if (e.target.files[0]) setFile(e.target.files[0]); });

		removeBtn?.addEventListener("click", () => {
			fileUrl = null;
			fileInput.value = "";
			selBox.style.display    = "none";
			dropzone.style.display  = "";
			importBtn.disabled      = true;
			resultBox.style.display = "none";
		});

		importBtn?.addEventListener("click", () => {
			if (!fileUrl) return;
			const mode = document.getElementById(`loc-${id}-mode`)?.value || "upsert";
			importBtn.disabled         = true;
			spinner.style.display      = "inline-block";
			resultBox.style.display    = "none";

			frappe.call({
				method: apiMethod,
				args:   { file_url: fileUrl, mode },
				callback: r => {
					spinner.style.display = "none";
					importBtn.disabled    = false;
					const d   = r.message || {};
					const ok  = d.status === "success" || d.status === "partial";
					resultBox.style.display = "block";
					resultBox.className = `rm-result-box ${ok ? "rm-result-success" : "rm-result-error"}`;
					resultBox.innerHTML =
						`<b>${d.status === "success" ? "Import complete" : d.status === "partial" ? "Partial import" : "Import failed"}</b>` +
						`&nbsp; Created: <b>${d.created}</b> &nbsp; Updated: <b>${d.updated}</b> &nbsp; Failed: <b>${d.failed}</b>` +
						(d.errors?.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:11px">${d.errors.map(e => `<li>${e}</li>`).join("")}</ul>` : "");
					this.loadLocationStats();
				},
				error: () => {
					spinner.style.display = "none";
					importBtn.disabled    = false;
					this.toast(`${id} import failed — check error log`, "error");
				}
			});
		});
	},

	loadLocationStats() {
		frappe.call({
			method: "courier_app.api.location_api.get_location_stats",
			callback: r => {
				const d = r.message || {};
				const s = n => n?.toLocaleString() || "0";
				const el = id => document.getElementById(id);
				if (el("loc-stat-states"))    el("loc-stat-states").textContent    = s(d.states);
				if (el("loc-stat-cities"))    el("loc-stat-cities").textContent    = s(d.cities);
				if (el("loc-stat-countries")) el("loc-stat-countries").textContent = s(d.countries_with_states);
			}
		});
	},

	/* ── TOAST ──────────────────────────────────────────────────────────── */
	toast(msg, type = "info") {
		const el = document.createElement("div");
		el.className = `rm-toast ${type}`;
		el.textContent = msg;
		document.body.appendChild(el);
		requestAnimationFrame(() => el.classList.add("show"));
		setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 4000);
	},
};
