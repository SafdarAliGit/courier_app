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
  function animateCounter(el, target, suffix, duration) {
    var start = 0;
    var step = target / (duration / 16);
    var timer = setInterval(function () {
      start = Math.min(start + step, target);
      el.textContent = Math.floor(start).toLocaleString() + suffix;
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
