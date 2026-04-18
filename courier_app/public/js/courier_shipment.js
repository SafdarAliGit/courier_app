/* ── Courier Shipment — Desk Form JS ────────────────────────────────────────
   Adds cascading country → state → city autocomplete for sender & recipient.
   Uses HTML5 <datalist> so existing Data fields work without schema changes.
──────────────────────────────────────────────────────────────────────────── */

frappe.ui.form.on("Courier Shipment", {

    setup(frm) {
        // Create shared datalist elements once per page load
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

        // Pre-load suggestions if country/state already set (e.g. saved doc)
        if (frm.doc.sender_country)
            _loadStates(frm.doc.sender_country, "sender");
        if (frm.doc.recipient_country)
            _loadStates(frm.doc.recipient_country, "recipient");
        if (frm.doc.sender_country && frm.doc.sender_state)
            _loadCities(frm.doc.sender_country, frm.doc.sender_state, "sender");
        if (frm.doc.recipient_country && frm.doc.recipient_state)
            _loadCities(frm.doc.recipient_country, frm.doc.recipient_state, "recipient");
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

/* ── Helpers ── */

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
