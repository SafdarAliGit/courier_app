"use strict";
/* ── CourierApp Portal JS ─────────────────────────────────────────────────── */

const CA = {
  packages: [{ id: 1, weight: "", unit: "kg", l: "", w: "", h: "", desc: "", actual_weight: "", amount: "" }],
  nextPkgId: 2,
  rateDebounce: null,
  countries: [],
  _comboSenderCountry:    null,
  _comboRecipientCountry: null,
  _comboSenderCity:       null,
  _comboRecipientCity:    null,

  /* ── INIT ─────────────────────────────────────────────────────────────── */
  init() {
    this.setDefaults();
    this._initCountryCity();
    this._initServiceProvider();
    this._initServiceRadio();
    this.bindTabs();
    this.bindPackages();
    this.bindSubmit();
    this.bindReset();
    this.bindModal();
    this.bindPrintReceipt();
    this.renderPackages();
    this.bindTrack();
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
          if (providers.length === 1) sel.value = providers[0].name;
        }

        sel.addEventListener("change", () => this.scheduleRateCalc());
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
    frappe.call({
      method: "courier_app.api.shipment_api.get_countries",
      callback: r => {
        this.countries = (r.message || []).map(c => ({ value: c.name, label: c.country_name }));

        const _onCountrySelect = (which, val, label) => {
          const stateSelId  = `f-${which}-state`;
          const cityCombo   = which === "sender" ? this._comboSenderCity : this._comboRecipientCity;
          const stateEl     = document.getElementById(stateSelId);

          // Reset state & city
          if (stateEl) { stateEl.innerHTML = '<option value="">— Loading… —</option>'; stateEl.disabled = true; }
          if (cityCombo) cityCombo.setItems([]);

          if (!val) return;

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
          "ca-combo-sender-country", this.countries,
          (val, label) => _onCountrySelect("sender", val, label),
          { hiddenId: "f-sender-country" }
        );
        this._comboRecipientCountry = this._makeCombo(
          "ca-combo-recipient-country", this.countries,
          (val, label) => _onCountrySelect("recipient", val, label),
          { hiddenId: "f-recipient-country" }
        );
        this._comboSenderCity = this._makeCombo(
          "ca-combo-sender-city", [], null, { allowFreeText: true }
        );
        this._comboRecipientCity = this._makeCombo(
          "ca-combo-recipient-city", [], null, { allowFreeText: true }
        );
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
      bannerDesc:   "Standard outbound shipment — you pay, customer receives",
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
      bannerFrom:   "External",
      bannerArrow:  "←",
      bannerTo:     "You",
      bannerDesc:   "Incoming shipment — external party sends to your address",
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
      bannerDesc:   "Return shipment — customer sends goods back to your warehouse",
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
      document.getElementById("banner-desc").textContent  = cfg.bannerDesc;
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
      totalVal.textContent = "PKR " + Math.round(sum).toLocaleString();
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
              ? `PKR ${Math.round(pkgRates[i]).toLocaleString()}` : "—";
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
      const volKg = (l > 0 && w > 0 && h > 0) ? (weightKg * l * w * h) / 5000 : 0;
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
      const hasRate = rate != null && rate > 0;
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
        const volKg = (actualKg > 0 && l > 0 && w > 0 && h > 0) ? (actualKg * l * w * h) / 5000 : 0;
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

    const calls = pkgData.map(({ weightKg }) =>
      fetch("/api/method/courier_app.api.shipment_api.get_rates_all_providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Frappe-CSRF-Token": frappe.csrf_token || "fetch",
          "X-Frappe-CMD": "courier_app.api.shipment_api.get_rates_all_providers"
        },
        body: new URLSearchParams({ country, weight: weightKg.toFixed(3) }).toString()
      }).then(r => r.json()).then(d => ({ weightKg, rates: (d.message || {}).rates || [] }))
    );

    Promise.all(calls).then(results => {
      if (compEl) { compEl.innerHTML = ""; compEl.style.display = "none"; }

      // Aggregate rates per provider across all packages
      const provMap = {};
      results.forEach(({ weightKg, rates }) => {
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
        if (compEl) { compEl.style.display = "block"; compEl.innerHTML = '<div class="ca-rate-hint">No rates available for this destination</div>'; }
        if (selEl) selEl.style.display = "none";
        if (liveBadge) liveBadge.style.display = "none";
        this.updateRatePkgRows();
        return;
      }

      const cheapest = providers[0];
      const selected = serviceProvider
        ? (providers.find(p => p.provider_id === serviceProvider) || cheapest)
        : cheapest;

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
    const _v  = id => (document.getElementById(id)?.value || "").trim();
    const _t  = id => (document.getElementById(id)?.textContent || "").trim();
    const _ck = id => document.getElementById(id)?.checked;

    // Header
    const dateEl = document.getElementById("rct-date");
    if (dateEl) dateEl.textContent = "Printed: " + now;

    // Shipment details
    document.getElementById("rct-type").textContent     = _v("f-shipment-type") || "—";
    document.getElementById("rct-service").textContent  = _v("f-service") || "—";
    document.getElementById("rct-packaging").textContent= _v("f-packaging") || "—";
    document.getElementById("rct-ship-date").textContent= _t("summary-ship-date") || "—";
    document.getElementById("rct-delivery").textContent = _t("summary-delivery") || "—";
    document.getElementById("rct-ref").textContent      = _v("f-customer-ref") || "—";

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
      totalEl.textContent = prov ? `PKR ${Math.round(prov.total).toLocaleString()}` : "—";
    }

    window.print();
  },

  /* ── FORM SUBMIT ──────────────────────────────────────────────────────── */
  bindSubmit() {
    document.getElementById("btn-submit-shipment").addEventListener("click", () => this.submitShipment());
  },

  submitShipment() {
    if (!this.validateForm()) return;
    const btn = document.getElementById("btn-submit-shipment");
    btn.innerHTML = '<span class="ca-spinner"></span> Booking…';
    btn.disabled  = true;

    const payload = {
      shipment_type:           document.getElementById("f-shipment-type").value,
      ship_date:               document.getElementById("f-ship-date").value,
      service:                 document.getElementById("f-service").value,
      service_provider:        document.getElementById("f-service-provider")?.value || "",
      packaging_type:          document.getElementById("f-packaging").value,
      customer_reference:      document.getElementById("f-customer-ref").value,
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
    };

    frappe.call({
      method: "courier_app.api.shipment_api.submit_shipment",
      args: { data: JSON.stringify(payload) },
      callback: r => {
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Book shipment`;
        btn.disabled = false;
        const data = r.message || {};
        if (data.status === "success") {
          document.getElementById("modal-shipment-id").textContent = data.shipment_id;
          document.getElementById("modal-weight").textContent = (parseFloat(data.total_weight) || 0).toFixed(3) + " KG";
          document.getElementById("modal-rate-per-kg").textContent = "PKR " + Math.round(data.rate_per_kg || 0).toLocaleString();
          document.getElementById("modal-rate").textContent = "PKR " + Math.round(data.calculated_rate || 0).toLocaleString();
          // Update inline amount cells with server-confirmed values
          if (data.packages && data.packages.length) {
            const amtCells = document.querySelectorAll(".ca-pkg-amount");
            data.packages.forEach((pkg, i) => {
              const cell = amtCells[i];
              if (!cell) return;
              const amt = parseFloat(pkg.amount) || 0;
              cell.textContent = amt > 0 ? "PKR " + Math.round(amt).toLocaleString() : "—";
            });
          }
          document.getElementById("success-modal").style.display = "flex";
        }
      },
      error: () => {
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Book shipment`;
        btn.disabled = false;
      }
    });
  },

  validateForm() {
    document.querySelectorAll(".ca-input-error").forEach(el => el.classList.remove("ca-input-error"));
    let valid = true;
    let firstErr = null;

    const _fail = (el, msg) => {
      if (el) el.classList.add("ca-input-error");
      if (valid) { firstErr = el; this.toast(msg, "error"); }
      valid = false;
    };

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
      this.toast("At least one package with weight is required", "error");
      valid = false;
    }

    if (firstErr) firstErr.scrollIntoView({ behavior: "smooth", block: "center" });
    return valid;
  },

  /* ── RESET ────────────────────────────────────────────────────────────── */
  bindReset() {
    document.getElementById("btn-reset-form").addEventListener("click", () => {
      if (!confirm("Reset all form fields?")) return;
      document.getElementById("shipment-form").reset();

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
      document.getElementById("f-packaging").value = "Your Packaging";

      // Reset packages
      this.packages  = [{ id: 1, weight: "", unit: "kg", l: "", w: "", h: "", desc: "", actual_weight: "", amount: "" }];
      this.nextPkgId = 2;
      this.renderPackages();
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
        const statusClass = {
          "Delivered": "status-delivered",
          "In Transit": "status-in-transit",
          "Out for Delivery": "status-in-transit",
          "Pending": "status-pending",
          "Cancelled": "status-cancelled",
        }[d.status] || "status-default";
        resultEl.innerHTML = `
          <div class="ca-track-found">
            <div class="ca-track-found-header">
              <strong style="font-size:15px">${d.name}</strong>
              <span class="ca-status-badge ${statusClass}">${d.status}</span>
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
};

document.addEventListener("DOMContentLoaded", () => CA.init());
