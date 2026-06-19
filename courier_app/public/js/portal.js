"use strict";
/* ── CourierApp Portal JS ─────────────────────────────────────────────────── */

const CA = {
  packages: [{ id: 1, weight: "", unit: "kg", l: "", w: "", h: "", desc: "", actual_weight: "", amount: "" }],
  nextPkgId: 2,
  commodities: [{ id: 1, units: "", uom: "Kg", weight: "", wt_unit: "kgs", desc: "", hs_code: "", price: "", amount: "" }],
  nextCommodityId: 2,
  rateDebounce: null,
  countries: [],
  _comboSenderCountry:    null,
  _comboRecipientCountry: null,
  _comboSenderCity:       null,
  _comboRecipientCity:    null,
  _hsItems: {},
  _savedShipmentId: null,

  /* ── INIT ─────────────────────────────────────────────────────────────── */
  init() {
    this._initErrorHandling();   // ← must be first so all subsequent calls are covered
    this.setDefaults();
    this._initCountryCity();
    this._initServiceProvider();
    this._initServiceRadio();
    this.bindTabs();
    this.bindPackages();
    this.bindCommodities();
    this.bindSubmit();
    this.bindReset();
    this.bindModal();
    this.bindInvoiceButtons();
    this.renderPackages();
    this.renderCommodities();
    this.bindTrack();
    this.bindPartyNameCheck();
    this._initCustomerSelect();
  },

  setDefaults() {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("f-ship-date").value = today;
    document.getElementById("summary-ship-date").textContent = this.formatDate(today);
    document.getElementById("f-ship-date").addEventListener("change", e => {
      document.getElementById("summary-ship-date").textContent = this.formatDate(e.target.value);
      this.updateDeliveryEst();
    });
    this.updateDeliveryEst();
  },

  updateDeliveryEst() {
    const service = document.getElementById("f-service").value;
    const shipDate = document.getElementById("f-ship-date").value;
    if (!shipDate) return;
    const days = { "Express Plus": 1, "Express": 2, "Express Saver": 3, "Ground": 5, "Ground Economy": 7 };
    const d = days[service];
    if (!d) { document.getElementById("summary-delivery").textContent = "—"; return; }
    const date = new Date(shipDate);
    date.setDate(date.getDate() + d);
    document.getElementById("summary-delivery").textContent = this.formatDate(date.toISOString().split("T")[0]);
    const rateServiceEl = document.getElementById("rate-service");
    if (rateServiceEl) rateServiceEl.textContent = service || "—";
  },

  formatDate(str) {
    if (!str) return "—";
    const d = new Date(str + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  },

  /* ── SERVICE SELECT ───────────────────────────────────────────────────── */
  _initServiceRadio() {
    document.getElementById("f-service").addEventListener("change", () => {
      this.updateDeliveryEst();
      this.scheduleRateCalc();
    });

    // Billing radio groups → hidden inputs
    document.querySelectorAll('input[name="ca-bill-transport"]').forEach(r => {
      r.addEventListener("change", e => {
        document.getElementById("f-bill-transport").value = e.target.value;
      });
    });
    document.querySelectorAll('input[name="ca-bill-duties"]').forEach(r => {
      r.addEventListener("change", e => {
        document.getElementById("f-bill-duties").value = e.target.value;
      });
    });

    // Packaging type select
    document.getElementById("f-packaging").addEventListener("change", () => {
      this.scheduleRateCalc();
    });
  },

  /* ── SERVICE PROVIDER ────────────────────────────────────────────────── */
  _initServiceProvider() {
    frappe.call({
      method: "courier_app.api.shipment_api.get_service_providers",
      callback: r => {
        const providers = r.message || [];
        const sel = document.getElementById("f-service-provider");
        if (!sel) return;

        if (providers.length) {
          sel.innerHTML = '<option value="" disabled selected>— Select service provider —</option>' +
            providers.map(p =>
              `<option value="${p.name}">${p.provider_name || p.name}${p.provider_code ? " (" + p.provider_code + ")" : ""}</option>`
            ).join("");

          // Auto-select if only one provider
          if (providers.length === 1) {
            sel.value = providers[0].name;
            this._loadRecipientCountries(providers[0].name);
          }
        }

        sel.addEventListener("change", () => {
          this._loadRecipientCountries(sel.value);
          if (!this.packages.some(p => parseFloat(p.weight) > 0)) {
            this._clearPackages();
          }
          this.scheduleRateCalc();
        });
      }
    });
  },

  /* ── SEARCHABLE COMBO ─────────────────────────────────────────────────── */
  _makeCombo(wrapId, items, onSelect, cfg = {}) {
    const wrap  = document.getElementById(wrapId);
    if (!wrap) return null;
    const txtEl  = wrap.querySelector(".ca-combo-input");
    const dropEl = wrap.querySelector(".ca-combo-drop");
    const hidEl  = cfg.hiddenId ? document.getElementById(cfg.hiddenId) : null;

    let _items    = items.slice();
    let _selValue = "";

    const _filter = q => {
      const lq = q.toLowerCase().trim();
      if (!lq) return _items.slice(0, 80);
      const starts   = _items.filter(it => it.label.toLowerCase().startsWith(lq));
      const contains = _items.filter(it => !it.label.toLowerCase().startsWith(lq) && it.label.toLowerCase().includes(lq));
      return [...starts, ...contains].slice(0, 80);
    };

    const _render = filtered => {
      if (!filtered.length) {
        dropEl.innerHTML = '<div class="ca-combo-empty">No results</div>';
        return;
      }
      dropEl.innerHTML = filtered.map(it =>
        `<div class="ca-combo-opt" data-val="${it.value.replace(/"/g,'&quot;')}">${it.label}</div>`
      ).join("");
      dropEl.querySelectorAll(".ca-combo-opt").forEach(opt => {
        opt.addEventListener("mousedown", e => {
          e.preventDefault();
          _select(opt.dataset.val, opt.textContent);
        });
      });
    };

    const _openDrop = () => {
      _render(_filter(txtEl.value));
      dropEl.classList.add("open");
    };
    const _closeDrop = () => dropEl.classList.remove("open");

    const _select = (value, label) => {
      _selValue = value;
      txtEl.value = label;
      if (hidEl) hidEl.value = value;
      txtEl.classList.remove("ca-input-error");
      _closeDrop();
      if (onSelect) onSelect(value, label);
    };

    txtEl.addEventListener("focus", () => _openDrop());
    txtEl.addEventListener("input", () => {
      _selValue = "";
      if (hidEl) hidEl.value = "";
      _render(_filter(txtEl.value));
      dropEl.classList.add("open");
      if (onSelect) onSelect("", "");
    });
    txtEl.addEventListener("blur", () => {
      setTimeout(() => {
        _closeDrop();
        if (!cfg.allowFreeText) {
          if (!_selValue) {
            const exact = _items.find(it => it.label.toLowerCase() === txtEl.value.trim().toLowerCase());
            if (exact) _select(exact.value, exact.label);
            else { txtEl.value = ""; if (hidEl) hidEl.value = ""; }
          }
        } else {
          if (!_selValue && txtEl.value.trim()) {
            _selValue = txtEl.value.trim();
            if (hidEl) hidEl.value = _selValue;
          }
        }
      }, 160);
    });

    txtEl.addEventListener("keydown", e => {
      const opts = Array.from(dropEl.querySelectorAll(".ca-combo-opt"));
      const cur  = dropEl.querySelector(".ca-combo-opt.highlighted");
      let idx    = opts.indexOf(cur);
      if (e.key === "ArrowDown")  { e.preventDefault(); idx = Math.min(idx + 1, opts.length - 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); }
      else if (e.key === "Enter" && cur) { e.preventDefault(); _select(cur.dataset.val, cur.textContent); return; }
      else if (e.key === "Escape") { _closeDrop(); return; }
      else return;
      opts.forEach(o => o.classList.remove("highlighted"));
      if (opts[idx]) { opts[idx].classList.add("highlighted"); opts[idx].scrollIntoView({ block: "nearest" }); }
    });

    return {
      select: _select,
      // Synchronously resolve typed text to a matched item — called before form
      // validation so a country typed but not yet clicked counts as selected.
      flush() {
        if (!_selValue && !cfg.allowFreeText) {
          const exact = _items.find(it => it.label.toLowerCase() === txtEl.value.trim().toLowerCase());
          if (exact) _select(exact.value, exact.label);
        }
      },
      setItems(newItems) {
        _items    = newItems.slice();
        _selValue = "";
        txtEl.value = "";
        if (hidEl) hidEl.value = "";
        _closeDrop();
      },
      reset() {
        _selValue = "";
        txtEl.value = "";
        if (hidEl) hidEl.value = "";
        _closeDrop();
      },
      getValue: () => cfg.allowFreeText ? (txtEl.value.trim() || _selValue) : _selValue,
    };
  },

  /* ── STATE SELECT HELPER ──────────────────────────────────────────────── */
  _populateStateSelect(selectId, states, cityCombo, country) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    if (!states || !states.length) {
      sel.innerHTML = '<option value="">— No states available —</option>';
      sel.disabled = true;
      // Load cities at country level directly
      if (cityCombo) this._loadCitiesForCountry(country, null, cityCombo);
      return;
    }

    sel.disabled = false;
    sel.innerHTML = '<option value="">— Select state / province —</option>' +
      states.map(s => `<option value="${s.replace(/"/g,'&quot;')}">${s}</option>`).join("");

    // Reset city when state changes
    sel.onchange = () => {
      const state = sel.value;
      if (cityCombo) cityCombo.setItems([]);
      if (state) {
        this._loadCitiesForState(country, state, cityCombo);
      } else {
        this._loadCitiesForCountry(country, null, cityCombo);
      }
    };
  },

  _loadCitiesForCountry(country, state, cityCombo) {
    if (!country || !cityCombo) { if (cityCombo) cityCombo.setItems([]); return; }
    frappe.call({
      method: "courier_app.api.shipment_api.get_cities",
      args: { country, state: state || "" },
      callback: r2 => {
        const cities = (r2.message || []).map(c => ({ value: c, label: c }));
        cityCombo.setItems(cities);
      }
    });
  },

  _loadCitiesForState(country, state, cityCombo) {
    if (!country || !state || !cityCombo) { if (cityCombo) cityCombo.setItems([]); return; }
    frappe.call({
      method: "courier_app.api.shipment_api.get_cities",
      args: { country, state },
      callback: r2 => {
        const cities = (r2.message || []).map(c => ({ value: c, label: c }));
        cityCombo.setItems(cities);
      }
    });
  },

  /* ── COUNTRY + STATE + CITY INIT ──────────────────────────────────────── */
  _initCountryCity() {
    // Sender uses standard Frappe countries; recipient uses App Defaults (Country Zone)
    const _buildCombos = (senderCountries, recipientCountries) => {
      const _onCountrySelect = (which, val, label) => {
        const stateSelId  = `f-${which}-state`;
        const cityCombo   = which === "sender" ? this._comboSenderCity : this._comboRecipientCity;
        const stateEl     = document.getElementById(stateSelId);

        // Reset state & city
        if (stateEl) { stateEl.innerHTML = '<option value="">— Loading… —</option>'; stateEl.disabled = true; }
        if (cityCombo) cityCombo.setItems([]);

        if (!val) return;

        if (which === "sender" && !this.packages.some(p => parseFloat(p.weight) > 0)) {
          this._clearPackages();
        }

        if (which === "recipient") {
          document.getElementById("rate-country").textContent = label || "—";
          this.scheduleRateCalc();
        }

        // Load states
        frappe.call({
          method: "courier_app.api.shipment_api.get_states",
          args: { country: val },
          callback: rs => {
            const states = rs.message || [];
            this._populateStateSelect(stateSelId, states, cityCombo, val);
          }
        });
      };

      this._comboSenderCountry = this._makeCombo(
        "ca-combo-sender-country", senderCountries,
        (val, label) => _onCountrySelect("sender", val, label),
        { hiddenId: "f-sender-country" }
      );
      this._comboRecipientCountry = this._makeCombo(
        "ca-combo-recipient-country", recipientCountries,
        (val, label) => _onCountrySelect("recipient", val, label),
        { hiddenId: "f-recipient-country" }
      );
      const _zipAutoFill = (which) => (val) => {
        if (!val) return;
        const zipEl = document.getElementById(`f-${which}-zip`);
        if (!zipEl) return;
        frappe.call({
          method: "courier_app.api.location_api.get_city_postal_code",
          args: {
            city_name: val,
            country: document.getElementById(`f-${which}-country`)?.value || "",
            state:   document.getElementById(`f-${which}-state`)?.value || "",
          },
          callback: r => { if (zipEl) zipEl.value = r.message || ""; }
        });
      };
      this._comboSenderCity = this._makeCombo(
        "ca-combo-sender-city", [], _zipAutoFill("sender"), { allowFreeText: true }
      );
      this._comboRecipientCity = this._makeCombo(
        "ca-combo-recipient-city", [], _zipAutoFill("recipient"), { allowFreeText: true }
      );
      // Preselect Pakistan as default sender country — must be after city combos
      // are created so _onCountrySelect captures a valid this._comboSenderCity ref.
      this._comboSenderCountry.select("Pakistan", "Pakistan");
      // If the user typed a country before the list finished loading, resolve it now
      this._comboSenderCountry.flush();
      this._comboRecipientCountry.flush();
    };

    // Disable submit until country lists are ready — prevents the race where
    // the user clicks before the combo items have loaded and validation fails.
    const submitBtn = document.getElementById("btn-submit-shipment");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.loadingCountries = "1"; }

    // Load sender countries; recipient countries load after service provider is selected
    frappe.call({
      method: "courier_app.api.shipment_api.get_countries_all",
      callback: r => {
        const senderCountries = (r.message || []).map(c => ({ value: c.name, label: c.country_name }));
        _buildCombos(senderCountries, []);
        if (submitBtn && submitBtn.dataset.loadingCountries) {
          submitBtn.disabled = false;
          delete submitBtn.dataset.loadingCountries;
        }
        // Show hint below recipient country on first keystroke if no provider selected
        const recipCombo = document.querySelector("#ca-combo-recipient-country");
        if (recipCombo) {
          const hint = document.createElement("div");
          hint.id = "recipient-country-hint";
          hint.style.cssText = "display:none;font-size:11px;color:#dc2626;margin-top:4px;white-space:nowrap";
          hint.textContent = "Please Select Service Provider First";
          recipCombo.insertAdjacentElement("afterend", hint);
          const recipTxt = recipCombo.querySelector(".ca-combo-input");
          if (recipTxt) {
            recipTxt.addEventListener("input", () => {
              if (recipTxt.value && !document.getElementById("f-service-provider")?.value) {
                hint.style.display = "block";
              } else {
                hint.style.display = "none";
              }
            });
          }
        }
      }
    });
  },

  _loadRecipientCountries(provider) {
    if (!this._comboRecipientCountry) return;
    if (!provider) { this._comboRecipientCountry.setItems([]); return; }
    frappe.call({
      method: "courier_app.api.shipment_api.get_countries",
      args: { service_provider: provider },
      callback: r => {
        const msg = r.message;
        const items = Array.isArray(msg) ? msg.map(c => ({ value: c.name, label: c.country_name })) : [];
        if (this._comboRecipientCountry) this._comboRecipientCountry.setItems(items);
        const hint = document.getElementById("recipient-country-hint");
        if (hint) hint.remove();
      }
    });
  },

  /* ── TABS ─────────────────────────────────────────────────────────────── */
  _TYPE_CONFIG: {
    Outbound: {
      subtitle:           "Fill in the details below to book your courier shipment",
      senderTitle:        "Sender details",
      recipientTitle:     "Recipient details",
      senderPlaceholder:  "Your name",
      recipientPlaceholder: "Jane Doe",
      bannerFrom:   "You",
      bannerArrow:  "→",
      bannerTo:     "Customer",
      bannerCls:    "ca-type-banner--outbound",
      billTransport: "My Account",
      billDuties:    "Recipient",
      returnLabel:   false,
    },
    Inbound: {
      subtitle:           "Book an incoming shipment arriving at your location",
      senderTitle:        "From (External party)",
      recipientTitle:     "To (Your address)",
      senderPlaceholder:  "Supplier / sender name",
      recipientPlaceholder: "Your name",
      bannerFrom:   "You",
      bannerArrow:  "←",
      bannerTo:     "External",
      bannerCls:    "ca-type-banner--inbound",
      billTransport: "My Account",
      billDuties:    "Sender",
      returnLabel:   false,
    },
    Return: {
      subtitle:           "Create a return shipment from customer back to your warehouse",
      senderTitle:        "From (Customer / return origin)",
      recipientTitle:     "To (Your return address)",
      senderPlaceholder:  "Customer name",
      recipientPlaceholder: "Your warehouse / receiving",
      bannerFrom:   "Customer",
      bannerArrow:  "↩",
      bannerTo:     "You",
      bannerCls:    "ca-type-banner--return",
      billTransport: "My Account",
      billDuties:    "Sender",
      returnLabel:   true,
    },
  },

  bindTabs() {
    document.querySelectorAll(".ca-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".ca-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const type = btn.dataset.type;
        document.getElementById("f-shipment-type").value = type;
        this._applyShipmentType(type);
      });
    });

    // Swap addresses button
    const swapBtn = document.getElementById("btn-swap-addresses");
    if (swapBtn) swapBtn.addEventListener("click", () => this._swapAddresses());
  },

  _applyShipmentType(type) {
    const cfg = this._TYPE_CONFIG[type];
    if (!cfg) return;

    // Subtitle
    const sub = document.getElementById("form-subtitle");
    if (sub) sub.textContent = cfg.subtitle;

    // Section headings
    const sh2 = document.getElementById("section-sender-title");
    const sh3 = document.getElementById("section-recipient-title");
    if (sh2) sh2.textContent = cfg.senderTitle;
    if (sh3) sh3.textContent = cfg.recipientTitle;

    // Name placeholders
    const sn = document.getElementById("f-sender-name");
    const rn = document.getElementById("f-recipient-name");
    if (sn) sn.placeholder = cfg.senderPlaceholder;
    if (rn) rn.placeholder = cfg.recipientPlaceholder;

    // Direction banner
    const banner = document.getElementById("type-direction-banner");
    if (banner) {
      banner.className = "ca-type-banner " + cfg.bannerCls;
      document.getElementById("banner-from").textContent  = cfg.bannerFrom;
      document.getElementById("banner-arrow").textContent = cfg.bannerArrow;
      document.getElementById("banner-to").textContent    = cfg.bannerTo;
    }

    // Billing defaults
    const _setRadio = (name, value, hiddenId) => {
      document.querySelectorAll(`input[name="${name}"]`).forEach(r => { r.checked = r.value === value; });
      const hid = document.getElementById(hiddenId);
      if (hid) hid.value = value;
    };
    _setRadio("ca-bill-transport", cfg.billTransport, "f-bill-transport");
    _setRadio("ca-bill-duties",    cfg.billDuties,    "f-bill-duties");

    // Return label checkbox
    const rl = document.getElementById("f-return-label");
    if (rl) rl.checked = cfg.returnLabel;

    // Swap row visibility — always show, but highlight on Return
    const swapRow = document.getElementById("swap-row");
    if (swapRow) swapRow.classList.toggle("ca-swap-row--highlighted", type === "Return");
  },

  _swapAddresses() {
    const pairs = [
      ["f-sender-name",    "f-recipient-name"],
      ["f-sender-company", "f-recipient-company"],
      ["f-sender-phone",   "f-recipient-phone"],
      ["f-sender-email",   "f-recipient-email"],
      ["f-sender-addr1",   "f-recipient-addr1"],
      ["f-sender-addr2",   "f-recipient-addr2"],
      ["f-sender-zip",     "f-recipient-zip"],
    ];
    pairs.forEach(([sId, rId]) => {
      const s = document.getElementById(sId);
      const r = document.getElementById(rId);
      if (s && r) { const tmp = s.value; s.value = r.value; r.value = tmp; }
    });

    // Swap country hidden + display
    const sCountryHid = document.getElementById("f-sender-country");
    const rCountryHid = document.getElementById("f-recipient-country");
    if (sCountryHid && rCountryHid) {
      const tmp = sCountryHid.value; sCountryHid.value = rCountryHid.value; rCountryHid.value = tmp;
    }
    const sCountryTxt = document.querySelector("#ca-combo-sender-country .ca-combo-input");
    const rCountryTxt = document.querySelector("#ca-combo-recipient-country .ca-combo-input");
    if (sCountryTxt && rCountryTxt) {
      const tmp = sCountryTxt.value; sCountryTxt.value = rCountryTxt.value; rCountryTxt.value = tmp;
    }

    // Swap city display
    const sCityTxt = document.getElementById("f-sender-city");
    const rCityTxt = document.getElementById("f-recipient-city");
    if (sCityTxt && rCityTxt) {
      const tmp = sCityTxt.value; sCityTxt.value = rCityTxt.value; rCityTxt.value = tmp;
    }

    // Swap state selects
    const sSt = document.getElementById("f-sender-state");
    const rSt = document.getElementById("f-recipient-state");
    if (sSt && rSt) {
      const tmp = sSt.value; sSt.value = rSt.value; rSt.value = tmp;
    }

    this.scheduleRateCalc();
    this.toast("Sender and recipient addresses swapped", "info");
  },

  /* ── PACKAGES ─────────────────────────────────────────────────────────── */
  bindPackages() {
    const addBtn  = document.getElementById("btn-add-package");
    const pkgList = document.getElementById("packages-list");
    if (!addBtn || !pkgList) return;

    addBtn.addEventListener("click", () => {
      this.packages.push({ id: this.nextPkgId++, weight: "", unit: "kg", l: "", w: "", h: "", desc: "", actual_weight: "", amount: "" });
      this.renderPackages();
    });

    const _handleChange = e => {
      const row = e.target.closest(".ca-package-row");
      if (!row) return;
      const id  = +row.dataset.id;
      const pkg = this.packages.find(p => p.id === id);
      if (!pkg) return;
      const f = e.target.dataset.field;
      const weightChanged = f === "weight" || f === "unit" || f === "l" || f === "w" || f === "h";
      if (f === "weight") { pkg.weight = e.target.value; this.scheduleRateCalc(); }
      else if (f === "unit")          { pkg.unit          = e.target.value; this.scheduleRateCalc(); }
      else if (f === "l")             { pkg.l             = e.target.value; this.scheduleRateCalc(); }
      else if (f === "w")             { pkg.w             = e.target.value; this.scheduleRateCalc(); }
      else if (f === "h")             { pkg.h             = e.target.value; this.scheduleRateCalc(); }
      else if (f === "desc")          pkg.desc          = e.target.value;
      else if (f === "actual_weight") pkg.actual_weight = e.target.value;
      else if (f === "amount")        { pkg.amount = e.target.value; this.updateTotalAmount(); }
      this.updateWeightDisplay();
      const existingRates = weightChanged ? null
        : (this._selectedProvider?.pkgRates?.map(r => r.rate) || null);
      this.updateRatePkgRows(existingRates);
    };

    pkgList.addEventListener("input",  _handleChange);
    pkgList.addEventListener("change", _handleChange);

    pkgList.addEventListener("click", e => {
      const btn = e.target.closest(".ca-btn-remove");
      if (!btn) return;
      const id = +btn.dataset.id;
      if (this.packages.length === 1) { this.toast("At least one package is required", "error"); return; }
      this.packages = this.packages.filter(p => p.id !== id);
      this.renderPackages();
    });
  },

  renderPackages() {
    const list = document.getElementById("packages-list");
    if (!list) return;
    list.innerHTML = this.packages.map((pkg, i) => `
      <div class="ca-package-row" data-id="${pkg.id}">
        <div class="ca-pkg-num">${i + 1}</div>
        <input class="ca-input" type="number" min="0.001" step="0.001" placeholder="0.000"
               value="${pkg.weight}" data-field="weight" style="text-align:right">
        <select class="ca-input ca-select" data-field="unit">
          <option value="kg" ${pkg.unit === "kg" ? "selected" : ""}>kg</option>
          <option value="lb" ${pkg.unit === "lb" ? "selected" : ""}>lb</option>
        </select>
        <div class="ca-pkg-dim">
          <input class="ca-input" type="text" inputmode="decimal" placeholder="L" value="${pkg.l}" data-field="l">
          <span>×</span>
          <input class="ca-input" type="text" inputmode="decimal" placeholder="W" value="${pkg.w}" data-field="w">
          <span>×</span>
          <input class="ca-input" type="text" inputmode="decimal" placeholder="H" value="${pkg.h}" data-field="h">
        </div>
        <input type="hidden" value="${pkg.desc}" data-field="desc">
        <input class="ca-input ca-pkg-actual-weight" type="number" min="0" step="0.001" placeholder="0.000"
               value="${pkg.actual_weight || ''}" data-field="actual_weight" data-pkg-id="${pkg.id}" style="text-align:right">
        <input class="ca-input ca-pkg-amount" type="number" min="0" step="0.01" placeholder="0.00"
               value="${pkg.amount || ''}" data-field="amount" data-pkg-id="${pkg.id}" style="text-align:right">
        <button class="ca-btn-remove" data-id="${pkg.id}" title="Remove package" type="button">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `).join("");
    document.getElementById("summary-pkgs").textContent = this.packages.length;
    this.updateWeightDisplay();
    this.updateRatePkgRows();   // show structure immediately (rates = "—" until recalc)
    this.scheduleRateCalc();    // recalculate for new package count
  },

  /* ── COMMODITIES ──────────────────────────────────────────────────────── */
  bindCommodities() {
    const addBtn  = document.getElementById("btn-add-commodity");
    const commList = document.getElementById("commodities-list");
    if (!addBtn || !commList) return;

    addBtn.addEventListener("click", () => {
      this.commodities.push({ id: this.nextCommodityId++, units: "", uom: "Kg", weight: "", wt_unit: "kgs", desc: "", hs_code: "", price: "", amount: "" });
      this.renderCommodities();
    });

    commList.addEventListener("input", e => {
      if (e.target.classList.contains("ca-comm-hs-input")) return;

      const row = e.target.closest(".ca-commodity-row");
      if (!row) return;
      const id   = +row.dataset.id;
      const comm = this.commodities.find(c => c.id === id);
      if (!comm) return;
      const f = e.target.dataset.field;
      if (f === "units") comm.units = e.target.value;
      else if (f === "price") comm.price = e.target.value;
      else if (f === "weight") comm.weight = e.target.value;
      else if (f === "desc") {
        comm.desc = e.target.value;
        // clear stale hs results and reset hs field when description changes
        delete this._hsItems[id];
        comm.hs_code = "";
        const hsInp = e.target.closest(".ca-commodity-row")?.querySelector(".ca-comm-hs-input");
        if (hsInp) hsInp.value = "";
      }
      if (f === "units" || f === "price") {
        const amt = (parseFloat(comm.units) || 0) * (parseFloat(comm.price) || 0);
        comm.amount = amt > 0 ? amt.toFixed(2) : "";
        const amtEl = row.querySelector(".ca-comm-amount");
        if (amtEl) amtEl.textContent = comm.amount
          ? (window.CA_CURRENCY || "PKR") + " " + parseFloat(comm.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "—";
        this.updateCommodityTotal();
      }
      if (f === "weight") this.updateCommodityTotal();
    });

    // Prefetch HTS codes silently when description field loses focus
    commList.addEventListener("focusout", e => {
      if (e.target.dataset.field !== "desc") return;
      const row = e.target.closest(".ca-commodity-row");
      if (!row) return;
      const id   = +row.dataset.id;
      const comm = this.commodities.find(c => c.id === id);
      if (!comm || comm.desc.trim().length < 2) return;
      const kw = comm.desc.trim();
      frappe.call({
        method: "courier_app.api.shipment_api.search_hs_codes",
        args: { keyword: kw },
        callback: r => { this._hsItems[id] = r.message || []; }
      });
    });

    commList.addEventListener("change", e => {
      const row = e.target.closest(".ca-commodity-row");
      if (!row) return;
      const id   = +row.dataset.id;
      const comm = this.commodities.find(c => c.id === id);
      if (!comm) return;
      if (e.target.dataset.field === "uom") comm.uom = e.target.value;
      if (e.target.dataset.field === "wt_unit") { comm.wt_unit = e.target.value; this.updateCommodityTotal(); }
    });

    commList.addEventListener("click", e => {
      if (e.target.classList.contains("ca-comm-hs-input")) {
        const id   = +e.target.dataset.commId;
        const comm = this.commodities.find(c => c.id === id);
        if (!comm) return;
        const kw = comm.desc.trim();
        if (kw.length < 2) {
          frappe.show_alert({ message: "Please enter a description first", indicator: "orange" });
          return;
        }
        const items = this._hsItems[id];
        if (items) {
          this._openHsModal(id, e.target, items, kw);
        } else {
          this._openHsModal(id, e.target, null, kw);
          frappe.call({
            method: "courier_app.api.shipment_api.search_hs_codes",
            args: { keyword: kw },
            callback: r => {
              this._hsItems[id] = r.message || [];
              const ov = document.getElementById("ca-hs-modal");
              if (ov && ov.classList.contains("open") && +ov.dataset.commId === id) {
                this._fillHsModal(ov, this._hsItems[id]);
              }
            }
          });
        }
        return;
      }
      const btn = e.target.closest(".ca-btn-remove");
      if (!btn) return;
      this.commodities = this.commodities.filter(c => c.id !== +btn.dataset.id);
      this.renderCommodities();
    });
  },

  renderCommodities() {
    const list = document.getElementById("commodities-list");
    if (!list) return;
    list.innerHTML = this.commodities.map((c, i) => `
      <div class="ca-commodity-row" data-id="${c.id}">
        <div class="ca-comm-num">${i + 1}</div>
        <input class="ca-input" type="number" min="0" step="0.001" placeholder="0.000"
               value="${c.units}" data-field="units" style="text-align:right">
        <select class="ca-input ca-select" data-field="uom">
          <option value="Kg"  ${c.uom === "Kg"  ? "selected" : ""}>Kg</option>
          <option value="Doz" ${c.uom === "Doz" ? "selected" : ""}>Doz</option>
          <option value="Pcs" ${c.uom === "Pcs" ? "selected" : ""}>Pcs</option>
        </select>
        <input class="ca-input" type="number" min="0" step="0.001" placeholder="0.000"
               value="${c.weight}" data-field="weight" style="text-align:right">
        <select class="ca-input ca-select" data-field="wt_unit">
          <option value="kgs" ${(c.wt_unit || "kgs") === "kgs" ? "selected" : ""}>kgs</option>
          <option value="lbs" ${c.wt_unit === "lbs" ? "selected" : ""}>lbs</option>
        </select>
        <input class="ca-input" type="text" placeholder="Description" value="${c.desc}" data-field="desc">
        <input class="ca-input ca-comm-hs-input" type="text" placeholder="Select…"
               value="${c.hs_code}" data-comm-id="${c.id}" readonly style="cursor:pointer;background:var(--ca-bg)">
        <input class="ca-input" type="number" min="0" step="0.01" placeholder="0.00"
               value="${c.price}" data-field="price" style="text-align:right">
        <div class="ca-comm-amount">${c.amount
          ? (window.CA_CURRENCY || "PKR") + " " + parseFloat(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "—"}</div>
        <button class="ca-btn-remove" data-id="${c.id}" type="button" title="Remove item">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `).join("");
    this.updateCommodityTotal();
  },

  /* ── HTS CODE MODAL ──────────────────────────────────────────────── */
  _ensureHsModal() {
    let el = document.getElementById("ca-hs-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "ca-hs-modal";
    el.className = "ca-hs-modal-overlay";
    el.innerHTML = `
<div class="ca-hs-modal-panel">
  <div class="ca-hs-modal-head">
    <div class="ca-hs-modal-head-info">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--ca-accent);flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <div>
        <div class="ca-hs-modal-title">HTS Code Lookup</div>
        <div class="ca-hs-modal-subtitle" id="ca-hs-modal-kw"></div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span class="ca-hs-modal-count">—</span>
      <button class="ca-hs-modal-close" type="button" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
  <div class="ca-hs-modal-search-wrap">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#94a3b8;flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input class="ca-hs-modal-filter" type="text" placeholder="Search by code or description…" autocomplete="off">
  </div>
  <div class="ca-hs-modal-body"></div>
</div>`;
    document.body.appendChild(el);
    return el;
  },

  _fillHsModal(overlay, items) {
    const countEl  = overlay.querySelector(".ca-hs-modal-count");
    const filterEl = overlay.querySelector(".ca-hs-modal-filter");
    const body     = overlay.querySelector(".ca-hs-modal-body");
    const commId   = +overlay.dataset.commId;

    const renderItems = filter => {
      const fl = (filter || "").toLowerCase();
      const filtered = fl
        ? items.filter(it => it.htsno.toLowerCase().includes(fl) || it.description.toLowerCase().includes(fl))
        : items;
      countEl.textContent = filtered.length + " result" + (filtered.length === 1 ? "" : "s");
      if (!filtered.length) {
        body.innerHTML = '<div class="ca-hs-modal-empty">No matching HS codes found</div>';
        return;
      }
      body.innerHTML = filtered.slice(0, 60).map(it => {
        const duty   = (it.general || "").trim();
        const isFree = duty && duty.toLowerCase() === "free";
        const dutyHtml = duty
          ? `<span class="ca-hs-duty${isFree ? "" : " ca-hs-duty--paid"}">${duty}</span>`
          : "";
        return `<div class="ca-hs-modal-opt" data-code="${(it.htsno||"").replace(/"/g,"&quot;")}">
  <div class="ca-hs-opt-row"><span class="ca-hs-code">${it.htsno}</span>${dutyHtml}</div>
  <div class="ca-hs-desc">${it.description}</div>
</div>`;
      }).join("");
      body.querySelectorAll(".ca-hs-modal-opt").forEach(opt => {
        opt.addEventListener("click", () => {
          const code = opt.dataset.code;
          const hsInp = document.querySelector(`.ca-comm-hs-input[data-comm-id="${commId}"]`);
          if (hsInp) hsInp.value = code;
          const comm = this.commodities.find(c => c.id === commId);
          if (comm) comm.hs_code = code;
          overlay.classList.remove("open");
        });
      });
    };

    filterEl.oninput = () => renderItems(filterEl.value);

    if (items === null) {
      countEl.textContent = "—";
      body.innerHTML = '<div class="ca-hs-modal-empty"><span class="ca-hs-modal-spinner"></span>Searching…</div>';
    } else if (!items.length) {
      countEl.textContent = "0 results";
      body.innerHTML = '<div class="ca-hs-modal-empty">No HS codes found for this description.</div>';
    } else {
      renderItems("");
    }
  },

  _openHsModal(commId, _hsEl, items, descText) {
    const overlay = this._ensureHsModal();
    overlay.dataset.commId = commId;
    const subtitleEl = overlay.querySelector("#ca-hs-modal-kw");
    if (subtitleEl) subtitleEl.textContent = descText ? `"${descText}"` : "";
    const filterEl = overlay.querySelector(".ca-hs-modal-filter");
    filterEl.value = "";
    const close = () => overlay.classList.remove("open");
    overlay.querySelector(".ca-hs-modal-close").onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    this._fillHsModal(overlay, items);
    overlay.classList.add("open");
    setTimeout(() => filterEl.focus(), 60);
  },

  updateCommodityTotal() {
    const totalRow = document.getElementById("commodity-total-row");
    const totalVal = document.getElementById("commodity-total-amount");
    if (!totalRow || !totalVal) return;
    const sum = this.commodities.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
    if (sum > 0) {
      totalVal.textContent = (window.CA_CURRENCY || "PKR") + " " + sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      totalRow.style.display = "flex";
    } else {
      totalRow.style.display = "none";
    }
    const wtTotalRow = document.getElementById("commodity-wt-total-row");
    const wtTotalVal = document.getElementById("commodity-wt-total-amount");
    if (!wtTotalRow || !wtTotalVal) return;
    const totalWtKg = this.commodities.reduce((acc, c) => {
      const w = parseFloat(c.weight) || 0;
      return acc + (c.wt_unit === "lbs" ? w * 0.453592 : w);
    }, 0);
    if (totalWtKg > 0) {
      wtTotalVal.textContent = totalWtKg.toFixed(3) + " kg";
      wtTotalRow.style.display = "flex";
    } else {
      wtTotalRow.style.display = "none";
    }
  },

  getTotalWeightKg() {
    return this.packages.reduce((sum, pkg) => {
      const w = parseFloat(pkg.weight) || 0;
      return sum + (pkg.unit === "lb" ? w * 0.453592 : w);
    }, 0);
  },

  updateWeightDisplay() {
    const total = this.getTotalWeightKg();
    const weightEl = document.getElementById("summary-weight");
    if (weightEl) weightEl.textContent = total > 0 ? total.toFixed(3) + " kg" : "—";
    const pkgsEl = document.getElementById("summary-pkgs");
    if (pkgsEl) pkgsEl.textContent = this.packages.length;
  },

  updateTotalAmount() {
    const totalRow = document.getElementById("pkg-total-row");
    const totalVal = document.getElementById("pkg-total-amount");
    if (!totalRow || !totalVal) return;
    const sum = this.packages.reduce((acc, pkg) => acc + (parseFloat(pkg.amount) || 0), 0);
    if (sum > 0) {
      totalVal.textContent = (window.CA_CURRENCY || "PKR") + " " + Math.round(sum).toLocaleString();
      totalRow.style.display = "flex";
    } else {
      totalRow.style.display = "none";
    }
  },

  updateRatePkgRows(pkgRates) {
    // ── Rate Summary card rows (right panel) ──────────────────────────────
    const el = document.getElementById("rate-pkg-rows");
    if (el) {
      const valid = this.packages.filter(p => parseFloat(p.weight) > 0 || p.l || p.w || p.h || p.desc);
      if (!valid.length) { el.style.display = "none"; el.innerHTML = ""; }
      else {
        el.style.display = "block";
        el.innerHTML =
          `<div class="ca-rpkg-head"><span>#</span><span>Weight</span><span>L × W × H</span><span>Rate</span></div>` +
          valid.map((p, i) => {
            const w      = parseFloat(p.weight) || 0;
            const wStr   = w > 0 ? `${w.toFixed(3)} ${p.unit}` : "—";
            const dimStr = (p.l && p.w && p.h) ? `${p.l}×${p.w}×${p.h}` : "—";
            const rateVal = pkgRates && pkgRates[i] != null
              ? `${window.CA_CURRENCY || "PKR"} ${Math.round(pkgRates[i]).toLocaleString()}` : "—";
            return `<div class="ca-rpkg-row">
              <span class="ca-rpkg-num">${i + 1}</span>
              <span class="ca-rpkg-wt">${wStr}</span>
              <span class="ca-rpkg-dim">${dimStr}</span>
              <span class="ca-rpkg-rate">${rateVal}</span>
            </div>`;
          }).join("");
      }
    }

    // ── Inline Amount cells inside each package row ───────────────────────
    // Build a map: pkg.id → rate (pkgRates is indexed by packages-with-weight order)
    const pkgRateMap = {};
    let rateIdx = 0;
    this.packages.forEach(pkg => {
      const w = pkg.unit === "lb"
        ? (parseFloat(pkg.weight) || 0) * 0.453592
        : (parseFloat(pkg.weight) || 0);
      if (w > 0 && pkgRates && rateIdx < pkgRates.length) {
        pkgRateMap[pkg.id] = pkgRates[rateIdx++];
      }
    });
    // Actual Weight inputs — auto-compute from package inputs every time
    document.querySelectorAll(".ca-pkg-actual-weight").forEach(input => {
      const id  = +input.dataset.pkgId;
      const pkg = this.packages.find(p => p.id === id);
      if (!pkg) return;
      const weightKg = pkg.unit === "lb"
        ? (parseFloat(pkg.weight) || 0) * 0.453592
        : (parseFloat(pkg.weight) || 0);
      if (weightKg <= 0) {
        input.value = "";
        pkg.actual_weight = "";
        input.style.backgroundColor = "";
        input.style.color = "";
        return;
      }
      const l = parseFloat(pkg.l) || 0;
      const w = parseFloat(pkg.w) || 0;
      const h = parseFloat(pkg.h) || 0;
      const volKg = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 5000 : 0;
      const isVol = volKg > weightKg;
      const displayKg = isVol ? volKg : weightKg;
      input.value = displayKg.toFixed(3);
      pkg.actual_weight = displayKg.toFixed(3);
      input.style.backgroundColor = isVol ? "red" : "";
      input.style.color            = isVol ? "#fff" : "";
    });

    // Amount inputs — auto-populate only when rate API provides a value
    document.querySelectorAll(".ca-pkg-amount").forEach(input => {
      const id   = +input.dataset.pkgId;
      const rate = pkgRateMap[id];
      const hasRate = rate != null;
      if (hasRate) {
        input.value = Math.round(rate);
        const pkg = this.packages.find(p => p.id === id);
        if (pkg) pkg.amount = Math.round(rate);
      } else if (pkgRates !== undefined) {
        // rates were requested but none for this pkg — clear
        input.value = "";
        const pkg = this.packages.find(p => p.id === id);
        if (pkg) pkg.amount = "";
      }
      // if pkgRates is undefined (no API call yet), leave existing value untouched
    });
    this.updateTotalAmount();
  },

  /* ── RATE CALCULATOR ──────────────────────────────────────────────────── */
  _clearPackages() {
    this.packages  = [{ id: 1, weight: "", unit: "kg", l: "", w: "", h: "", desc: "", actual_weight: "", amount: "" }];
    this.nextPkgId = 2;
    this.renderPackages();
  },

  scheduleRateCalc() {
    clearTimeout(this.rateDebounce);
    this.rateDebounce = setTimeout(() => this.calcRate(), 500);
  },

  calcRate() {
    const country         = document.getElementById("f-recipient-country").value;
    const serviceProvider = document.getElementById("f-service-provider")?.value || "";
    const compEl          = document.getElementById("rate-comparison");
    const selEl           = document.getElementById("rate-selected");
    const liveBadge       = document.getElementById("rate-live-badge");

    const volWeightMap = {};
    const pkgData = this.packages
      .map(p => {
        const actualKg = p.unit === "lb"
          ? (parseFloat(p.weight) || 0) * 0.453592
          : (parseFloat(p.weight) || 0);
        const l = parseFloat(p.l) || 0;
        const w = parseFloat(p.w) || 0;
        const h = parseFloat(p.h) || 0;
        const volKg = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 5000 : 0;
        const isVol = volKg > actualKg;
        volWeightMap[p.id] = isVol;
        return { weightKg: isVol ? volKg : actualKg };
      })
      .filter(p => p.weightKg > 0);
    this._volWeightMap = volWeightMap;

    if (!country || !pkgData.length) {
      if (compEl) compEl.style.display = "none";
      if (selEl) selEl.style.display = "none";
      if (liveBadge) liveBadge.style.display = "none";
      document.getElementById("rate-number").textContent = "—";
      this.updateRatePkgRows();
      return;
    }

    if (compEl) {
      compEl.style.display = "block";
      compEl.innerHTML = '<div class="ca-rate-loading"><span class="ca-spinner-sm"></span> Calculating rates…</div>';
    }

    const _spParam = serviceProvider ? { service_provider: serviceProvider } : {};

    const calls = pkgData.map(({ weightKg }) =>
      fetch("/api/method/courier_app.api.shipment_api.get_rates_all_providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Frappe-CSRF-Token": frappe.csrf_token || "fetch",
          "X-Frappe-CMD": "courier_app.api.shipment_api.get_rates_all_providers"
        },
        body: new URLSearchParams({ country, weight: weightKg.toFixed(3), ..._spParam }).toString()
      }).then(r => r.json()).then(d => ({
        weightKg,
        rates: (d.message || {}).rates || [],
        error: (d.message || {}).error || ""
      }))
    );

    Promise.all(calls).then(results => {
      if (compEl) { compEl.innerHTML = ""; compEl.style.display = "none"; }

      // Aggregate rates per provider across all packages
      const provMap = {};
      results.forEach(({ weightKg, rates, error }) => {
        if (serviceProvider && !rates.length && error && error.includes("supports a maximum weight")) {
          const spSel = document.getElementById("f-service-provider");
          const spName = spSel ? (spSel.options[spSel.selectedIndex]?.text || serviceProvider) : serviceProvider;
          rates = [{ provider_id: serviceProvider, provider_name: spName, rate: 0 }];
        }
        rates.forEach(r => {
          if (!provMap[r.provider_id]) {
            provMap[r.provider_id] = {
              provider_id:   r.provider_id,
              provider_name: r.provider_name || r.provider_id,
              provider_code: r.provider_code || "",
              zone_code:     r.zone_code     || "",
              note:          r.note          || "",
              total:         0,
              pkgRates:      []
            };
          }
          provMap[r.provider_id].total += (r.rate || 0);
          provMap[r.provider_id].pkgRates.push({ weightKg, rate: r.rate || 0 });
        });
      });

      const providers = Object.values(provMap).sort((a, b) => a.total - b.total);

      if (!providers.length) {
        const errMsg = results.find(r => r.error)?.error || "No rates available for this destination";
        if (compEl) { compEl.style.display = "block"; compEl.innerHTML = `<div class="ca-rate-hint">${errMsg}</div>`; }
        if (selEl) selEl.style.display = "none";
        if (liveBadge) liveBadge.style.display = "none";
        document.getElementById("rate-number").textContent = "—";
        this.updateRatePkgRows();
        return;
      }

      const cheapest = providers[0];
      const selected = serviceProvider
        ? providers.find(p => p.provider_id === serviceProvider)
        : cheapest;

      if (!selected) {
        if (compEl) { compEl.style.display = "block"; compEl.innerHTML = '<div class="ca-rate-hint">No rate available for the selected provider at this weight</div>'; }
        if (selEl) selEl.style.display = "none";
        if (liveBadge) liveBadge.style.display = "none";
        document.getElementById("rate-number").textContent = "—";
        this.updateRatePkgRows();
        return;
      }

      this._selectedProvider = selected;
      if (liveBadge) liveBadge.style.display = "inline-flex";
      this._showSelectedRate(selected);

    }).catch(() => {
      if (compEl) { compEl.style.display = "block"; compEl.innerHTML = '<div class="ca-rate-error">Failed to calculate rates. Please try again.</div>'; }
      if (selEl) selEl.style.display = "none";
      this.updateRatePkgRows();
    });
  },

  _showSelectedRate(prov) {
    const selEl = document.getElementById("rate-selected");
    if (!selEl || !prov) return;
    selEl.style.display = "block";

    const multiPkg = prov.pkgRates && prov.pkgRates.length > 1;

    document.getElementById("rate-number").textContent = Math.round(prov.total).toLocaleString();

    const labelEl = document.getElementById("rate-total-label");
    if (labelEl) labelEl.textContent = multiPkg ? "Total amount" : "Estimated rate";

    const noteEl = document.getElementById("rate-note");
    if (noteEl) noteEl.textContent = prov.note || "";

    // Fill per-package rates into the pkg rows table
    const rates = prov.pkgRates ? prov.pkgRates.map(r => r.rate) : [];
    this.updateRatePkgRows(rates);
  },

  /* ── INVOICE (API-based) ─────────────────────────────────────────────── */
  bindInvoiceButtons() {
    const ids = [
      ["btn-print-invoice",       () => this.printInvoice()],
      ["btn-save-invoice-pdf",    () => this.saveInvoicePDF()],
      ["btn-rate-print-invoice",  () => this.printInvoice()],
      ["btn-rate-save-pdf",       () => this.saveInvoicePDF()],
      ["btn-above-print-invoice", () => this.printInvoice()],
      ["btn-above-save-pdf",      () => this.saveInvoicePDF()],
      ["btn-rate-new-shipment",   () => document.getElementById("btn-reset-form").click()],
    ];
    for (const [id, fn] of ids) {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    }
  },

  _getInvoiceShipmentId() {
    const id = this._savedShipmentId ||
               (document.getElementById("modal-shipment-id")?.textContent || "").trim();
    if (!id || id === "—") { this.toast("No shipment ID — book a shipment first", "error"); return null; }
    return id;
  },

  printInvoice() {
    const name = this._getInvoiceShipmentId();
    if (!name) return;

    // Open popup synchronously (inside click handler) to avoid popup-blocker
    const win = window.open("", "_blank", "width=960,height=740,scrollbars=yes,resizable=yes");
    if (!win) { this.toast("Allow pop-ups for this site to print the invoice", "error"); return; }
    win.document.write("<html><head><title>Loading…</title></head><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#888'><p>Generating invoice…</p></body></html>");
    win.document.close();

    frappe.call({
      method:   "courier_app.api.invoice_api.get_invoice_html",
      args:     { name },
      callback: r => {
        if (win.closed) return;
        if (!r.message) { win.close(); this.toast("Invoice generation failed", "error"); return; }
        win.document.open();
        win.document.write(r.message);
        win.document.close();
        // Fallback: if the auto-print script inside the HTML doesn't fire (e.g. no images to wait for)
        // trigger print after a short delay to guarantee the dialog opens
        setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 800);
      },
      error: () => { if (!win.closed) win.close(); this.toast("Failed to load invoice", "error"); }
    });
  },

  saveInvoicePDF() {
    const name = this._getInvoiceShipmentId();
    if (!name) return;

    // Disable all PDF buttons to prevent double-clicks while downloading
    const pdfBtnIds = ["btn-save-invoice-pdf", "btn-rate-save-pdf", "btn-above-save-pdf"];
    pdfBtnIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.style.opacity = "0.6"; }
    });
    const restore = () => pdfBtnIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = false; el.style.opacity = ""; }
    });

    this.toast("Generating PDF…", "info");

    const url = `/api/method/courier_app.api.invoice_api.get_invoice_pdf?name=${encodeURIComponent(name)}`;
    fetch(url, { credentials: "include" })
      .then(r => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.includes("application/json")) {
          return r.json().then(j => {
            let msg = "PDF generation failed";
            try {
              const smsgs = JSON.parse(j._server_messages || "[]");
              if (smsgs.length) msg = JSON.parse(smsgs[0]).message || msg;
            } catch (_) {}
            if (!msg && j.exc) {
              msg = String(j.exc).split("\n").filter(Boolean).pop() || msg;
            }
            throw new Error(msg);
          });
        }
        return r.blob();
      })
      .then(blob => {
        restore();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `Invoice-${name}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
      })
      .catch(err => {
        restore();
        this.showErrorModal("PDF Download Failed", err.message || "An error occurred while generating the PDF. Please try again.", []);
      });
  },

  /* ── PRINT RECEIPT ────────────────────────────────────────────────────── */
  bindPrintReceipt() {
    const btn = document.getElementById("btn-print-receipt");
    if (btn) btn.addEventListener("click", () => this.printReceipt());
  },

  printReceipt() {
    const prov = this._selectedProvider || null;
    const now  = new Date().toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
    const _v = id => (document.getElementById(id)?.value || "").trim();
    const _t = id => (document.getElementById(id)?.textContent || "").trim();

    // Header
    const dateEl = document.getElementById("rct-date");
    if (dateEl) dateEl.textContent = "Printed: " + now;

    // Shipment details
    document.getElementById("rct-type").textContent     = _v("f-shipment-type") || "—";
    document.getElementById("rct-service").textContent  = _v("f-service") || "—";
    document.getElementById("rct-packaging").textContent= _v("f-packaging") || "—";
    document.getElementById("rct-ship-date").textContent= _t("summary-ship-date") || "—";
    document.getElementById("rct-delivery").textContent = _t("summary-delivery") || "—";
    document.getElementById("rct-ref").textContent      = document.getElementById("f-party-display")?.textContent || _v("f-party-name") || "—";

    // From address
    const fromLines = [
      _v("f-sender-name"),
      _v("f-sender-company"),
      _v("f-sender-addr1"),
      _v("f-sender-addr2"),
      [_v("f-sender-city"), document.getElementById("f-sender-state")?.value, _v("f-sender-country")].filter(Boolean).join(", "),
      _v("f-sender-zip"),
      _v("f-sender-phone"),
    ].filter(Boolean);
    document.getElementById("rct-from").innerHTML = fromLines.map((l, i) => i === 0 ? `<strong>${l}</strong>` : l).join("<br>");

    // To address
    const toLines = [
      _v("f-recipient-name"),
      _v("f-recipient-company"),
      _v("f-recipient-addr1"),
      _v("f-recipient-addr2"),
      [_v("f-recipient-city"), document.getElementById("f-recipient-state")?.value, _v("f-recipient-country")].filter(Boolean).join(", "),
      _v("f-recipient-zip"),
      _v("f-recipient-phone"),
    ].filter(Boolean);
    document.getElementById("rct-to").innerHTML = toLines.map((l, i) => i === 0 ? `<strong>${l}</strong>` : l).join("<br>");

    // Packages table
    const tbody = document.getElementById("rct-packages");
    if (tbody) {
      const pkgRates = prov ? prov.pkgRates : null;
      tbody.innerHTML = this.packages.map((p, i) => {
        const w = parseFloat(p.weight) || 0;
        const hasDims = p.l && p.w && p.h;
        const rateVal = pkgRates && pkgRates[i] != null
          ? Math.round(pkgRates[i].rate).toLocaleString() : "—";
        return `<tr>
          <td>${i + 1}</td>
          <td>${w > 0 ? w.toFixed(3) + " " + p.unit : "—"}</td>
          <td>${hasDims ? `${p.l} × ${p.w} × ${p.h}` : "—"}</td>
          <td style="text-align:right;font-weight:600">${rateVal}</td>
        </tr>`;
      }).join("");
    }
    const totalWt = document.getElementById("rct-weight-total");
    if (totalWt) totalWt.textContent = this.getTotalWeightKg().toFixed(3) + " kg";

    // Total Amount
    const totalEl = document.getElementById("rct-total");
    if (totalEl) {
      totalEl.textContent = prov ? `${window.CA_CURRENCY || "PKR"} ${Math.round(prov.total).toLocaleString()}` : "—";
    }

    window.print();
  },

  /* ── FORM SUBMIT ──────────────────────────────────────────────────────── */
  showErrorModal(title, desc, items) {
    document.getElementById("error-modal-title").textContent = title;
    document.getElementById("error-modal-desc").textContent  = desc;
    const list = document.getElementById("error-modal-list");
    list.innerHTML = (items || []).map(e => `<li>${e}</li>`).join("");
    document.getElementById("btn-close-error-modal").textContent = items && items.length ? "Fix issues" : "Close";
    document.getElementById("error-modal").style.display = "flex";
  },

  bindSubmit() {
    document.getElementById("btn-submit-shipment").addEventListener("click", () => this.submitShipment());
  },

  submitShipment() {
    // Resolve any typed-but-not-clicked country text before validation runs.
    // The combo blur handler uses a 160ms setTimeout; clicking submit fires
    // before that timeout, leaving the hidden input empty on first attempt.
    [this._comboSenderCountry, this._comboRecipientCountry].forEach(c => c?.flush?.());
    if (!this.validateForm()) return;
    const btn = document.getElementById("btn-submit-shipment");

    const _proceed = () => {
      btn.innerHTML = '<span class="ca-spinner"></span> Booking…';
      btn.disabled  = true;
      this._doSubmitShipment(btn);
    };

    // Desk users select an existing customer — no duplicate name check needed
    if (document.getElementById("f-party-wrap")) { _proceed(); return; }

    if (this._partyNameStatus === "exists") {
      // Already warned on blur — show confirm modal again before booking
      this._showPartyWarnPortal(
        (document.getElementById("f-party-name")?.value || "").trim(),
        _proceed
      );
    } else if (this._partyNameStatus === null) {
      // Not yet checked — run check silently; only interrupt if name exists
      const partyName = (document.getElementById("f-party-name")?.value || "").trim();
      btn.innerHTML = '<span class="ca-spinner"></span> Verifying…';
      btn.disabled = true;
      frappe.call({
        method: "courier_app.api.shipment_api.check_party_name",
        args: { name: partyName },
        callback: r => {
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Book shipment`;
          btn.disabled = false;
          if (r.message?.exists) { this._partyNameStatus = "exists"; this._showPartyWarnPortal(partyName, _proceed); }
          else _proceed();
        },
        error: _proceed,
      });
    } else {
      _proceed();
    }
  },

  _doSubmitShipment(btn) {

    const payload = {
      shipment_type:           document.getElementById("f-shipment-type").value,
      ship_date:               document.getElementById("f-ship-date").value,
      service:                 document.getElementById("f-service").value,
      service_provider:        document.getElementById("f-service-provider")?.value || "",
      packaging_type:          document.getElementById("f-packaging").value,
      party_name:              document.getElementById("f-party-name").value,
      sender_name:             document.getElementById("f-sender-name").value,
      sender_company:          document.getElementById("f-sender-company").value,
      sender_phone:            document.getElementById("f-sender-phone").value,
      sender_email:            document.getElementById("f-sender-email").value,
      sender_address_line1:    document.getElementById("f-sender-addr1").value,
      sender_address_line2:    document.getElementById("f-sender-addr2").value,
      sender_city:             document.getElementById("f-sender-city").value,
      sender_state:            document.getElementById("f-sender-state")?.value || "",
      sender_country:          document.getElementById("f-sender-country").value,
      sender_zip:              document.getElementById("f-sender-zip").value,
      recipient_name:          document.getElementById("f-recipient-name").value,
      recipient_company:       document.getElementById("f-recipient-company").value,
      recipient_phone:         document.getElementById("f-recipient-phone").value,
      recipient_email:         document.getElementById("f-recipient-email").value,
      recipient_address_line1: document.getElementById("f-recipient-addr1").value,
      recipient_address_line2: document.getElementById("f-recipient-addr2").value,
      recipient_city:          document.getElementById("f-recipient-city").value,
      recipient_state:         document.getElementById("f-recipient-state")?.value || "",
      recipient_country:       document.getElementById("f-recipient-country").value,
      recipient_zip:           document.getElementById("f-recipient-zip").value,
      is_residential:          document.getElementById("f-residential").checked ? 1 : 0,
      bill_transportation_to:  document.getElementById("f-bill-transport").value,
      bill_duties_to:          document.getElementById("f-bill-duties").value,
      signature_required:      document.getElementById("f-signature").checked ? 1 : 0,
      hold_at_location:        document.getElementById("f-hold").checked ? 1 : 0,
      email_label:             document.getElementById("f-email-label").checked ? 1 : 0,
      include_return_label:    document.getElementById("f-return-label").checked ? 1 : 0,
      special_instructions:    document.getElementById("f-instructions").value,
      packages: this.packages.map(p => ({
        weight:         parseFloat(p.weight) || 0,
        weight_unit:    p.unit,
        length:         parseFloat(p.l) || 0,
        width:          parseFloat(p.w) || 0,
        height:         parseFloat(p.h) || 0,
        description:    p.desc,
        actual_weight:  parseFloat(p.actual_weight) || 0,
        amount:         parseFloat(p.amount) || 0,
      })),
      commodities: this.commodities.map(c => ({
        units:    parseFloat(c.units) || 0,
        uom:      c.uom,
        weight:   parseFloat(c.weight) || 0,
        wt_unit:  c.wt_unit || "kgs",
        desc:     c.desc,
        hs_code:  c.hs_code,
        price:    parseFloat(c.price) || 0,
        amount:   parseFloat(c.amount) || 0,
      })),
    };

    const _resetBtn = () => {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Book shipment`;
      btn.disabled = false;
    };

    // Intercept frappe.msgprint so server Notes appear as a popup, not a bottom toast
    const capturedNotes = [];
    const _origMsgprint = frappe.msgprint;
    frappe.msgprint = (opts) => {
      const text = (typeof opts === "string" ? opts : (opts && opts.message) || "").replace(/<[^>]+>/g, "").trim();
      const title = (typeof opts === "object" && opts && opts.title) || "Note";
      if (text) capturedNotes.push({ title, text });
    };
    const _restoreMsgprint = () => { frappe.msgprint = _origMsgprint; };

    const _extractServerMsg = (r) => {
      if (r && r._server_messages) {
        try {
          const msgs = JSON.parse(r._server_messages);
          const first = JSON.parse(msgs[0]);
          return (first.message || "").replace(/<[^>]+>/g, "").trim();
        } catch (_) {}
      }
      if (r && r.exc) {
        try {
          const lines = JSON.parse(r.exc);
          const last = (Array.isArray(lines) ? lines : [lines])
            .filter(Boolean).pop() || "";
          return last.split("\n").filter(Boolean).pop() || "";
        } catch (_) { return String(r.exc).split("\n").filter(Boolean).pop() || ""; }
      }
      return "";
    };

    frappe.call({
      method: "courier_app.api.shipment_api.submit_shipment",
      args: { data: JSON.stringify(payload) },
      callback: r => {
        _restoreMsgprint();
        _resetBtn();
        capturedNotes.forEach(n => this.showErrorModal(n.title, n.text, []));
        const data = r.message || {};
        if (data.status === "success") {
          document.getElementById("modal-shipment-id").textContent = data.shipment_id;
          document.getElementById("modal-weight").textContent = (parseFloat(data.total_weight) || 0).toFixed(3) + " KG";
          document.getElementById("modal-rate-per-kg").textContent = (window.CA_CURRENCY || "PKR") + " " + Math.round(data.rate_per_kg || 0).toLocaleString();
          document.getElementById("modal-rate").textContent = (window.CA_CURRENCY || "PKR") + " " + Math.round(data.calculated_rate || 0).toLocaleString();
          if (data.packages && data.packages.length) {
            const amtCells = document.querySelectorAll(".ca-pkg-amount");
            data.packages.forEach((pkg, i) => {
              const cell = amtCells[i];
              if (!cell) return;
              const amt = parseFloat(pkg.amount) || 0;
              cell.textContent = amt > 0 ? (window.CA_CURRENCY || "PKR") + " " + Math.round(amt).toLocaleString() : "—";
            });
          }
          document.getElementById("success-modal").style.display = "flex";
          // Store shipment ID for Print / Save PDF (reliable alternative to reading modal textContent)
          this._savedShipmentId = data.shipment_id;
          // Replace "Book Shipment" button with Print / Save PDF / New Shipment
          const submitBtn = document.getElementById("btn-submit-shipment");
          if (submitBtn) submitBtn.style.display = "none";
          const rateInvBtns = document.getElementById("rate-inv-btns");
          if (rateInvBtns) rateInvBtns.style.display = "flex";
          const rateInvoiceBar = document.getElementById("rate-invoice-bar");
          if (rateInvoiceBar) rateInvoiceBar.style.display = "flex";
        } else {
          const msg = data.message || data.error || "Shipment could not be saved. Please try again.";
          this.showErrorModal("Booking Failed", msg, []);
        }
      },
      error: (r) => {
        _restoreMsgprint();
        _resetBtn();
        const serverMsg = _extractServerMsg(r);
        let title = "Save Error";
        let msg = serverMsg || "An error occurred while saving the shipment. Please try again.";
        if (serverMsg && serverMsg.toLowerCase().includes("invalidemail") ||
            serverMsg && serverMsg.toLowerCase().includes("valid email")) {
          title = "Invalid Email Address";
          msg = "One of the email addresses entered is not valid. Please check the Sender and Recipient email fields and try again.";
        }
        this.showErrorModal(title, msg, []);
      }
    });
  },

  bindPartyNameCheck() {
    const el = document.getElementById("f-party-name");
    if (!el) return;

    // Desk user: hidden input driven by custom select — skip text check
    if (el.type === "hidden") {
      this._partyNameStatus = "prefilled";
      return;
    }

    // Pre-filled from Customer record — skip existence check entirely
    if (el.readOnly) {
      this._partyNameStatus = "prefilled";
      return;
    }

    this._partyNameStatus = null;

    const hint = document.createElement("div");
    hint.className = "ca-party-hint";
    el.parentNode.appendChild(hint);

    const showWarn = name => {
      hint.className = "ca-party-hint ca-party-hint--warn";
      hint.innerHTML = `<strong>⚠ Name already exists</strong> — a customer named "<em>${name}</em>" is already registered. Please use a slightly different name.`;
      hint.style.display = "block";
    };
    const clearHint = () => {
      hint.style.display = "none";
      this._partyNameStatus = null;
    };

    el.addEventListener("blur", () => {
      const name = el.value.trim();
      if (!name || name.length < 2) { clearHint(); return; }
      frappe.call({
        method: "courier_app.api.shipment_api.check_party_name",
        args: { name },
        callback: r => {
          if (r.message?.exists) {
            this._partyNameStatus = "exists";
            showWarn(name);
          } else {
            clearHint();
          }
        },
      });
    });

    el.addEventListener("input", clearHint);
  },

  _initCustomerSelect() {
    const wrap = document.getElementById("f-party-wrap");
    if (!wrap) return;

    const trigger  = document.getElementById("f-party-trigger");
    const dropdown = document.getElementById("f-party-dropdown");
    const display  = document.getElementById("f-party-display");
    const hidden   = document.getElementById("f-party-name");
    const searchEl = document.getElementById("f-party-search");
    const optsWrap = document.getElementById("f-party-opts");
    const noResults = document.getElementById("f-party-no-results");

    const open = () => {
      dropdown.classList.add("ca-cust-open");
      trigger.setAttribute("aria-expanded", "true");
      if (searchEl) { searchEl.value = ""; this._filterCustomers(""); searchEl.focus(); }
    };
    const close = () => {
      dropdown.classList.remove("ca-cust-open");
      trigger.setAttribute("aria-expanded", "false");
    };

    trigger.addEventListener("click", () => dropdown.classList.contains("ca-cust-open") ? close() : open());
    trigger.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dropdown.classList.contains("ca-cust-open") ? close() : open(); }
      if (e.key === "Escape") close();
    });

    if (searchEl) {
      searchEl.addEventListener("input", () => this._filterCustomers(searchEl.value));
      searchEl.addEventListener("click", e => e.stopPropagation());
      searchEl.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    }

    document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });

    dropdown.addEventListener("click", e => {
      const opt = e.target.closest(".ca-cust-opt");
      if (!opt) return;

      if (opt.id === "btn-add-customer") {
        close();
        this._openAddCustomerModal();
        return;
      }

      hidden.value = opt.dataset.id;
      display.textContent = opt.dataset.label;
      display.classList.add("ca-cust-selected");
      trigger.classList.remove("ca-input-error");
      this._partyNameStatus = "prefilled";
      close();
    });
  },

  _filterCustomers(query) {
    const optsWrap  = document.getElementById("f-party-opts");
    const noResults = document.getElementById("f-party-no-results");
    if (!optsWrap) return;
    const q = (query || "").toLowerCase().trim();
    const opts = optsWrap.querySelectorAll(".ca-cust-opt");
    let visible = 0;
    opts.forEach(opt => {
      const match = !q
        || (opt.dataset.label || "").toLowerCase().includes(q)
        || (opt.dataset.id   || "").toLowerCase().includes(q);
      opt.style.display = match ? "" : "none";
      if (match) visible++;
    });
    if (noResults) noResults.style.display = visible === 0 ? "block" : "none";
  },

  _openAddCustomerModal() {
    const modal      = document.getElementById("ca-add-customer-modal");
    if (!modal) return;
    const nameInput  = document.getElementById("ca-new-cust-name");
    const typeSelect = document.getElementById("ca-new-cust-type");
    const errDiv     = document.getElementById("ca-new-cust-error");
    const successDiv = document.getElementById("ca-new-cust-success");
    const successMsg = document.getElementById("ca-new-cust-success-msg");
    const btnOk      = document.getElementById("ca-add-cust-submit");
    const btnCancel  = document.getElementById("ca-add-cust-cancel");

    nameInput.value = "";
    if (typeSelect) typeSelect.value = "Individual";
    errDiv.style.display = "none";
    successDiv.style.display = "none";
    const _noteEl = document.getElementById("ca-new-cust-success-note");
    if (_noteEl) { _noteEl.style.display = "none"; _noteEl.textContent = ""; }
    nameInput.classList.remove("ca-input-error");
    modal.style.display = "flex";
    setTimeout(() => nameInput.focus(), 80);

    const showErr = msg => {
      errDiv.textContent = msg;
      errDiv.style.display = "block";
      successDiv.style.display = "none";
      nameInput.classList.add("ca-input-error");
    };
    const clearErr = () => {
      errDiv.style.display = "none";
      nameInput.classList.remove("ca-input-error");
    };

    nameInput.oninput = clearErr;
    btnCancel.onclick = () => { modal.style.display = "none"; };
    modal.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

    const doCreate = (force) => {
      const name = nameInput.value.trim();
      const type = typeSelect ? typeSelect.value : "Individual";

      btnOk.disabled = true;
      btnOk.innerHTML = '<span class="ca-spinner"></span> Creating…';
      errDiv.style.display = "none";

      frappe.call({
        method: "courier_app.api.shipment_api.create_customer_from_portal",
        args: { customer_name: name, customer_type: type, force: force ? 1 : 0 },
        callback: r => {
          btnOk.disabled = false;
          btnOk.textContent = "Create & Select";

          if (r.exc || !r.message) {
            let msg = "Failed to create customer. Please try again.";
            try {
              const raw = JSON.parse(r._server_messages || "[]");
              if (raw.length) msg = (JSON.parse(raw[0]).message || msg).replace(/<[^>]*>/g, "");
            } catch (_) {}
            showErr(msg);
            return;
          }

          if (r.message.duplicate_warning) {
            this._showPartyWarnPortal(name, () => doCreate(true));
            return;
          }

          const { name: custId, customer_name: custName, note } = r.message;

          // Show success state briefly, then close and select
          successMsg.textContent = `"${custName}" created and selected`;
          const noteEl = document.getElementById("ca-new-cust-success-note");
          if (noteEl) {
            if (note) { noteEl.textContent = note; noteEl.style.display = ""; }
            else { noteEl.style.display = "none"; noteEl.textContent = ""; }
          }
          successDiv.style.display = "flex";
          btnOk.style.display = "none";
          btnCancel.textContent = "Close";

          // Insert new option into the opts list (above "+ Add Customer")
          const optsWrap = document.getElementById("f-party-opts");
          const newOpt = document.createElement("div");
          newOpt.className = "ca-cust-opt";
          newOpt.setAttribute("role", "option");
          newOpt.dataset.id    = custId;
          newOpt.dataset.label = custName;
          newOpt.innerHTML = `<span class="ca-cust-opt-name">${custName}</span><span class="ca-cust-opt-id">${custId}</span>`;
          if (optsWrap) optsWrap.appendChild(newOpt);

          // Auto-select the new customer in the dropdown
          document.getElementById("f-party-name").value = custId;
          const dispEl = document.getElementById("f-party-display");
          dispEl.textContent = custName;
          dispEl.classList.add("ca-cust-selected");
          document.getElementById("f-party-trigger").classList.remove("ca-input-error");
          this._partyNameStatus = "prefilled";

          setTimeout(() => {
            modal.style.display = "none";
            btnOk.style.display = "";
            btnCancel.textContent = "Cancel";
            successDiv.style.display = "none";
            if (noteEl) { noteEl.style.display = "none"; noteEl.textContent = ""; }
          }, 1200);
        },
        error: () => {
          btnOk.disabled = false;
          btnOk.textContent = "Create & Select";
          showErr("Failed to create customer. Please try again.");
        },
      });
    };

    const submit = () => {
      const name = nameInput.value.trim();
      if (!name) { showErr("Customer name is required"); return; }
      if (name.length < 2) { showErr("Name must be at least 2 characters"); return; }
      doCreate(false);
    };

    btnOk.onclick = submit;
    nameInput.onkeydown = e => { if (e.key === "Enter") submit(); };
  },

  _showPartyWarnPortal(partyName, onConfirm) {
    let modal = document.getElementById("ca-party-warn-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "ca-party-warn-modal";
      modal.className = "ca-modal-backdrop";
      modal.innerHTML = `
<div class="ca-modal">
  <div class="ca-modal-icon ca-modal-icon-warn">
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 12v7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="16" cy="23" r="1.5" fill="currentColor"/><path d="M13.27 5.5a3 3 0 015.46 0l10.4 19A3 3 0 0126.4 29H5.6a3 3 0 01-2.73-4.5l10.4-19z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
  </div>
  <h2 style="font-size:18px;margin:0 0 10px">Name already exists</h2>
  <p id="ca-party-warn-msg" style="font-size:13.5px;color:var(--ca-sub);margin:0 0 24px;line-height:1.5"></p>
  <div class="ca-modal-actions" style="display:flex;gap:10px;justify-content:center">
    <button class="ca-btn ca-btn-ghost"   id="ca-party-warn-cancel">Change name</button>
    <button class="ca-btn ca-btn-primary" id="ca-party-warn-confirm">Continue anyway</button>
  </div>
</div>`;
      document.body.appendChild(modal);
    }
    modal.querySelector("#ca-party-warn-msg").textContent =
      `A customer named "${partyName}" already exists in the system. Consider using a slightly different name to avoid confusion.`;
    modal.style.display = "flex";
    modal.querySelector("#ca-party-warn-confirm").onclick = () => { modal.style.display = "none"; onConfirm(); };
    modal.querySelector("#ca-party-warn-cancel").onclick  = () => { modal.style.display = "none"; };
    modal.onclick = e => { if (e.target === modal) modal.style.display = "none"; };
  },

  validateForm() {
    document.querySelectorAll(".ca-input-error").forEach(el => el.classList.remove("ca-input-error"));
    const errors = [];
    let firstErr = null;

    const _fail = (el, msg) => {
      if (el) el.classList.add("ca-input-error");
      if (!firstErr) firstErr = el;
      errors.push(msg);
    };

    // Party name: handle both text input (web user) and custom select (desk user)
    const partyInput   = document.getElementById("f-party-name");
    const partyTrigger = document.getElementById("f-party-trigger");
    if (!partyInput || !partyInput.value.trim()) {
      if (partyTrigger) {
        partyTrigger.classList.add("ca-input-error");
        if (!firstErr) firstErr = partyTrigger;
      } else {
        _fail(partyInput, "Party/Client Full Name is required");
      }
      errors.push("Party/Client Full Name is required");
    }

    const textFields = [
      ["f-sender-name",    "Sender name"],
      ["f-sender-phone",   "Sender phone"],
      ["f-sender-addr1",   "Sender address"],
      ["f-sender-city",    "Sender city"],
      ["f-recipient-name", "Recipient name"],
      ["f-recipient-phone","Recipient phone"],
      ["f-recipient-addr1","Recipient address"],
      ["f-recipient-city", "Recipient city"],
    ];
    for (const [id, label] of textFields) {
      const el = document.getElementById(id);
      if (!el || !el.value.trim()) _fail(el, `${label} is required`);
    }

    const countryFields = [
      ["f-sender-country",    "ca-combo-sender-country",    "Sender country"],
      ["f-recipient-country", "ca-combo-recipient-country", "Recipient country"],
    ];
    for (const [hidId, wrapId, label] of countryFields) {
      const hid  = document.getElementById(hidId);
      const txtEl = document.getElementById(wrapId)?.querySelector(".ca-combo-input");
      if (!hid || !hid.value.trim()) _fail(txtEl, `${label} is required`);
    }

    if (!this.packages.some(p => parseFloat(p.weight) > 0)) {
      errors.push("At least one package with weight is required");
    }

    if (errors.length) {
      this.showErrorModal(
        "Required fields missing",
        "Please fill in all required fields before booking your shipment.",
        errors
      );
      if (firstErr) setTimeout(() => firstErr.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
      return false;
    }
    return true;
  },

  /* ── RESET ────────────────────────────────────────────────────────────── */
  bindReset() {
    document.getElementById("btn-reset-form").addEventListener("click", () => {
      const shipmentSaved = document.getElementById("rate-inv-btns")?.style.display !== "none";
      if (!shipmentSaved && !confirm("Reset all form fields?")) return;
      const rateInvBtns = document.getElementById("rate-inv-btns");
      if (rateInvBtns) rateInvBtns.style.display = "none";
      const rateInvoiceBar = document.getElementById("rate-invoice-bar");
      if (rateInvoiceBar) rateInvoiceBar.style.display = "none";
      // Restore Book Shipment button & clear saved ID
      const submitBtn = document.getElementById("btn-submit-shipment");
      if (submitBtn) submitBtn.style.display = "";
      this._savedShipmentId = null;
      const msi = document.getElementById("modal-shipment-id");
      if (msi) msi.textContent = "—";
      document.getElementById("shipment-form").reset();

      // Restore locked party name (web user) or reset customer select (desk user)
      const partyEl = document.getElementById("f-party-name");
      if (partyEl && partyEl.dataset.lockedValue) {
        partyEl.value = partyEl.dataset.lockedValue;
        this._partyNameStatus = "prefilled";
      }
      const partyWrap = document.getElementById("f-party-wrap");
      if (partyWrap) {
        partyEl.value = "";
        const disp = document.getElementById("f-party-display");
        disp.textContent = "— Select a customer —";
        disp.classList.remove("ca-cust-selected");
        document.getElementById("f-party-trigger").classList.remove("ca-input-error");
        this._partyNameStatus = "prefilled";
      }

      // Reset combos
      [this._comboSenderCountry, this._comboRecipientCountry,
       this._comboSenderCity,    this._comboRecipientCity].forEach(c => c && c.reset());
      if (this._comboSenderCity)    this._comboSenderCity.setItems([]);
      if (this._comboRecipientCity) this._comboRecipientCity.setItems([]);

      // Reset state selects
      ["f-sender-state", "f-recipient-state"].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
          sel.innerHTML = '<option value="">— Select country first —</option>';
          sel.disabled = true;
        }
      });

      // Reset service to prompt
      document.getElementById("f-service").value = "";

      // Reset billing radios to defaults
      document.querySelectorAll('input[name="ca-bill-transport"]').forEach(r => {
        r.checked = r.value === "My Account";
      });
      document.getElementById("f-bill-transport").value = "My Account";
      document.querySelectorAll('input[name="ca-bill-duties"]').forEach(r => {
        r.checked = r.value === "Recipient";
      });
      document.getElementById("f-bill-duties").value = "Recipient";

      // Reset shipment type to Outbound
      document.querySelectorAll(".ca-tab").forEach(b => b.classList.remove("active"));
      const outboundTab = document.querySelector('.ca-tab[data-type="Outbound"]');
      if (outboundTab) outboundTab.classList.add("active");
      document.getElementById("f-shipment-type").value = "Outbound";
      this._applyShipmentType("Outbound");

      // Reset packaging type to default
      document.getElementById("f-packaging").value = "Others";

      // Reset packages
      this.packages  = [{ id: 1, weight: "", unit: "kg", l: "", w: "", h: "", desc: "", actual_weight: "", amount: "" }];
      this.nextPkgId = 2;
      this.renderPackages();

      // Reset commodities
      this.commodities      = [{ id: 1, units: "", uom: "Kg", desc: "", hs_code: "", price: "", amount: "" }];
      this.nextCommodityId  = 2;
      this.renderCommodities();
      this.setDefaults();
      document.getElementById("rate-number").textContent  = "—";
      document.getElementById("rate-country").textContent = "—";
      const rzEl = document.getElementById("rate-zone");
      if (rzEl) rzEl.textContent = "—";
      const rnEl = document.getElementById("rate-note");
      if (rnEl) rnEl.textContent = "";
      const compEl = document.getElementById("rate-comparison");
      if (compEl) compEl.innerHTML = '<div class="ca-rate-hint">Fill in destination country and package weight to see rates</div>';
      const selEl = document.getElementById("rate-selected");
      if (selEl) selEl.style.display = "none";
      const liveBadge = document.getElementById("rate-live-badge");
      if (liveBadge) liveBadge.style.display = "none";
      const swEl = document.getElementById("summary-weight");
      if (swEl) swEl.textContent = "—";
      this._lastProviders    = null;
      this._selectedProvider = null;
      this.updateRatePkgRows();
    });
  },

  /* ── MODAL ────────────────────────────────────────────────────────────── */
  bindModal() {
    document.getElementById("btn-new-shipment").addEventListener("click", () => {
      document.getElementById("success-modal").style.display = "none";
      document.getElementById("btn-reset-form").click();
    });
    document.getElementById("btn-close-modal").addEventListener("click", () => {
      document.getElementById("success-modal").style.display = "none";
    });
    document.getElementById("success-modal").addEventListener("click", e => {
      if (e.target === document.getElementById("success-modal"))
        document.getElementById("success-modal").style.display = "none";
    });

    const closeErr = () => { document.getElementById("error-modal").style.display = "none"; };
    document.getElementById("btn-close-error-modal").addEventListener("click", closeErr);
    document.getElementById("error-modal").addEventListener("click", e => {
      if (e.target === document.getElementById("error-modal")) closeErr();
    });
  },

  /* ── TRACKING ─────────────────────────────────────────────────────────── */
  bindTrack() {
    const btn = document.getElementById("btn-track");
    const inp = document.getElementById("track-input");
    if (!btn || !inp) return;
    btn.addEventListener("click", () => this.doTrack());
    inp.addEventListener("keydown", e => { if (e.key === "Enter") this.doTrack(); });
  },

  doTrack() {
    const num      = document.getElementById("track-input").value.trim();
    const resultEl = document.getElementById("track-result");
    if (!num) { this.toast("Enter a tracking number", "error"); return; }
    resultEl.innerHTML = '<div class="ca-rate-hint">Looking up…</div>';
    frappe.call({
      method: "courier_app.api.shipment_api.track_shipment",
      args: { tracking_number: num },
      callback: r => {
        const d = r.message || {};
        if (!d.found) {
          resultEl.innerHTML = '<div class="ca-track-not-found">No shipment found with this tracking number.</div>';
          return;
        }
        const _cmap = {Blue:{bg:"#dbeafe",c:"#1d4ed8"},Green:{bg:"#d1fae5",c:"#065f46"},Yellow:{bg:"#fef3c7",c:"#92400e"},Orange:{bg:"#fff7ed",c:"#c2410c"},Purple:{bg:"#ede9fe",c:"#5b21b6"},Red:{bg:"#fee2e2",c:"#991b1b"},Gray:{bg:"#f1f5f9",c:"#475569"},Teal:{bg:"#ccfbf1",c:"#0f766e"},Cyan:{bg:"#e0f2fe",c:"#0369a1"},Pink:{bg:"#fce7f3",c:"#9d174d"}};
        const _sm = (d._status_meta || {})[d.status];
        const _sc = _cmap[(_sm && _sm.color) || "Gray"] || _cmap.Gray;
        const _badgeStyle = `background:${_sc.bg};color:${_sc.c};padding:3px 12px;border-radius:100px;font-size:12px;font-weight:600;white-space:nowrap`;
        resultEl.innerHTML = `
          <div class="ca-track-found">
            <div class="ca-track-found-header">
              <strong style="font-size:15px">${d.name}</strong>
              <span class="ca-status-badge" style="${_badgeStyle}">${d.status}</span>
            </div>
            <div class="ca-track-grid">
              <div class="ca-track-item"><span class="tk-label">Service</span><span class="tk-val">${d.service || "—"}</span></div>
              <div class="ca-track-item"><span class="tk-label">Recipient</span><span class="tk-val">${d.recipient_name || "—"}</span></div>
              <div class="ca-track-item"><span class="tk-label">Destination</span><span class="tk-val">${d.recipient_city || ""} ${d.recipient_country || ""}</span></div>
              <div class="ca-track-item"><span class="tk-label">Ship date</span><span class="tk-val">${this.formatDate(d.ship_date)}</span></div>
              <div class="ca-track-item"><span class="tk-label">Est. delivery</span><span class="tk-val">${this.formatDate(d.estimated_delivery)}</span></div>
              <div class="ca-track-item"><span class="tk-label">Weight</span><span class="tk-val">${d.total_weight ? d.total_weight.toFixed(3) + " kg" : "—"}</span></div>
            </div>
          </div>`;
      }
    });
  },

  /* ── TOAST ────────────────────────────────────────────────────────────── */
  toast(msg, type = "info") {
    document.querySelectorAll(".ca-toast").forEach(e => e.remove());
    const el = document.createElement("div");
    el.className = `ca-toast${type === "error" ? " ca-toast-error" : ""}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  },

  /* ── GLOBAL ERROR HANDLING ────────────────────────────────────────────── */
  /**
   * Intercepts Frappe's own alert / msgprint system and unhandled Promise
   * rejections so that any error that reaches the page surface appears in
   * our styled error modal instead of an invisible toast or browser console.
   */
  _initErrorHandling() {
    const _self = this;

    // Helper: strip HTML and normalise whitespace
    const _clean = s => (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // ── Intercept frappe.msgprint ──────────────────────────────────────────
    // Frappe's bundle calls this for server-side errors (PermissionError,
    // ValidationError, "Invalid Request", etc.)
    const _origMsgprint = frappe.msgprint;
    frappe.msgprint = function(opts) {
      const text  = typeof opts === "string" ? _clean(opts) : _clean(opts && (opts.message || opts.msg));
      const title = (typeof opts === "object" && opts && opts.title) || "Notice";
      const ind   = (typeof opts === "object" && opts && opts.indicator) || "";

      const isError = ind === "red" || ind === "danger" ||
                      text.toLowerCase().includes("error")   ||
                      text.toLowerCase().includes("invalid") ||
                      text.toLowerCase().includes("permission") ||
                      text.toLowerCase().includes("not allowed");

      if (text && isError) {
        _self.showErrorModal(title, text, []);
      } else {
        _origMsgprint.call(this, opts);
      }
    };

    // ── Intercept frappe.show_alert ────────────────────────────────────────
    // Frappe uses this for inline error banners and permission notices
    const _origShowAlert = frappe.show_alert;
    frappe.show_alert = function(opts, seconds) {
      const text = typeof opts === "string" ? _clean(opts) : _clean(opts && (opts.message || opts.msg));
      const ind  = (typeof opts === "object" && opts && opts.indicator) || "blue";

      if ((ind === "red" || ind === "danger") && text) {
        _self.showErrorModal("Error", text, []);
      } else {
        _origShowAlert.call(this, opts, seconds);
      }
    };

    // ── Unhandled Promise rejections (fetch failures, unexpected errors) ───
    window.addEventListener("unhandledrejection", ev => {
      const reason = ev.reason;
      if (!reason) return;
      const msg = (reason instanceof Error ? reason.message : String(reason)) || "";
      // Ignore AbortErrors and cancelled fetch (these are intentional)
      if (/abort|cancel|user/i.test(msg)) return;
      // Ignore minor errors like ResizeObserver loop
      if (/resizeobserver/i.test(msg)) return;
      _self.showErrorModal("Unexpected Error", msg || "An unexpected error occurred. Please refresh the page and try again.", []);
      ev.preventDefault();
    });

    // ── Global uncaught JS errors (only our own scripts) ──────────────────
    const _origOnerror = window.onerror;
    window.onerror = function(msg, src, line, col, err) {
      if (src && (src.includes("portal.js") || src.includes("shipment_form.js"))) {
        const errMsg = (err && err.message) || String(msg) || "A script error occurred.";
        _self.showErrorModal("Script Error", errMsg, [`Source: ${src}:${line}`]);
      }
      if (typeof _origOnerror === "function") return _origOnerror(msg, src, line, col, err);
    };
  },
};

document.addEventListener("DOMContentLoaded", () => CA.init());
