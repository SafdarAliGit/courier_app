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
	},

	refresh(frm) {
		// Wire datalists to input fields
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

		// Barcode button (only for saved documents)
		if (!frm.is_new()) {
			frm.add_custom_button(__("Print Barcode"), () => _show_barcode_popup(frm), __("Print"));
		}
	},

	validate(frm) {
		_recalc_all_commodities(frm);
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
