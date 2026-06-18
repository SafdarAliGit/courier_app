/* ── Website JS ──────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  /* ── Mobile nav toggle ────────────────────────────────────────────────── */
  var ham = document.getElementById("wsite-hamburger");
  var navLinks = document.querySelector(".wsite-nav-links");
  if (ham && navLinks) {
    ham.addEventListener("click", function () {
      navLinks.classList.toggle("open");
      var bars = ham.querySelectorAll("span");
      bars.forEach(function (b) { b.style.background = navLinks.classList.contains("open") ? "#F0B429" : ""; });
    });
    navLinks.addEventListener("click", function (e) {
      if (e.target.tagName === "A") navLinks.classList.remove("open");
    });
  }

  /* ── Scroll reveal ────────────────────────────────────────────────────── */
  var reveals = document.querySelectorAll(".wsite-reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("visible"); });
  }

  /* ── Counter animation ────────────────────────────────────────────────── */
  function fmtStat(n) {
    if (n >= 1000000) {
      var m = n / 1000000;
      var s = m % 1 === 0 ? m.toFixed(0) : m.toFixed(1);
      return s + "M";
    }
    return Math.floor(n).toLocaleString();
  }
  function animateCounter(el, target, suffix, duration) {
    var start = 0;
    var step = target / (duration / 16);
    var timer = setInterval(function () {
      start = Math.min(start + step, target);
      el.textContent = fmtStat(start) + suffix;
      if (start >= target) clearInterval(timer);
    }, 16);
  }

  var statEls = document.querySelectorAll("[data-count]");
  if (statEls.length && "IntersectionObserver" in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var raw = el.dataset.count;
          var suffix = el.dataset.suffix || "";
          animateCounter(el, parseInt(raw, 10), suffix, 1400);
          cio.unobserve(el);
        }
      });
    }, { threshold: 0.4 });
    statEls.forEach(function (el) { cio.observe(el); });
  }

  /* ── Contact form ─────────────────────────────────────────────────────── */
  var form = document.getElementById("wsite-contact-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector(".wsite-submit-btn");
      var msg = document.getElementById("wsite-form-msg");
      btn.disabled = true;
      btn.textContent = "Sending…";
      if (msg) { msg.className = "wsite-form-msg"; msg.style.display = "none"; }

      var data = {
        full_name: (form.querySelector("#wf-name") || {}).value || "",
        email: (form.querySelector("#wf-email") || {}).value || "",
        phone: (form.querySelector("#wf-phone") || {}).value || "",
        subject: (form.querySelector("#wf-subject") || {}).value || "",
        message: (form.querySelector("#wf-message") || {}).value || ""
      };

      fetch("/api/method/courier_app.api.contact_api.submit_contact_form", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Frappe-CSRF-Token": (window.frappe && frappe.csrf_token) || "fetch"
        },
        body: new URLSearchParams(data).toString()
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          btn.textContent = "Send Message";
          if (res.message && res.message.success) {
            if (msg) { msg.className = "wsite-form-msg success"; msg.textContent = "Thank you! Your message has been sent. We will get back to you shortly."; }
            form.reset();
          } else {
            if (msg) { msg.className = "wsite-form-msg error"; msg.textContent = (res.message && res.message.error) || "Something went wrong. Please try again or email us directly."; }
          }
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = "Send Message";
          if (msg) { msg.className = "wsite-form-msg error"; msg.textContent = "Failed to send. Please email us directly."; }
        });
    });
  }

  /* ── Hero Carousel ────────────────────────────────────────────────────── */
  var heroCarousel = document.getElementById("wsite-hero-carousel");
  if (heroCarousel) {
    var hcSlides  = heroCarousel.querySelectorAll(".wsite-hc-slide");
    var hcDots    = heroCarousel.querySelectorAll(".wsite-hc-dot");
    var hcPrev    = heroCarousel.querySelector(".wsite-hc-arrow-prev");
    var hcNext    = heroCarousel.querySelector(".wsite-hc-arrow-next");
    var hcCurrent = 0;
    var hcTotal   = hcSlides.length;
    var hcInterval  = parseInt(heroCarousel.dataset.interval, 10) || 4000;
    var hcAutoPlay  = heroCarousel.dataset.autoplay !== "0";
    var hcTimer;

    function hcShow(idx, dir) {
      var nextIdx = (idx + hcTotal) % hcTotal;
      if (nextIdx === hcCurrent) return;

      var direction = dir || (nextIdx > hcCurrent ? "next" : "prev");
      /* Handle wrap-around direction correctly */
      if (idx >= hcTotal)  direction = "next";
      if (idx < 0)         direction = "prev";

      var outSlide = hcSlides[hcCurrent];
      var inSlide  = hcSlides[nextIdx];

      /* Mark outgoing slide as leaving */
      outSlide.classList.remove("active");
      outSlide.classList.add("hc-leaving", "hc-leave-" + direction);

      /* Position incoming slide off-screen instantly (no transition) */
      inSlide.classList.add("hc-enter-" + direction);
      inSlide.getBoundingClientRect(); /* force reflow */
      inSlide.classList.remove("hc-enter-next", "hc-enter-prev");
      inSlide.classList.add("active");

      /* Update dots */
      if (hcDots[hcCurrent]) hcDots[hcCurrent].classList.remove("active");
      hcCurrent = nextIdx;
      if (hcDots[hcCurrent]) hcDots[hcCurrent].classList.add("active");

      /* Clean up leaving classes after transition ends */
      var cleanup = outSlide;
      setTimeout(function () {
        cleanup.classList.remove("hc-leaving", "hc-leave-next", "hc-leave-prev");
      }, 1150);
    }

    function hcStart() {
      if (!hcAutoPlay || hcTotal < 2) return;
      hcTimer = setInterval(function () { hcShow(hcCurrent + 1); }, hcInterval);
    }

    function hcReset() { clearInterval(hcTimer); hcStart(); }

    if (hcPrev) hcPrev.addEventListener("click", function () { hcShow(hcCurrent - 1, "prev"); hcReset(); });
    if (hcNext) hcNext.addEventListener("click", function () { hcShow(hcCurrent + 1, "next"); hcReset(); });
    hcDots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        var t = parseInt(this.dataset.index, 10);
        hcShow(t, t > hcCurrent ? "next" : "prev");
        hcReset();
      });
    });

    var hcTouchX = 0;
    heroCarousel.addEventListener("touchstart", function (e) {
      hcTouchX = e.touches[0].clientX;
    }, { passive: true });
    heroCarousel.addEventListener("touchend", function (e) {
      var dx = hcTouchX - e.changedTouches[0].clientX;
      if (Math.abs(dx) > 40) {
        var swipeDir = dx > 0 ? "next" : "prev";
        hcShow(dx > 0 ? hcCurrent + 1 : hcCurrent - 1, swipeDir);
        hcReset();
      }
    }, { passive: true });

    hcStart();
  }

  /* ── Quick-quote country autocomplete ────────────────────────────────── */
  var cInput    = document.getElementById("wqf-country");
  var cDropdown = document.getElementById("wqf-dropdown");
  if (cInput && cDropdown) {
    var cTimer;
    var cFocusIdx = -1;

    function cItems() { return cDropdown.querySelectorAll(".wqf-item"); }

    function cOpen(items) {
      cDropdown.innerHTML = items.map(function (c) {
        return '<div class="wqf-item" data-name="' + c.country_name + '">'
          + c.country_name
          + '<span>' + c.country_code + '</span></div>';
      }).join("");
      cFocusIdx = -1;
      cDropdown.classList.add("open");
      cItems().forEach(function (el) {
        el.addEventListener("mousedown", function (e) {
          e.preventDefault();
          cInput.value = this.dataset.name;
          cDropdown.classList.remove("open");
        });
      });
    }

    function cClose() { cDropdown.classList.remove("open"); cFocusIdx = -1; }

    function cFetch(q) {
      clearTimeout(cTimer);
      if (!q) { cClose(); return; }
      cTimer = setTimeout(function () {
        fetch(
          "/api/method/courier_app.api.website_api.search_countries?query=" + encodeURIComponent(q),
          { headers: { "X-Frappe-CSRF-Token": "fetch" } }
        )
          .then(function (r) { return r.json(); })
          .then(function (res) {
            var list = res.message || [];
            if (list.length) { cOpen(list); } else { cClose(); }
          })
          .catch(cClose);
      }, 220);
    }

    cInput.addEventListener("input", function () { cFetch(this.value.trim()); });
    cInput.addEventListener("blur",  function () { setTimeout(cClose, 160); });
    cInput.addEventListener("focus", function () {
      if (this.value.trim() && cDropdown.innerHTML) cDropdown.classList.add("open");
    });

    cInput.addEventListener("keydown", function (e) {
      var items = cItems();
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (cFocusIdx > -1) items[cFocusIdx].classList.remove("focused");
        cFocusIdx = Math.min(cFocusIdx + 1, items.length - 1);
        items[cFocusIdx].classList.add("focused");
        items[cFocusIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (cFocusIdx > -1) items[cFocusIdx].classList.remove("focused");
        cFocusIdx = Math.max(cFocusIdx - 1, 0);
        items[cFocusIdx].classList.add("focused");
        items[cFocusIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && cFocusIdx > -1) {
        e.preventDefault();
        cInput.value = items[cFocusIdx].dataset.name;
        cClose();
      } else if (e.key === "Escape") {
        cClose();
      }
    });
  }

  /* ── Quick-quote submit ───────────────────────────────────────────────── */
  var quickBtn = document.getElementById("wsite-quick-quote-btn");
  if (quickBtn) {
    quickBtn.addEventListener("click", function () {
      var country = document.getElementById("wqf-country");
      var weight  = document.getElementById("wqf-weight");
      if (!country || !country.value.trim()) { country && country.focus(); return; }
      if (!weight || !weight.value || parseFloat(weight.value) <= 0) { weight && weight.focus(); return; }
      var params = new URLSearchParams({ country: country.value.trim(), weight: weight.value });
      window.location.href = "/rates?" + params.toString();
    });
  }

})();

/* ── Auth Modal: Login + Logout Confirm ───────────────────────────────────── */
(function () {
  "use strict";

  /* ── inject styles ──────────────────────────────────────────────────────── */
  var css = [
    ".ca-auth-backdrop{position:fixed;inset:0;background:rgba(61,34,72,0.55);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;animation:ca-bd-in 0.2s ease;}",
    "@keyframes ca-bd-in{from{opacity:0}to{opacity:1}}",
    ".ca-auth-modal{background:#fff;border-radius:20px;width:100%;max-width:400px;position:relative;padding:38px 32px 32px;box-shadow:0 28px 72px rgba(0,0,0,0.22),0 0 0 1px rgba(0,0,0,0.06);overflow:hidden;animation:ca-mo-in 0.28s cubic-bezier(0.34,1.56,0.64,1);}",
    ".ca-auth-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#3D2248 0%,#F0B429 50%,#3D2248 100%);}",
    "@keyframes ca-mo-in{from{opacity:0;transform:scale(0.9) translateY(16px)}to{opacity:1;transform:none}}",
    "@keyframes ca-mo-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}",
    ".ca-auth-modal--shake{animation:ca-mo-shake 0.38s ease!important;}",
    ".ca-auth-close{position:absolute;top:13px;right:13px;width:28px;height:28px;border:none;background:rgba(0,0,0,0.07);color:#6B6B6B;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,color 0.15s;padding:0;font-size:18px;line-height:1;font-family:sans-serif;}",
    ".ca-auth-close:hover{background:rgba(0,0,0,0.14);color:#0A0A0A;}",
    ".ca-auth-brand{display:flex;flex-direction:column;align-items:center;margin-bottom:18px;}",
    ".ca-auth-logo-box{width:66px;height:66px;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:10px;}",
    ".ca-auth-logo-box img{width:100%;height:100%;object-fit:contain;}",
    ".ca-auth-co-name{font-size:15px;font-weight:700;color:#3D2248;letter-spacing:-0.02em;}",
    ".ca-auth-h{font-size:22px;font-weight:700;color:#0A0A0A;letter-spacing:-0.035em;text-align:center;margin-bottom:4px;line-height:1.2;}",
    ".ca-auth-sub{font-size:13.5px;color:#6B6B6B;text-align:center;margin-bottom:22px;line-height:1.5;}",
    ".ca-auth-err{background:#FCEBEB;border:0.5px solid rgba(163,45,45,0.25);border-radius:8px;padding:10px 14px;font-size:13px;color:#A32D2D;margin-bottom:16px;display:flex;align-items:center;gap:8px;}",
    ".ca-auth-err::before{content:'';flex-shrink:0;width:6px;height:6px;border-radius:50%;background:#A32D2D;}",
    ".ca-auth-field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;}",
    ".ca-auth-lbl{font-size:11.5px;font-weight:600;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.06em;}",
    ".ca-auth-inp{width:100%;height:44px;padding:0 12px;border:1px solid rgba(0,0,0,0.15);border-radius:9px;font-size:14px;color:#0A0A0A;background:#fff;outline:none;transition:border-color 0.15s,box-shadow 0.15s;font-family:inherit;-webkit-appearance:none;appearance:none;}",
    ".ca-auth-inp:hover{border-color:rgba(0,0,0,0.3);}",
    ".ca-auth-inp:focus{border-color:#3D2248;box-shadow:0 0 0 3px rgba(61,34,72,0.1);}",
    ".ca-auth-inp--err{border-color:#A32D2D!important;box-shadow:0 0 0 3px rgba(163,45,45,0.1)!important;}",
    ".ca-auth-pwd-wrap{position:relative;}",
    ".ca-auth-pwd-wrap .ca-auth-inp{padding-right:42px;}",
    ".ca-auth-eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#6B6B6B;padding:4px;display:flex;align-items:center;transition:color 0.15s;}",
    ".ca-auth-eye:hover{color:#3D2248;}",
    ".ca-auth-btn-primary{width:100%;height:44px;background:#F0B429;color:#3D2248;border:none;border-radius:9px;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:-0.01em;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;transition:background 0.15s,transform 0.1s;font-family:inherit;}",
    ".ca-auth-btn-primary:hover{background:#D4980F;}",
    ".ca-auth-btn-primary:active{transform:scale(0.98);}",
    ".ca-auth-btn-primary:disabled{opacity:0.7;cursor:not-allowed;}",
    ".ca-auth-btn-navy{background:#3D2248;color:#fff;}",
    ".ca-auth-btn-navy:hover{background:#2A1438;}",
    ".ca-auth-btn-ghost{width:100%;height:44px;background:transparent;color:#6B6B6B;border:1px solid rgba(0,0,0,0.14);border-radius:9px;font-size:14.5px;font-weight:500;cursor:pointer;transition:background 0.15s,border-color 0.15s,color 0.15s;font-family:inherit;}",
    ".ca-auth-btn-ghost:hover{background:rgba(0,0,0,0.04);border-color:rgba(0,0,0,0.25);color:#0A0A0A;}",
    ".ca-auth-modal--center{text-align:center;}",
    ".ca-auth-icon-ring{width:62px;height:62px;border-radius:50%;background:#FCEBEB;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#A32D2D;}",
    ".ca-auth-icon-ring--navy{background:#EEF2FD;color:#3D2248;}",
    ".ca-auth-btns{display:flex;flex-direction:column;gap:8px;margin-top:20px;}",
    ".ca-auth-spin{display:inline-block;width:15px;height:15px;border:2px solid rgba(61,34,72,0.25);border-top-color:#3D2248;border-radius:50%;animation:ca-mo-spin 0.55s linear infinite;}",
    "@keyframes ca-mo-spin{to{transform:rotate(360deg)}}",
    ".ca-auth-tabs{display:flex;gap:4px;background:rgba(0,0,0,0.05);border-radius:10px;padding:3px;margin-bottom:18px;}",
    ".ca-auth-tab{flex:1;height:34px;border:none;background:transparent;border-radius:8px;font-size:13.5px;font-weight:500;color:#6B6B6B;cursor:pointer;transition:background 0.15s,color 0.15s;font-family:inherit;}",
    ".ca-auth-tab.active{background:#fff;color:#0A0A0A;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,0.1);}",
    ".ca-auth-tab:hover:not(.active){color:#0A0A0A;}",
    ".ca-auth-ok{background:#EDFAF3;border:0.5px solid rgba(20,120,60,0.2);border-radius:8px;padding:10px 14px;font-size:13px;color:#0F6B35;margin-bottom:16px;display:flex;align-items:center;gap:8px;}",
    ".ca-auth-ok::before{content:'';flex-shrink:0;width:6px;height:6px;border-radius:50%;background:#0F6B35;}",
    ".ca-auth-google{width:100%;height:44px;background:#fff;color:#3C4043;border:1px solid rgba(0,0,0,0.18);border-radius:9px;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px;transition:background 0.15s,border-color 0.15s,box-shadow 0.15s;font-family:inherit;}",
    ".ca-auth-google:hover{background:#F8F9FA;border-color:rgba(0,0,0,0.28);box-shadow:0 1px 6px rgba(0,0,0,0.08);}",
    ".ca-auth-google:active{background:#F1F3F4;}",
    ".ca-auth-google:disabled{opacity:0.6;cursor:not-allowed;}",
    ".ca-auth-or{display:flex;align-items:center;gap:10px;margin-bottom:14px;color:#9B9B9B;font-size:12px;font-weight:500;letter-spacing:0.04em;}",
    ".ca-auth-or::before,.ca-auth-or::after{content:'';flex:1;height:1px;background:rgba(0,0,0,0.1);}",
    "@media(max-width:440px){.ca-auth-modal{padding:30px 18px 24px;border-radius:16px;}}"
  ].join("");

  var sEl = document.createElement("style");
  sEl.textContent = css;
  document.head.appendChild(sEl);

  /* ── inject HTML ────────────────────────────────────────────────────────── */
  document.body.insertAdjacentHTML("beforeend", [
    /* Login + Sign Up modal */
    '<div id="ca-lm-bd" class="ca-auth-backdrop" style="display:none" role="dialog" aria-modal="true" aria-labelledby="ca-lm-h">',
      '<div class="ca-auth-modal" id="ca-lm-box">',
        '<button class="ca-auth-close" id="ca-lm-close" aria-label="Close">×</button>',
        '<div class="ca-auth-brand">',
          '<div class="ca-auth-logo-box" id="ca-lm-logo"></div>',
          '<div class="ca-auth-co-name" id="ca-lm-coname"></div>',
        '</div>',
        '<div class="ca-auth-tabs" role="tablist">',
          '<button class="ca-auth-tab active" id="ca-tab-login" role="tab">Sign In</button>',
          '<button class="ca-auth-tab" id="ca-tab-signup" role="tab">Create Account</button>',
        '</div>',
        /* Google OAuth — shared between both tabs */
        '<button type="button" class="ca-auth-google" id="ca-google-btn">',
          '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">',
            '<path d="M17.64 9.2c0-.637-.057-1.252-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.252 17.64 11.945 17.64 9.2z" fill="#4285F4"/>',
            '<path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>',
            '<path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>',
            '<path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 6.293C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>',
          '</svg>',
          'Continue with Google',
        '</button>',
        '<div class="ca-auth-or">or</div>',
        /* Login panel */
        '<div id="ca-panel-login">',
          '<h2 class="ca-auth-h" id="ca-lm-h">Welcome back</h2>',
          '<p class="ca-auth-sub">Sign in to access your account</p>',
          '<div id="ca-lm-err" class="ca-auth-err" style="display:none"></div>',
          '<form id="ca-lm-form" autocomplete="on" novalidate>',
            '<div class="ca-auth-field">',
              '<label class="ca-auth-lbl" for="ca-lm-email">Email or username</label>',
              '<input type="text" id="ca-lm-email" class="ca-auth-inp" autocomplete="username" placeholder="you@example.com">',
            '</div>',
            '<div class="ca-auth-field">',
              '<label class="ca-auth-lbl" for="ca-lm-pwd">Password</label>',
              '<div class="ca-auth-pwd-wrap">',
                '<input type="password" id="ca-lm-pwd" class="ca-auth-inp" autocomplete="current-password" placeholder="••••••••">',
                '<button type="button" class="ca-auth-eye" id="ca-lm-eye" title="Toggle password">',
                  '<svg id="ca-lm-eye-ico" width="16" height="16" viewBox="0 0 16 16" fill="none">',
                    '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/>',
                    '<circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>',
                  '</svg>',
                '</button>',
              '</div>',
            '</div>',
            '<button type="submit" class="ca-auth-btn-primary" id="ca-lm-submit">Sign In</button>',
            '<button type="button" class="ca-auth-btn-ghost" id="ca-lm-cancel">Cancel</button>',
          '</form>',
        '</div>',
        /* Sign Up panel */
        '<div id="ca-panel-signup" style="display:none">',
          '<h2 class="ca-auth-h">Create account</h2>',
          '<p class="ca-auth-sub">Sign up to start creating shipments</p>',
          '<div id="ca-su-err" class="ca-auth-err" style="display:none"></div>',
          '<div id="ca-su-ok" class="ca-auth-ok" style="display:none"></div>',
          '<form id="ca-su-form" autocomplete="on" novalidate>',
            '<div class="ca-auth-field">',
              '<label class="ca-auth-lbl" for="ca-su-name">Full Name</label>',
              '<input type="text" id="ca-su-name" class="ca-auth-inp" autocomplete="name" placeholder="Your full name">',
            '</div>',
            '<div class="ca-auth-field">',
              '<label class="ca-auth-lbl" for="ca-su-email">Email</label>',
              '<input type="email" id="ca-su-email" class="ca-auth-inp" autocomplete="email" placeholder="you@example.com">',
            '</div>',
            '<button type="submit" class="ca-auth-btn-primary" id="ca-su-submit">Create Account</button>',
            '<button type="button" class="ca-auth-btn-ghost" id="ca-su-cancel">Cancel</button>',
          '</form>',
        '</div>',
      '</div>',
    '</div>',
    /* Logout confirm modal */
    '<div id="ca-lo-bd" class="ca-auth-backdrop" style="display:none" role="dialog" aria-modal="true">',
      '<div class="ca-auth-modal ca-auth-modal--center" id="ca-lo-box">',
        '<button class="ca-auth-close" id="ca-lo-close" aria-label="Close">×</button>',
        '<div class="ca-auth-brand">',
          '<div class="ca-auth-logo-box" id="ca-lo-logo"></div>',
          '<div class="ca-auth-co-name" id="ca-lo-coname"></div>',
        '</div>',
        '<div class="ca-auth-icon-ring ca-auth-icon-ring--navy">',
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none">',
            '<path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
          '</svg>',
        '</div>',
        '<h2 class="ca-auth-h">Log out?</h2>',
        '<p class="ca-auth-sub">You\'ll be signed out and stay on this page.</p>',
        '<div class="ca-auth-btns">',
          '<button class="ca-auth-btn-primary ca-auth-btn-navy" id="ca-lo-yes">Yes, Log Out</button>',
          '<button class="ca-auth-btn-ghost" id="ca-lo-cancel">Cancel</button>',
        '</div>',
      '</div>',
    '</div>'
  ].join(""));

  /* ── helpers ────────────────────────────────────────────────────────────── */
  var lmBd  = document.getElementById("ca-lm-bd");
  var loBd  = document.getElementById("ca-lo-bd");
  var lmBox = document.getElementById("ca-lm-box");
  var _pendingRedirect = "";

  function _shake(box) {
    box.classList.remove("ca-auth-modal--shake");
    void box.offsetWidth;
    box.classList.add("ca-auth-modal--shake");
    setTimeout(function () { box.classList.remove("ca-auth-modal--shake"); }, 400);
  }

  function _switchTab(tab) {
    document.getElementById("ca-tab-login").classList.toggle("active", tab === "login");
    document.getElementById("ca-tab-signup").classList.toggle("active", tab === "signup");
    document.getElementById("ca-panel-login").style.display  = tab === "login"  ? "" : "none";
    document.getElementById("ca-panel-signup").style.display = tab === "signup" ? "" : "none";
    setTimeout(function () {
      document.getElementById(tab === "login" ? "ca-lm-email" : "ca-su-name").focus();
    }, 60);
  }

  function openLogin(redirect) {
    _pendingRedirect = redirect || (window.location.pathname + window.location.search);
    lmBd.style.display = "flex";
    document.getElementById("ca-lm-err").style.display = "none";
    document.getElementById("ca-lm-email").classList.remove("ca-auth-inp--err");
    document.getElementById("ca-lm-pwd").classList.remove("ca-auth-inp--err");
    document.getElementById("ca-lm-form").reset();
    document.getElementById("ca-su-err").style.display = "none";
    document.getElementById("ca-su-ok").style.display  = "none";
    document.getElementById("ca-su-form").reset();
    document.getElementById("ca-su-form").style.display = "";
    _switchTab("login");
    document.body.style.overflow = "hidden";
  }
  function closeLogin() {
    lmBd.style.display = "none";
    document.body.style.overflow = "";
  }
  function openLogout() {
    loBd.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
  function closeLogout() {
    loBd.style.display = "none";
    document.body.style.overflow = "";
  }

  /* ── populate brand ─────────────────────────────────────────────────────── */
  (function () {
    var nameEl = document.querySelector(".wsite-logo-text") || document.querySelector(".ca-logo span");
    var name   = nameEl ? nameEl.textContent.trim() : "";
    var logoImg = document.querySelector(".wsite-logo img") || document.querySelector(".ca-logo img");
    var fallbackSvg = '<svg width="30" height="30" viewBox="0 0 20 20" fill="none"><path d="M3 7h9l5 5-5 5H3l5-5-5-5z" fill="#F5F0E8"/></svg>';

    function fillBrand(logoId, nameId) {
      var coNameEl = document.getElementById(nameId);
      if (coNameEl) coNameEl.textContent = name || "Portal";
      var logoWrap = document.getElementById(logoId);
      if (logoWrap) {
        if (logoImg) {
          var img = document.createElement("img");
          img.src = logoImg.src;
          img.alt = name;
          logoWrap.appendChild(img);
        } else {
          logoWrap.innerHTML = fallbackSvg;
        }
      }
    }

    fillBrand("ca-lm-logo", "ca-lm-coname");
    fillBrand("ca-lo-logo", "ca-lo-coname");
  }());

  /* ── intercept login / logout / shipment links (capture phase) */
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (href.indexOf("action=logout") !== -1) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openLogout();
    } else if ((href === "/login" || href.indexOf("redirect-to=") !== -1) && !a.classList.contains("wsite-staff-link")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openLogin();
    } else if (href === "/shipment" || href.indexOf("/shipment") === 0) {
      var isGuest = !window.frappe || !frappe.session || frappe.session.user === "Guest";
      if (isGuest) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openLogin(href);
      }
    }
  }, true);

  /* ── close handlers ─────────────────────────────────────────────────────── */
  document.getElementById("ca-lm-close").addEventListener("click", closeLogin);
  document.getElementById("ca-lm-cancel").addEventListener("click", closeLogin);
  document.getElementById("ca-su-cancel").addEventListener("click", closeLogin);
  document.getElementById("ca-lo-close").addEventListener("click", closeLogout);
  document.getElementById("ca-lo-cancel").addEventListener("click", closeLogout);

  /* ── tab switching ───────────────────────────────────────────────────────── */
  document.getElementById("ca-tab-login").addEventListener("click", function () { _switchTab("login"); });
  document.getElementById("ca-tab-signup").addEventListener("click", function () { _switchTab("signup"); });

  /* ── Google OAuth ────────────────────────────────────────────────────────── */
  var _googleAvailable = false;
  var _googleBtn  = document.getElementById("ca-google-btn");
  var _googleOrEl = _googleBtn && _googleBtn.nextElementSibling; // .ca-auth-or divider

  var _GOOGLE_SVG = [
    '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">',
      '<path d="M17.64 9.2c0-.637-.057-1.252-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.252 17.64 11.945 17.64 9.2z" fill="#4285F4"/>',
      '<path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>',
      '<path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>',
      '<path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 6.293C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>',
    '</svg>',
    'Continue with Google'
  ].join("");

  function _setGoogleVisible(visible) {
    if (_googleBtn)  _googleBtn.style.display  = visible ? "" : "none";
    if (_googleOrEl) _googleOrEl.style.display = visible ? "" : "none";
  }

  /* Check once on load whether Google social login is configured */
  fetch("/api/method/courier_app.api.website_api.get_google_oauth_url?redirect_to=%2F", {
    headers: { "X-Frappe-CSRF-Token": (window.frappe && frappe.csrf_token) || "fetch" }
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    _googleAvailable = !!(res.message && typeof res.message === "string" && res.message.indexOf("http") === 0);
    _setGoogleVisible(_googleAvailable);
  })
  .catch(function () { _setGoogleVisible(false); });

  if (_googleBtn) {
    _googleBtn.addEventListener("click", function () {
      if (!_googleAvailable) return;
      _googleBtn.disabled = true;
      _googleBtn.innerHTML = '<span class="ca-auth-spin" style="border-color:rgba(0,0,0,0.15);border-top-color:#4285F4"></span> Connecting to Google…';
      var redirectTo = _pendingRedirect || window.location.pathname;
      fetch("/api/method/courier_app.api.website_api.get_google_oauth_url?redirect_to=" + encodeURIComponent(redirectTo), {
        headers: { "X-Frappe-CSRF-Token": (window.frappe && frappe.csrf_token) || "fetch" }
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var url = res.message;
        if (url && typeof url === "string" && url.indexOf("http") === 0) {
          window.location.href = url;
        } else {
          _googleBtn.disabled = false;
          _googleBtn.innerHTML = _GOOGLE_SVG;
        }
      })
      .catch(function () {
        _googleBtn.disabled = false;
        _googleBtn.innerHTML = _GOOGLE_SVG;
      });
    });
  }

  lmBd.addEventListener("click", function (e) { if (e.target === lmBd) closeLogin(); });
  loBd.addEventListener("click", function (e) { if (e.target === loBd) closeLogout(); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (lmBd.style.display !== "none") closeLogin();
    if (loBd.style.display !== "none") closeLogout();
  });

  /* ── password toggle ────────────────────────────────────────────────────── */
  document.getElementById("ca-lm-eye").addEventListener("click", function () {
    var inp = document.getElementById("ca-lm-pwd");
    var show = inp.type === "password";
    inp.type = show ? "text" : "password";
    document.getElementById("ca-lm-eye-ico").innerHTML = show
      ? '<path d="M13.5 13.5A7 7 0 019 15c-4.5 0-8-6-8-6a12.5 12.5 0 013.1-3.9M6.5 6.5A3 3 0 0110 10M15 15L1 1m14 4A7 7 0 0115 9s-3.5 6-7 6a5.5 5.5 0 01-2-.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      : '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>';
  });

  /* ── login submit ───────────────────────────────────────────────────────── */
  document.getElementById("ca-lm-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var emailEl = document.getElementById("ca-lm-email");
    var pwdEl   = document.getElementById("ca-lm-pwd");
    var errEl   = document.getElementById("ca-lm-err");
    var btn     = document.getElementById("ca-lm-submit");
    var email   = emailEl.value.trim();
    var pwd     = pwdEl.value;

    errEl.style.display = "none";
    emailEl.classList.remove("ca-auth-inp--err");
    pwdEl.classList.remove("ca-auth-inp--err");

    if (!email) {
      emailEl.classList.add("ca-auth-inp--err");
      emailEl.focus();
      _shake(lmBox);
      return;
    }
    if (!pwd) {
      pwdEl.classList.add("ca-auth-inp--err");
      pwdEl.focus();
      _shake(lmBox);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="ca-auth-spin"></span> Signing in…';

    fetch("/api/method/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Frappe-CSRF-Token": (window.frappe && frappe.csrf_token) || "fetch"
      },
      body: new URLSearchParams({ usr: email, pwd: pwd }).toString()
    })
    .then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    })
    .then(function (res) {
      if (res.ok) {
        window.location.href = _pendingRedirect || window.location.pathname;
      } else {
        btn.disabled = false;
        btn.textContent = "Sign In";
        pwdEl.value = "";
        var msg = "Incorrect email or password. Please try again.";
        var raw = (res.data && res.data.message) ? String(res.data.message).toLowerCase() : "";
        if (raw.includes("locked") || raw.includes("disabled")) {
          msg = "Your account is locked or disabled. Please contact support.";
        } else if (raw.includes("two") || raw.includes("otp") || raw.includes("2fa")) {
          msg = "Two-factor authentication required. Please use the full login page.";
        }
        errEl.textContent = msg;
        errEl.style.display = "flex";
        _shake(lmBox);
        pwdEl.focus();
      }
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = "Sign In";
      errEl.textContent = "Network error. Please check your connection and try again.";
      errEl.style.display = "flex";
      _shake(lmBox);
    });
  });

  /* ── signup submit ──────────────────────────────────────────────────────── */
  document.getElementById("ca-su-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var nameEl  = document.getElementById("ca-su-name");
    var emailEl = document.getElementById("ca-su-email");
    var errEl   = document.getElementById("ca-su-err");
    var okEl    = document.getElementById("ca-su-ok");
    var btn     = document.getElementById("ca-su-submit");
    var name    = nameEl.value.trim();
    var email   = emailEl.value.trim();

    errEl.style.display = "none";
    okEl.style.display  = "none";
    nameEl.classList.remove("ca-auth-inp--err");
    emailEl.classList.remove("ca-auth-inp--err");

    if (!name) { nameEl.classList.add("ca-auth-inp--err"); nameEl.focus(); _shake(lmBox); return; }
    if (!email || email.indexOf("@") === -1) { emailEl.classList.add("ca-auth-inp--err"); emailEl.focus(); _shake(lmBox); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="ca-auth-spin"></span> Creating account…';

    fetch("/api/method/frappe.core.doctype.user.user.sign_up", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Frappe-CSRF-Token": (window.frappe && frappe.csrf_token) || "fetch"
      },
      body: new URLSearchParams({
        email: email,
        full_name: name,
        redirect_to: _pendingRedirect || "/shipment"
      }).toString()
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      btn.disabled = false;
      btn.textContent = "Create Account";
      var raw = "";
      if (res.message) {
        raw = Array.isArray(res.message) ? String(res.message[1] || "") : String(res.message);
      }
      var lower = raw.toLowerCase();
      if (lower.indexOf("already") !== -1 || lower.indexOf("registered") !== -1) {
        errEl.textContent = "This email is already registered. Please sign in instead.";
        errEl.style.display = "flex";
        _shake(lmBox);
      } else if (res.exc || lower.indexOf("error") !== -1 || lower.indexOf("invalid") !== -1) {
        errEl.textContent = raw || "Something went wrong. Please try again.";
        errEl.style.display = "flex";
        _shake(lmBox);
      } else {
        okEl.textContent = "Account created! Check your email for a verification link to set your password.";
        okEl.style.display = "flex";
        document.getElementById("ca-su-form").style.display = "none";
      }
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = "Create Account";
      errEl.textContent = "Network error. Please check your connection and try again.";
      errEl.style.display = "flex";
      _shake(lmBox);
    });
  });

  /* ── logout confirm ─────────────────────────────────────────────────────── */
  document.getElementById("ca-lo-yes").addEventListener("click", function () {
    var btn = document.getElementById("ca-lo-yes");
    btn.disabled = true;
    btn.innerHTML = '<span class="ca-auth-spin" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff"></span> Logging out…';

    /* GET request — Frappe skips CSRF validation for safe HTTP methods */
    fetch("/api/method/logout", { method: "GET", credentials: "same-origin" })
      .then(function () { window.location.reload(); })
      .catch(function () { window.location.reload(); });
  });

  /* ── auto-open modal when redirected from a protected page ──────────────── */
  (function () {
    var p = new URLSearchParams(window.location.search);
    var dest = p.get("ca_login");
    if (dest) {
      history.replaceState({}, "", window.location.pathname);
      openLogin("/" + dest);
    }
  }());

}());
