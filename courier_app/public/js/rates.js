"use strict";
/* ── CourierApp Rate Calculator ───────────────────────────────────────────── */

const RC = {
  _searchTimer: null,
  _comboOpen:   false,
  _comboItems:  [],
  _comboIdx:    -1,
  _lastResult:  null,
  _providers:   [],
  _selProvider: "",

  /* ── INIT ─────────────────────────────────────────────────────────────── */
  init() {
    this._initCombo();
    this._bindCalc();
    this._bindUnit();
    this._loadProviders();
    this._checkQueryParam();
  },

  /* ── PROVIDER SELECT ─────────────────────────────────────────────────── */
  _loadProviders() {
    frappe.call({
      method: "courier_app.api.shipment_api.get_calculator_providers",
      callback: r => {
        this._providers = r.message || [];
        const sel = document.getElementById("rc-provider-sel");
        if (!sel) return;
        this._providers.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.name;
          opt.textContent = p.provider_name;
          sel.appendChild(opt);
        });
      }
    });
  },

  _getSelectedProvider() {
    return document.getElementById("rc-provider-sel")?.value || "";
  },

  /* ── COUNTRY COMBO (all providers) ───────────────────────────────────── */
  _initCombo() {
    const txt = document.getElementById("rc-country-txt");
    if (!txt) return;

    txt.addEventListener("input", () => {
      clearTimeout(this._searchTimer);
      const q = txt.value.trim();
      if (q.length < 1) { this._closeCombo(); return; }
      this._searchTimer = setTimeout(() => this._searchCountries(q), 220);
    });

    txt.addEventListener("focus", () => {
      if (txt.value.trim().length >= 1) this._searchCountries(txt.value.trim());
    });

    txt.addEventListener("keydown", e => {
      if (!this._comboOpen) return;
      if (e.key === "ArrowDown")  { e.preventDefault(); this._comboMove(1); }
      if (e.key === "ArrowUp")    { e.preventDefault(); this._comboMove(-1); }
      if (e.key === "Enter")      { e.preventDefault(); this._comboSelect(this._comboIdx); }
      if (e.key === "Escape")     { this._closeCombo(); }
    });

    document.addEventListener("click", e => {
      if (!document.getElementById("rc-combo-wrap")?.contains(e.target)) this._closeCombo();
    });
  },

  _searchCountries(q) {
    frappe.call({
      method: "courier_app.api.shipment_api.get_countries_for_calc",
      args: { query: q },
      callback: r => {
        this._comboItems = r.message || [];
        this._renderCombo();
      }
    });
  },

  _renderCombo() {
    const drop = document.getElementById("rc-combo-drop");
    if (!this._comboItems.length) {
      drop.innerHTML = '<div class="rc-combo-empty">No matching countries</div>';
      drop.style.display = "block";
      this._comboOpen = true;
      return;
    }
    this._comboIdx = -1;
    drop.innerHTML = this._comboItems.map((c, i) => `
      <div class="rc-combo-item" data-idx="${i}">
        <span class="rc-combo-name">${c.country_name}</span>
        <span class="rc-combo-code">${c.country_code}</span>
      </div>`).join("");
    drop.querySelectorAll(".rc-combo-item").forEach(el => {
      el.addEventListener("mousedown", e => {
        e.preventDefault();
        this._comboSelect(+el.dataset.idx);
      });
    });
    drop.style.display = "block";
    this._comboOpen = true;
  },

  _comboMove(dir) {
    const drop  = document.getElementById("rc-combo-drop");
    const items = drop.querySelectorAll(".rc-combo-item");
    if (!items.length) return;
    this._comboIdx = Math.max(-1, Math.min(items.length - 1, this._comboIdx + dir));
    items.forEach((el, i) => el.classList.toggle("hovered", i === this._comboIdx));
    if (this._comboIdx >= 0) items[this._comboIdx].scrollIntoView({ block: "nearest" });
  },

  _comboSelect(idx) {
    if (idx < 0 || idx >= this._comboItems.length) return;
    const c = this._comboItems[idx];
    document.getElementById("rc-country-txt").value = c.country_name;
    document.getElementById("rc-country-val").value = c.country_name;
    this._closeCombo();
  },

  _closeCombo() {
    const drop = document.getElementById("rc-combo-drop");
    if (drop) drop.style.display = "none";
    this._comboOpen = false;
    this._comboIdx  = -1;
  },

  /* ── UNIT TOGGLE ──────────────────────────────────────────────────────── */
  _bindUnit() {
    document.getElementById("rc-unit")?.addEventListener("change", e => {
      const weightEl = document.getElementById("rc-weight");
      const val = parseFloat(weightEl.value);
      if (!val) return;
      weightEl.value = e.target.value === "lbs"
        ? (val * 2.20462).toFixed(2)
        : (val / 2.20462).toFixed(2);
    });
  },

  /* ── CALCULATE ────────────────────────────────────────────────────────── */
  _bindCalc() {
    document.getElementById("rc-btn-calc")?.addEventListener("click", () => this.calculate());
    document.getElementById("rc-weight")?.addEventListener("keydown", e => {
      if (e.key === "Enter") this.calculate();
    });
  },

  _checkQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const country = params.get("country");
    const weight  = params.get("weight");
    if (country) {
      document.getElementById("rc-country-txt").value = country;
      document.getElementById("rc-country-val").value = country;
    }
    if (weight) {
      document.getElementById("rc-weight").value = weight;
    }
    if (country && weight) {
      setTimeout(() => this.calculate(), 400);
    }
  },

  calculate() {
    this._clearError();
    const country    = document.getElementById("rc-country-val")?.value || document.getElementById("rc-country-txt")?.value?.trim();
    const weightRaw  = parseFloat(document.getElementById("rc-weight")?.value);
    const unit       = document.getElementById("rc-unit")?.value || "kg";
    const provider   = this._getSelectedProvider();

    if (!country)              { this._showError("Please select a destination country"); return; }
    if (!weightRaw || weightRaw <= 0) { this._showError("Please enter a valid parcel weight"); return; }

    const weightKg = unit === "lbs" ? weightRaw / 2.20462 : weightRaw;

    const btn = document.getElementById("rc-btn-calc");
    btn.classList.add("loading");
    btn.innerHTML = '<span class="rc-spinner"></span> Calculating…';

    const calcIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M5 8h6M9 5.5l2.5 2.5L9 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Calculate Rate`;

    frappe.call({
      method: "courier_app.api.shipment_api.get_rates_all_providers",
      args: { country, weight: weightKg.toFixed(4) },
      callback: r => {
        btn.classList.remove("loading");
        btn.innerHTML = calcIcon;
        const res = r.message || {};
        if (res.error) { this._showError(res.error); return; }
        if (!res.rates || !res.rates.length) { this._showError("No rates available for this destination."); return; }

        /* filter by provider if one is selected */
        let rates = res.rates;
        if (provider) {
          rates = rates.filter(rt => rt.provider_id === provider || rt.provider_name === provider);
          if (!rates.length) { this._showError("No rates for selected provider / destination combination."); return; }
        }

        this._lastResult = { ...res, rates };
        this._renderComparison({ ...res, rates }, weightKg, unit, weightRaw);
      },
      error: () => {
        btn.classList.remove("loading");
        btn.innerHTML = calcIcon;
        this._showError("Failed to fetch rates. Please try again.");
      }
    });
  },

  /* ── RENDER ALL-PROVIDER COMPARISON ──────────────────────────────────── */
  _renderComparison(res, weightKg, unit, weightRaw) {
    const wrap    = document.getElementById("rc-comparison-wrap");
    const sumBar  = document.getElementById("rc-summary-bar");
    const results = document.getElementById("rc-results");
    const provider = this._getSelectedProvider();
    const wDisplay = unit === "lbs"
      ? `${weightRaw.toFixed(2)} lbs (${weightKg.toFixed(3)} kg)`
      : `${weightKg.toFixed(3)} kg`;

    const filteredRates = res.rates;

    /* summary bar */
    const provName = provider
      ? (this._providers.find(p => p.name === provider)?.provider_name || provider)
      : null;
    const provPart = provName
      ? `<div class="rc-sum-sep"></div>
<div class="rc-sum-item">
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 2V1M9 2V1M1 5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
  <span>${provName}</span>
</div>` : "";

    sumBar.innerHTML = `
<div class="rc-sum-item">
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 6.5h11M6.5 1c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5M6.5 1c1.5 2 2 3.5 2 5.5S8 10 6.5 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
  <span>${filteredRates[0]?.country_name || res.country}</span>
</div>
<div class="rc-sum-sep"></div>
<div class="rc-sum-item">
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 9.5h9L9.5 5H3.5L2 9.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 5c0-1.1.9-2 2-2s2 .9 2 2" stroke="currentColor" stroke-width="1.3"/></svg>
  <span>${wDisplay}</span>
</div>
${provPart}
<div class="rc-sum-sep"></div>
<div class="rc-sum-item">
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 2V1M9 2V1M1 5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
  <span>${filteredRates.length} provider${filteredRates.length !== 1 ? "s" : ""}</span>
</div>`;

    /* comparison table */
    const rows = res.rates.map((r, i) => {
      const isBest = i === 0;
      return `
<tr class="${isBest ? "rc-cmp-best" : ""}">
  <td>
    <div class="rc-cmp-provider">${r.provider_name}${isBest ? ' <span class="rc-best-badge">Best</span>' : ""}</div>
    <div class="rc-cmp-code">${r.provider_code}</div>
  </td>
  <td><span class="rc-zone-badge">Zone ${r.zone_code}</span>${r.zone_label ? ` <span class="rc-zone-lbl">${r.zone_label}</span>` : ""}</td>
  <td class="rc-cmp-rate">PKR <strong>${Math.round(r.rate).toLocaleString()}</strong></td>
  <td>
    <button class="rc-detail-btn" data-idx="${i}">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 6h5M7 4l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Details
    </button>
  </td>
</tr>`;
    }).join("");

    wrap.innerHTML = `
<div class="rc-cmp-card">
  <div class="rc-cmp-header">
    <div class="rc-cmp-title">Rate Comparison — All Providers</div>
    <span class="rc-cmp-hint">Sorted cheapest first</span>
  </div>
  <div class="rc-cmp-table-wrap">
    <table class="rc-cmp-table">
      <thead>
        <tr><th>Provider</th><th>Zone</th><th>Rate (PKR)</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;

    /* bind detail buttons */
    wrap.querySelectorAll(".rc-detail-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = +btn.dataset.idx;
        this._showProviderDetail(res.rates[idx], weightKg, unit, weightRaw);
      });
    });

    /* show results */
    results.style.display = "block";
    document.getElementById("rc-detail-grid").style.display = "none";
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  /* ── SHOW DETAIL FOR ONE PROVIDER ────────────────────────────────────── */
  _showProviderDetail(rate, weightKg, unit, weightRaw) {
    /* fetch slab table for this provider */
    frappe.call({
      method: "courier_app.api.shipment_api.get_zone_rate_table",
      args: { country: rate.country_name, service_provider: rate.provider_id },
      callback: r => {
        const t = r.message || {};
        const wDisplay = unit === "lbs"
          ? `${weightRaw.toFixed(2)} lbs (${weightKg.toFixed(3)} kg)`
          : `${weightKg.toFixed(3)} kg`;

        /* result card */
        document.getElementById("rc-result-card").innerHTML = `
<div class="rc-result-header">
  <div class="rc-result-label">Estimated Rate — ${rate.provider_name}</div>
  <div class="rc-result-rate">PKR <span>${Math.round(rate.rate).toLocaleString()}</span></div>
</div>
<div class="rc-result-meta">
  <div class="rc-meta-row">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 6.5h11M6.5 1c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5M6.5 1c1.5 2 2 3.5 2 5.5S8 10 6.5 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    <span class="rc-meta-key">Destination</span>
    <span class="rc-meta-val">${rate.country_name}</span>
  </div>
  <div class="rc-meta-row">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="9" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M4 2V1M9 2V1M1 5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    <span class="rc-meta-key">Provider</span>
    <span class="rc-meta-val">${rate.provider_name} <span class="rc-cmp-code">${rate.provider_code}</span></span>
  </div>
  <div class="rc-meta-row">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 9.5h9L9.5 5H3.5L2 9.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 5c0-1.1.9-2 2-2s2 .9 2 2" stroke="currentColor" stroke-width="1.3"/></svg>
    <span class="rc-meta-key">Weight</span>
    <span class="rc-meta-val">${wDisplay}</span>
  </div>
  <div class="rc-meta-row">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1L1.5 3.5v5l5 2.5 5-2.5v-5L6.5 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
    <span class="rc-meta-key">Zone</span>
    <span class="rc-meta-val"><span class="rc-zone-badge">Zone ${rate.zone_code}</span>${rate.zone_label ? ` · ${rate.zone_label}` : ""}</span>
  </div>
${rate.note ? `<div class="rc-meta-note"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 6v3M6.5 4v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>${rate.note}</div>` : ""}
</div>`;

        /* slab table */
        if (t && t.slabs && t.slabs.length) {
          const rows = t.slabs.map((s, i) => {
            const isPerKg = s.is_per_kg_above_max;
            const label   = isPerKg
              ? `Above ${t.slabs[i - 1]?.max_weight_kg || "—"} kg`
              : `Up to ${s.max_weight_kg} kg`;
            const rateCell = isPerKg
              ? `PKR ${s.rate.toLocaleString(undefined, {minimumFractionDigits:2})} / kg extra`
              : `PKR ${Math.round(s.rate).toLocaleString()}`;

            let isActive = false;
            if (!isPerKg) {
              const prevMax = t.slabs.slice(0, i).filter(x => !x.is_per_kg_above_max).at(-1)?.max_weight_kg || 0;
              isActive = weightKg > prevMax && weightKg <= s.max_weight_kg;
            } else {
              const lastNormal = t.slabs.filter(x => !x.is_per_kg_above_max).at(-1);
              isActive = lastNormal ? weightKg > lastNormal.max_weight_kg : false;
            }

            return `<tr class="${isActive ? "rc-tbl-active" : ""}">
  <td>${label}</td>
  <td class="rc-tbl-rate">${rateCell}</td>
  <td class="rc-tbl-note">${isActive ? '<span class="rc-tbl-you">← your weight</span>' : ''}</td>
</tr>`;
          }).join("");

          document.getElementById("rc-table-panel").innerHTML = `
<div class="rc-table-header">
  <div class="rc-table-title">
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="13" height="13" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 5h7M4 7.5h7M4 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    Rate Table — Zone ${rate.zone_code}${rate.zone_label ? ` (${rate.zone_label})` : ""}
  </div>
  <span class="rc-table-country">${rate.country_name}</span>
</div>
<div class="rc-table-wrap">
  <table class="rc-table">
    <thead><tr><th>Weight</th><th>Rate (PKR)</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
        } else {
          document.getElementById("rc-table-panel").innerHTML = `
<div class="rc-table-empty">${t.error || "Rate table not available for this provider/zone."}</div>`;
        }

        document.getElementById("rc-detail-grid").style.display = "grid";
        document.getElementById("rc-detail-grid").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  },

  /* ── ERROR ────────────────────────────────────────────────────────────── */
  _showError(msg) {
    const el = document.getElementById("rc-inline-error");
    if (el) { el.textContent = msg; el.style.display = "flex"; }
  },
  _clearError() {
    const el = document.getElementById("rc-inline-error");
    if (el) { el.style.display = "none"; el.textContent = ""; }
  },
};

document.addEventListener("DOMContentLoaded", () => RC.init());
