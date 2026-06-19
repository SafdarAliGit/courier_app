/* ── Courier Shipment — Desk Form JS ──────────────────────────────────────── */

/* ── Parent form ──────────────────────────────────────────────────────────── */
frappe.ui.form.on("Courier Shipment", {

	setup(frm) {
		["sender", "recipient"].forEach(w => {
			["state", "city"].forEach(t => {
				const id = `ca-dl-${w}-${t}`;
				if (!document.getElementById(id)) {
					const dl = document.createElement("datalist");
					dl.id = id;
					document.body.appendChild(dl);
				}
			});
		});
		frm._previous_status = frm.doc.status;
	},

	refresh(frm) {
		frm._previous_status = frm.doc.status;

		["sender", "recipient"].forEach(w => {
			_attach(frm, `${w}_state`, `ca-dl-${w}-state`);
			_attach(frm, `${w}_city`,  `ca-dl-${w}-city`);
		});

		if (frm.doc.sender_country)
			_loadStates(frm.doc.sender_country, "sender");
		if (frm.doc.recipient_country)
			_loadStates(frm.doc.recipient_country, "recipient");
		if (frm.doc.sender_country && frm.doc.sender_state)
			_loadCities(frm.doc.sender_country, frm.doc.sender_state, "sender");
		if (frm.doc.recipient_country && frm.doc.recipient_state)
			_loadCities(frm.doc.recipient_country, frm.doc.recipient_state, "recipient");

		_recalc_all_commodities(frm);
		_inject_hs_styles();
		_customize_grid_buttons(frm);

		if (!frm.is_new()) {
			frm.add_custom_button(__("Print Barcode"), () => _show_barcode_popup(frm), __("Print"));
		}
	},

	validate(frm) {
		_recalc_all_commodities(frm);
	},

	status(frm) {
		if (!frm.doc.status || frm.doc.status === frm._previous_status) return;
		_handle_status_change(frm);
	},

	commodities_add(frm) {
		_update_commodity_total(frm);
	},

	commodities_remove(frm) {
		_recalc_all_commodities(frm);
	},

	/* ── Sender cascades ── */
	sender_country(frm) {
		frm.set_value("sender_state", "");
		frm.set_value("sender_city",  "");
		_clear("ca-dl-sender-state");
		_clear("ca-dl-sender-city");
		if (frm.doc.sender_country)
			_loadStates(frm.doc.sender_country, "sender");
	},

	sender_state(frm) {
		frm.set_value("sender_city", "");
		_clear("ca-dl-sender-city");
		_loadCities(frm.doc.sender_country, frm.doc.sender_state, "sender");
	},

	/* ── Recipient cascades ── */
	recipient_country(frm) {
		frm.set_value("recipient_state", "");
		frm.set_value("recipient_city",  "");
		_clear("ca-dl-recipient-state");
		_clear("ca-dl-recipient-city");
		if (frm.doc.recipient_country)
			_loadStates(frm.doc.recipient_country, "recipient");
	},

	recipient_state(frm) {
		frm.set_value("recipient_city", "");
		_clear("ca-dl-recipient-city");
		_loadCities(frm.doc.recipient_country, frm.doc.recipient_state, "recipient");
	},
});

/* ── Shipment Commodity child table ──────────────────────────────────────── */
frappe.ui.form.on("Shipment Commodity", {
	description(frm, cdt, cdn) {
		frappe.model.set_value(cdt, cdn, "hs_code", "");
		var row = locals[cdt][cdn];
		var desc = (row.description || "").trim();
		if (desc.length < 2) return;
		_fetch_hs_codes(frm, cdt, cdn, desc);
	},
	units(frm, cdt, cdn) {
		_set_row_amount(frm, cdt, cdn);
	},
	price(frm, cdt, cdn) {
		_set_row_amount(frm, cdt, cdn);
	}
});

/* ── HTS Code Lookup ─────────────────────────────────────────────────────── */
function _fetch_hs_codes(frm, cdt, cdn, keyword) {
	frappe.show_alert({ message: __("Looking up HTS codes…"), indicator: "blue" });
	frappe.call({
		method: "courier_app.api.shipment_api.search_hs_codes",
		args: { keyword: keyword },
		callback(r) {
			var items = r.message || [];
			if (!items.length) {
				frappe.show_alert({ message: __("No HTS codes found for this description"), indicator: "orange" });
				return;
			}
			_show_hs_dialog(frm, cdt, cdn, items);
		},
		error() {
			frappe.show_alert({ message: __("HTS code lookup failed"), indicator: "red" });
		}
	});
}

function _show_hs_dialog(frm, cdt, cdn, items) {
	var d = new frappe.ui.Dialog({
		title: __("Select HTS Code"),
		fields: [
			{
				fieldtype: "Data",
				fieldname: "search",
				label: __("Filter"),
				placeholder: __("Search by code or description…")
			},
			{
				fieldtype: "HTML",
				fieldname: "results"
			}
		]
	});

	function _render(filter) {
		var lf = (filter || "").toLowerCase().trim();
		var filtered = lf
			? items.filter(function(it) {
				return it.htsno.toLowerCase().indexOf(lf) !== -1
					|| it.description.toLowerCase().indexOf(lf) !== -1;
			})
			: items;

		var html;
		if (!filtered.length) {
			html = '<div class="ca-hs-dlg-empty">No matching HTS codes</div>';
		} else {
			html = filtered.map(function(it) {
				var duty = it.general && it.general.trim() ? it.general.trim() : null;
				var dutyHtml = duty
					? '<span class="ca-hs-dlg-duty ' + (duty.toLowerCase() === "free" ? "ca-hs-dlg-duty--free" : "ca-hs-dlg-duty--paid") + '">' + duty + '</span>'
					: '';
				var safeCode = (it.htsno || "").replace(/"/g, "&quot;");
				return '<div class="ca-hs-dlg-row" data-code="' + safeCode + '">'
					+ '<div class="ca-hs-dlg-top">'
					+   '<span class="ca-hs-dlg-code">' + it.htsno + '</span>'
					+   dutyHtml
					+ '</div>'
					+ '<div class="ca-hs-dlg-desc">' + it.description + '</div>'
					+ '</div>';
			}).join("");
		}

		var $list = $('<div class="ca-hs-dlg-list">' + html + '</div>');

		$list.find(".ca-hs-dlg-row").on("click", function() {
			var code = $(this).data("code");
			frappe.model.set_value(cdt, cdn, "hs_code", code);
			frm.refresh_field("commodities");
			frappe.show_alert({ message: __("HS Code set: ") + code, indicator: "green" });
			d.hide();
		});

		d.fields_dict.results.$wrapper.empty().append($list);
	}

	d.fields_dict.search.$input.on("input", function() {
		_render($(this).val());
	});

	d.show();
	_render("");

	setTimeout(function() {
		d.fields_dict.search.$input.focus();
	}, 150);
}

/* ── Commodity amount helpers ────────────────────────────────────────────── */
function _set_row_amount(frm, cdt, cdn) {
	var row = locals[cdt][cdn];
	row.amount = flt(row.units, 3) * flt(row.price, 2);
	frm.refresh_field("commodities");
	_update_commodity_total(frm);
}

function _recalc_all_commodities(frm) {
	(frm.doc.commodities || []).forEach(function(row) {
		row.amount = flt(row.units, 3) * flt(row.price, 2);
	});
	frm.refresh_field("commodities");
	_update_commodity_total(frm);
}

function _update_commodity_total(frm) {
	var total = 0;
	(frm.doc.commodities || []).forEach(function(row) {
		total += flt(row.amount);
	});
	frm.set_value("total_commodity_amount", flt(total, 2));
}

/* ── Grid button labels & commodities heading ────────────────────────────── */
function _customize_grid_buttons(frm) {
	var $pkg_grid = frm.fields_dict.packages && frm.fields_dict.packages.grid;
	if ($pkg_grid) {
		$pkg_grid.wrapper.find(".grid-add-row").html(
			'<svg width="12" height="12" viewBox="0 0 14 14" fill="none" style="margin-right:5px"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
			+ __("Add Package")
		);
	}

	var $comm_grid = frm.fields_dict.commodities && frm.fields_dict.commodities.grid;
	if ($comm_grid) {
		if (!$comm_grid.wrapper.prev(".ca-comm-heading").length) {
			$('<div class="ca-comm-heading">'
				+ '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:6px;vertical-align:middle"><rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 3V2a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.3"/></svg>'
				+ __("Commodities")
				+ '</div>'
			).insertBefore($comm_grid.wrapper);
		}
		$comm_grid.wrapper.find(".grid-add-row").html(
			'<svg width="12" height="12" viewBox="0 0 14 14" fill="none" style="margin-right:5px"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
			+ __("Add Item")
		);
	}
}

/* ── Dialog styles (injected once) ──────────────────────────────────────── */
function _inject_hs_styles() {
	_inject_airport_styles();
	if (document.getElementById("ca-hs-dlg-styles")) return;
	var style = document.createElement("style");
	style.id = "ca-hs-dlg-styles";
	style.textContent = [
		".ca-hs-dlg-list{max-height:380px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;margin-top:8px}",
		".ca-hs-dlg-row{padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-color);transition:background .15s}",
		".ca-hs-dlg-row:last-child{border-bottom:none}",
		".ca-hs-dlg-row:hover{background:var(--bg-blue)}",
		".ca-hs-dlg-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px}",
		".ca-hs-dlg-code{font-family:var(--font-stack-monospace,monospace);font-size:12.5px;font-weight:700;color:var(--heading-color);letter-spacing:.03em}",
		".ca-hs-dlg-desc{font-size:12px;color:var(--text-muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
		".ca-hs-dlg-duty{font-size:10px;font-weight:600;padding:1px 8px;border-radius:100px;flex-shrink:0}",
		".ca-hs-dlg-duty--free{background:#EBF5EF;color:#1B6B3A}",
		".ca-hs-dlg-duty--paid{background:#FAEEDA;color:#854F0B}",
		".ca-hs-dlg-empty{padding:24px;text-align:center;color:var(--text-muted);font-size:13px}",
		".ca-comm-heading{font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;padding:14px 0 6px;display:flex;align-items:center}"
	].join("");
	document.head.appendChild(style);
}

/* ── Datalist helpers ────────────────────────────────────────────────────── */
function _attach(frm, fieldname, listId) {
	const fd = frm.fields_dict[fieldname];
	if (!fd || !fd.$input) return;
	fd.$input.attr("list", listId).attr("autocomplete", "list");
}

function _clear(listId) {
	const dl = document.getElementById(listId);
	if (dl) dl.innerHTML = "";
}

function _fill(listId, items) {
	const dl = document.getElementById(listId);
	if (!dl) return;
	dl.innerHTML = items.map(v => `<option value="${v}">`).join("");
}

function _loadStates(country, which) {
	frappe.call({
		method: "courier_app.api.shipment_api.get_states",
		args:   { country },
		callback(r) { _fill(`ca-dl-${which}-state`, r.message || []); }
	});
}

function _loadCities(country, state, which) {
	if (!country) return;
	frappe.call({
		method: "courier_app.api.shipment_api.get_cities",
		args:   { country, state: state || null },
		callback(r) { _fill(`ca-dl-${which}-city`, r.message || []); }
	});
}

/* ── Status change & Airport modal ──────────────────────────────────────── */
function _handle_status_change(frm) {
	frappe.call({
		method: "courier_app.courier_app.doctype.courier_shipment.courier_shipment.get_status_location_option",
		args: { status: frm.doc.status },
		callback(r) {
			const loc_option = r.message;
			if (loc_option === "Airport") {
				_show_airport_modal(frm);
			} else {
				frm.set_value("selected_airport", "");
				frm._previous_status = frm.doc.status;
			}
		}
	});
}

var _airportsCache = null;

function _show_airport_modal(frm) {
	var existing = document.getElementById("ca-airport-backdrop");
	if (existing) existing.remove();

	const backdrop = document.createElement("div");
	backdrop.id = "ca-airport-backdrop";
	backdrop.className = "ca-ap-backdrop";

	const modal = document.createElement("div");
	modal.className = "ca-ap-modal";
	modal.innerHTML =
		'<div class="ca-ap-header">' +
			'<div class="ca-ap-title">' +
				'<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 15h14M4 12l3.5-6 2.5 2.5 5-3.5 1.2 1.2L12 12z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
				' Select Airport' +
			'</div>' +
			'<button class="ca-ap-close">&times;</button>' +
		'</div>' +
		'<div class="ca-ap-search-wrap">' +
			'<svg class="ca-ap-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
			'<input type="text" class="ca-ap-search" placeholder="Search by name, code, city or country..." autocomplete="off">' +
		'</div>' +
		'<div class="ca-ap-list">' +
			'<div class="ca-ap-loading"><div class="ca-spinner-sm"></div> Loading airports...</div>' +
		'</div>' +
		'<div class="ca-ap-add-row">' +
			'<button class="ca-ap-add-btn">' +
				'<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
				' Add New Airport' +
			'</button>' +
		'</div>';

	backdrop.appendChild(modal);
	document.body.appendChild(backdrop);
	requestAnimationFrame(() => backdrop.classList.add("ca-ap-visible"));

	const searchInput = modal.querySelector(".ca-ap-search");
	const listEl = modal.querySelector(".ca-ap-list");

	function onCancel() {
		frm.set_value("status", frm._previous_status);
		frm.set_value("selected_airport", "");
		_removeAirportModal();
	}

	function onSelect(airportName) {
		frm.set_value("selected_airport", airportName);
		frm._previous_status = frm.doc.status;
		_removeAirportModal();
	}

	modal.querySelector(".ca-ap-close").addEventListener("click", onCancel);
	backdrop.addEventListener("click", (e) => { if (e.target === backdrop) onCancel(); });

	const keyHandler = (e) => { if (e.key === "Escape") { onCancel(); document.removeEventListener("keydown", keyHandler); } };
	document.addEventListener("keydown", keyHandler);

	modal.querySelector(".ca-ap-add-btn").addEventListener("click", () => {
		_showAddAirportDialog(() => {
			_airportsCache = null;
			_loadAndRender(listEl, searchInput.value, onSelect);
		});
	});

	_loadAndRender(listEl, "", onSelect);
	searchInput.addEventListener("input", () => _renderAirportItems(listEl, searchInput.value, onSelect));
	setTimeout(() => searchInput.focus(), 100);
}

function _loadAndRender(listEl, filter, onSelect) {
	if (_airportsCache) { _renderAirportItems(listEl, filter, onSelect); return; }
	frappe.call({
		method: "courier_app.api.location_api.list_airports",
		callback(r) {
			_airportsCache = r.message || [];
			_renderAirportItems(listEl, filter, onSelect);
		},
		error() {
			listEl.innerHTML = '<div class="ca-ap-empty">Failed to load airports</div>';
		}
	});
}

function _renderAirportItems(listEl, filter, onSelect) {
	const airports = _airportsCache || [];
	const lf = (filter || "").toLowerCase().trim();
	const filtered = lf
		? airports.filter(a =>
			(a.airport_name || "").toLowerCase().includes(lf) ||
			(a.iata_code || "").toLowerCase().includes(lf) ||
			(a.city || "").toLowerCase().includes(lf) ||
			(a.country || "").toLowerCase().includes(lf))
		: airports;

	if (!filtered.length) {
		listEl.innerHTML =
			'<div class="ca-ap-empty">' +
			'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="opacity:.4"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
			'<span>' + (lf ? 'No airports matching "' + frappe.utils.escape_html(lf) + '"' : 'No airports added yet') + '</span></div>';
		return;
	}

	listEl.innerHTML = filtered.map(a => {
		const sub = [a.city, a.country].filter(Boolean).join(", ");
		return '<div class="ca-ap-item" data-name="' + (a.name || "").replace(/"/g, '&quot;') + '">' +
			'<div class="ca-ap-item-main">' +
				'<div class="ca-ap-item-name">' + frappe.utils.escape_html(a.airport_name) + '</div>' +
				(sub ? '<div class="ca-ap-item-sub">' + frappe.utils.escape_html(sub) + '</div>' : '') +
			'</div>' +
			(a.iata_code ? '<div class="ca-ap-item-code">' + frappe.utils.escape_html(a.iata_code) + '</div>' : '') +
		'</div>';
	}).join("");

	listEl.querySelectorAll(".ca-ap-item").forEach(el => {
		el.addEventListener("click", function() { onSelect(this.dataset.name); });
	});
}

function _removeAirportModal() {
	const el = document.getElementById("ca-airport-backdrop");
	if (el) el.remove();
}

function _showAddAirportDialog(onCreated) {
	const existing = document.getElementById("ca-add-airport-backdrop");
	if (existing) existing.remove();

	const backdrop = document.createElement("div");
	backdrop.id = "ca-add-airport-backdrop";
	backdrop.className = "ca-ap-backdrop ca-ap-backdrop--nested";

	const modal = document.createElement("div");
	modal.className = "ca-ap-modal ca-ap-modal--add";
	modal.innerHTML =
		'<div class="ca-ap-header">' +
			'<div class="ca-ap-title">' +
				'<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
				' New Airport' +
			'</div>' +
			'<button class="ca-ap-close">&times;</button>' +
		'</div>' +
		'<div class="ca-ap-form">' +
			'<div class="ca-ap-field">' +
				'<label class="ca-ap-label">Airport Name <span class="ca-ap-req">*</span></label>' +
				'<input type="text" class="ca-ap-input ca-add-ap-name" placeholder="e.g. Jinnah International Airport">' +
			'</div>' +
			'<div class="ca-ap-field-row">' +
				'<div class="ca-ap-field">' +
					'<label class="ca-ap-label">IATA Code</label>' +
					'<input type="text" class="ca-ap-input ca-add-ap-iata" placeholder="e.g. KHI" maxlength="3" style="text-transform:uppercase">' +
				'</div>' +
				'<div class="ca-ap-field">' +
					'<label class="ca-ap-label">City</label>' +
					'<input type="text" class="ca-ap-input ca-add-ap-city" placeholder="e.g. Karachi">' +
				'</div>' +
			'</div>' +
			'<div class="ca-ap-field">' +
				'<label class="ca-ap-label">Country</label>' +
				'<input type="text" class="ca-ap-input ca-add-ap-country" placeholder="e.g. Pakistan">' +
			'</div>' +
			'<div class="ca-ap-form-actions">' +
				'<button class="ca-ap-btn-cancel">Cancel</button>' +
				'<button class="ca-ap-btn-create">' +
					'<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
					' Create Airport' +
				'</button>' +
			'</div>' +
		'</div>';

	backdrop.appendChild(modal);
	document.body.appendChild(backdrop);
	requestAnimationFrame(() => backdrop.classList.add("ca-ap-visible"));

	function closeAdd() {
		backdrop.remove();
	}

	modal.querySelector(".ca-ap-close").addEventListener("click", closeAdd);
	modal.querySelector(".ca-ap-btn-cancel").addEventListener("click", closeAdd);
	backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeAdd(); });

	var nameInput = modal.querySelector(".ca-add-ap-name");
	var createBtn = modal.querySelector(".ca-ap-btn-create");

	createBtn.addEventListener("click", () => {
		const name = (nameInput.value || "").trim();
		const iata = (modal.querySelector(".ca-add-ap-iata").value || "").trim().toUpperCase();
		const city = (modal.querySelector(".ca-add-ap-city").value || "").trim();
		const country = (modal.querySelector(".ca-add-ap-country").value || "").trim();

		if (!name) {
			nameInput.focus(); nameInput.style.borderColor = "#dc2626";
			return;
		}

		createBtn.disabled = true;
		createBtn.innerHTML = '<div class="ca-spinner-sm"></div> Creating...';

		frappe.call({
			method: "courier_app.api.location_api.add_airport",
			args: { airport_name: name, iata_code: iata, city: city, country: country },
			callback() {
				frappe.show_alert({ message: __("Airport created: {0}", [name]), indicator: "green" });
				closeAdd();
				if (onCreated) onCreated();
			},
			error() {
				createBtn.disabled = false;
				createBtn.innerHTML = 'Create Airport';
			}
		});
	});

	setTimeout(() => nameInput.focus(), 100);
}

/* ── Airport modal styles (injected once) ──────────────────────────────── */
function _inject_airport_styles() {
	if (document.getElementById("ca-airport-modal-css")) return;
	var s = document.createElement("style");
	s.id = "ca-airport-modal-css";
	s.textContent = [
		".ca-ap-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease}",
		".ca-ap-backdrop.ca-ap-visible{opacity:1}",
		".ca-ap-backdrop--nested{z-index:10001}",
		".ca-ap-modal{background:#fff;border-radius:14px;width:460px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.18),0 4px 16px rgba(0,0,0,.08);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.22,1,.36,1);overflow:hidden}",
		".ca-ap-visible .ca-ap-modal{transform:translateY(0) scale(1)}",
		".ca-ap-modal--add{width:420px}",
		".ca-ap-header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 14px;border-bottom:1px solid #e5e7eb}",
		".ca-ap-title{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;color:#1a1d23;letter-spacing:-.02em}",
		".ca-ap-close{background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;transition:color .15s,background .15s}",
		".ca-ap-close:hover{color:#1a1d23;background:#f3f4f6}",
		".ca-ap-search-wrap{display:flex;align-items:center;gap:8px;padding:8px 16px;margin:12px 16px 0;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:10px;transition:border-color .15s,box-shadow .15s}",
		".ca-ap-search-wrap:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}",
		".ca-ap-search-icon{flex-shrink:0;color:#9ca3af}",
		".ca-ap-search-wrap:focus-within .ca-ap-search-icon{color:#2563eb}",
		".ca-ap-search{flex:1;border:none;background:none;font-size:13.5px;color:#1a1d23;outline:none;font-family:inherit;min-width:0}",
		".ca-ap-search::placeholder{color:#9ca3af}",
		".ca-ap-list{flex:1;overflow-y:auto;padding:8px 0;min-height:120px;max-height:380px}",
		".ca-ap-list::-webkit-scrollbar{width:5px}",
		".ca-ap-list::-webkit-scrollbar-track{background:transparent}",
		".ca-ap-list::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}",
		".ca-ap-item{display:flex;align-items:center;gap:12px;padding:10px 22px;cursor:pointer;transition:background .12s}",
		".ca-ap-item:hover{background:#eff6ff}",
		".ca-ap-item-main{flex:1;min-width:0}",
		".ca-ap-item-name{font-size:13.5px;font-weight:500;color:#1a1d23;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
		".ca-ap-item-sub{font-size:11.5px;color:#6b7280;margin-top:1px}",
		".ca-ap-item-code{flex-shrink:0;font-size:11px;font-weight:700;font-family:'DM Mono',monospace;letter-spacing:.06em;padding:3px 10px;border-radius:6px;background:#e0e7ff;color:#3730a3}",
		".ca-ap-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;color:#9ca3af;font-size:13px}",
		".ca-ap-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:32px 16px;color:#6b7280;font-size:13px}",
		".ca-ap-add-row{padding:10px 16px 14px;border-top:1px solid #e5e7eb}",
		".ca-ap-add-btn{display:flex;align-items:center;gap:6px;width:100%;padding:10px 16px;background:#f0f9ff;border:1.5px dashed #93c5fd;border-radius:10px;color:#2563eb;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s}",
		".ca-ap-add-btn:hover{background:#dbeafe;border-color:#60a5fa}",
		".ca-ap-form{padding:20px 22px}",
		".ca-ap-field{margin-bottom:14px}",
		".ca-ap-field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
		".ca-ap-label{display:block;font-size:12px;font-weight:500;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px}",
		".ca-ap-req{color:#dc2626}",
		".ca-ap-input{width:100%;height:38px;padding:0 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13.5px;font-family:inherit;color:#1a1d23;outline:none;transition:border-color .15s;box-sizing:border-box}",
		".ca-ap-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}",
		".ca-ap-form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}",
		".ca-ap-btn-cancel{padding:8px 18px;border-radius:8px;border:1.5px solid #e5e7eb;background:#fff;color:#6b7280;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,color .15s}",
		".ca-ap-btn-cancel:hover{background:#f3f4f6;color:#1a1d23}",
		".ca-ap-btn-create{display:flex;align-items:center;gap:6px;padding:8px 20px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s}",
		".ca-ap-btn-create:hover{background:#1d4ed8}",
		".ca-ap-btn-create:disabled{opacity:.5;cursor:not-allowed}",
		".ca-ap-modal .ca-spinner-sm{display:inline-block;width:14px;height:14px;border:2px solid rgba(0,0,0,.12);border-top-color:#2563eb;border-radius:50%;animation:ca-ap-spin .6s linear infinite;flex-shrink:0}",
		"@keyframes ca-ap-spin{to{transform:rotate(360deg)}}",
	].join("\n");
	document.head.appendChild(s);
}

/* ── Barcode popup ───────────────────────────────────────────────────────── */
function _show_barcode_popup(frm) {
	frappe.call({
		method: "courier_app.api.barcode_api.get_shipment_barcode",
		args:   { name: frm.doc.name },
		callback(r) {
			const svg = r.message || "";
			if (!svg) {
				frappe.show_alert({ message: __("Barcode generation failed"), indicator: "red" });
				return;
			}

			const html = `
				<div id="ca-bc-popup" style="text-align:center;padding:16px 8px;">
					<div style="display:inline-block;border:1px solid #e0e0e0;border-radius:6px;padding:16px 24px;background:#fff;">
						${svg}
					</div>
				</div>`;

			const d = new frappe.ui.Dialog({
				title: __("Shipment Barcode — {0}", [frm.doc.name]),
				fields: [{ fieldtype: "HTML", fieldname: "barcode_html" }],
				primary_action_label: __("Print"),
				primary_action() {
					const win = window.open("", "_blank", "width=500,height=400");
					win.document.write(`<!DOCTYPE html><html><head><title>Barcode ${frappe.utils.escape_html(frm.doc.name)}</title>
						<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif;background:#fff}
						.bc-wrap{text-align:center;padding:24px}.bc-id{margin-top:10px;font-size:13px;color:#333;font-family:monospace}
						@media print{body{align-items:flex-start;padding-top:20px}}</style></head>
						<body><div class="bc-wrap">${svg}<div class="bc-id">${frappe.utils.escape_html(frm.doc.name)}</div></div>
						<script>window.onload=function(){window.print()}<\/script></body></html>`);
					win.document.close();
				}
			});

			d.fields_dict.barcode_html.$wrapper.html(html);
			d.show();
		},
		error() {
			frappe.show_alert({ message: __("Could not generate barcode"), indicator: "red" });
		}
	});
}
