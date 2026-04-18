/* Shipment DocType form JS */
frappe.ui.form.on("Shipment", {

	refresh(frm) {
		frm.page.set_indicator(frm.doc.status, {
			"Draft":            "gray",
			"Pending":          "yellow",
			"Booked":           "blue",
			"In Transit":       "purple",
			"Out for Delivery": "orange",
			"Delivered":        "green",
			"Cancelled":        "red",
		}[frm.doc.status] || "gray");

		if (!frm.is_new()) {
			frm.add_custom_button(__("Update Status"), () => {
				const d = new frappe.ui.Dialog({
					title: "Update Shipment Status",
					fields: [{
						fieldtype: "Select",
						fieldname: "new_status",
						label: "New Status",
						options: ["Pending","Booked","In Transit","Out for Delivery","Delivered","Cancelled"].join("\n"),
						default: frm.doc.status,
					}],
					primary_action_label: "Update",
					primary_action(vals) {
						frappe.call({
							method: "courier_app.api.shipment_api.update_status",
							args: { shipment_id: frm.doc.name, new_status: vals.new_status },
							callback: () => { frm.reload_doc(); d.hide(); }
						});
					}
				});
				d.show();
			});

			frm.add_custom_button(__("Track on Portal"), () => {
				if (frm.doc.tracking_number) {
					window.open(`/shipment?track=1#${frm.doc.tracking_number}`, "_blank");
				} else {
					frappe.msgprint("No tracking number assigned yet.");
				}
			});

			if (frm.doc.submitted_by_portal) {
				frm.dashboard.add_comment(
					`<i class="fa fa-globe" style="color:#0F6E56"></i> This shipment was submitted via the customer portal.`,
					"blue", true
				);
			}
		}
	},

	recipient_country(frm) {
		frm.trigger("calc_rate");
	},

	packages_on_form_rendered(frm) {
		frm.trigger("calc_rate");
	},

	calc_rate(frm) {
		const country = frm.doc.recipient_country;
		const packages = frm.doc.packages || [];
		const weight = packages.reduce((sum, p) => {
			const w = p.weight || 0;
			return sum + (p.weight_unit === "lb" ? w * 0.453592 : w);
		}, 0);

		if (!country || weight <= 0) return;

		frappe.call({
			method: "courier_app.api.shipment_api.get_live_rate",
			args: { country, weight: weight.toFixed(3) },
			callback: r => {
				const d = r.message || {};
				if (d.rate && !d.error) {
					frm.set_value("calculated_rate", d.rate);
					frm.set_value("total_weight", +weight.toFixed(3));
					frm.dashboard.add_comment(
						`Rate calculated: PKR ${Math.round(d.rate).toLocaleString()} (Zone ${d.express_saver_code || "—"})`,
						"green", true
					);
				}
			}
		});
	},
});

/* Recompute rate on package weight changes */
frappe.ui.form.on("Shipment Package", {
	weight(frm) { frm.trigger("calc_rate"); },
	weight_unit(frm) { frm.trigger("calc_rate"); },
	packages_remove(frm) { frm.trigger("calc_rate"); },
});
