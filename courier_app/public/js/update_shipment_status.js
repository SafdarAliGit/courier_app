(function () {
  "use strict";

  // ── Dynamic status data (loaded from server) ──
  var STATUS_ORDER = [];
  var STATUS_META = {};
  var statusesLoaded = false;

  var DEFAULT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/></svg>';
  var KNOWN_ICONS = {
    "Shipment Information Received": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 8h6M5 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    "Collection": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 12V6l4-3 4 3v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12V9h4v3" stroke="currentColor" stroke-width="1.3"/></svg>',
    "In Transit to Destination": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 10h9V4H1zM10 6h2l2 2v2h-4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="4" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>',
    "Departed Origin Airport": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12h12M3 9l3-5 2 2 4-3 1 1-3 5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Arrived at Destination Airport": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12h12M13 9l-3-5-2 2-4-3-1 1 3 5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Delivered": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Cancelled": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  function getIcon(status) {
    return KNOWN_ICONS[status] || DEFAULT_ICON;
  }

  function getLabel(status) {
    var m = STATUS_META[status];
    return (m && m.label) || status;
  }

  function getLocationOption(status) {
    var m = STATUS_META[status];
    return (m && m.location_option) || "";
  }

  // ── State ──
  var shipmentData = null;
  var scanModeOn = false;
  var quickAdvanceOn = false;
  var airportsCache = null;
  var cameraScanCallback = null;
  var trackingIdInputMode = "Camera";

  // ── Scanner machine detection ──
  var lastInputTime = 0;
  var rapidCount = 0;
  var scanTimer = null;
  var RAPID_MS = 55;
  var SCAN_MIN_CHARS = 4;
  var SCAN_SUBMIT_DELAY = 180;

  // ── Camera state (html5-qrcode) ──
  var cameraActive = false;
  var html5QrCode = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    if (typeof frappe !== "undefined" && frappe.show_alert) {
      frappe.show_alert = function () {};
    }

    injectAirportStyles();
    loadStatuses();

    var input = document.getElementById("uss-input");
    var btn = document.getElementById("uss-btn");
    if (!input || !btn) return;

    btn.addEventListener("click", function () { doLookup(false); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        clearTimeout(scanTimer);
        var wasScanner = rapidCount >= SCAN_MIN_CHARS;
        rapidCount = 0;
        if (wasScanner) {
          playBeep("scan");
          flashInput("scan");
        }
        doLookup(wasScanner);
      }
    });

    input.addEventListener("input", onRapidInput);
    initCamera();
    initScanMode();

    if (typeof USS_QUERY !== "undefined" && USS_QUERY) {
      input.value = USS_QUERY;
      doLookup(false);
    }
  }

  function loadStatuses() {
    apiCall(
      "courier_app.api.status_api.list_statuses",
      {},
      function (data) {
        var list = data.message || data || [];
        STATUS_ORDER = [];
        STATUS_META = {};
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var name = s.status || s.name;
          if (name === "Cancelled") continue;
          STATUS_ORDER.push(name);
          STATUS_META[name] = {
            label: name,
            location_option: s.location_option || "",
            sequence: s.sequence || 0,
          };
        }
        STATUS_META["Cancelled"] = { label: "Cancelled", location_option: "", sequence: 9999 };
        statusesLoaded = true;

        if (shipmentData) renderResult(shipmentData);
      },
      function () {
        STATUS_ORDER = [
          "Shipment Information Received", "Collection",
          "In Transit to Destination", "Departed Origin Airport",
          "Arrived at Destination Airport", "Delivered",
        ];
        STATUS_META = {};
        for (var i = 0; i < STATUS_ORDER.length; i++) {
          STATUS_META[STATUS_ORDER[i]] = { label: STATUS_ORDER[i], location_option: "", sequence: i };
        }
        STATUS_META["Cancelled"] = { label: "Cancelled", location_option: "", sequence: 9999 };
        statusesLoaded = true;
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scanner machine detection (rapid HID keyboard input)
  // ═══════════════════════════════════════════════════════════════════════════

  function onRapidInput(e) {
    var now = Date.now();
    var data = e.data || "";

    if (data.length === 1) {
      if (now - lastInputTime < RAPID_MS && rapidCount > 0) {
        rapidCount++;
      } else {
        rapidCount = 1;
      }
      lastInputTime = now;

      clearTimeout(scanTimer);
      scanTimer = setTimeout(function () {
        if (rapidCount >= SCAN_MIN_CHARS) {
          var val = (document.getElementById("uss-input").value || "").trim();
          if (val.length >= SCAN_MIN_CHARS) {
            playBeep("scan");
            flashInput("scan");
            doLookup(true);
          }
        }
        rapidCount = 0;
      }, SCAN_SUBMIT_DELAY);
    } else if (data.length > 1) {
      clearTimeout(scanTimer);
      rapidCount = 0;
      scanTimer = setTimeout(function () {
        var val = (document.getElementById("uss-input").value || "").trim();
        if (val.length >= SCAN_MIN_CHARS) {
          playBeep("scan");
          flashInput("scan");
          doLookup(true);
        }
      }, 120);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Camera barcode scanning (html5-qrcode)
  // ═══════════════════════════════════════════════════════════════════════════

  function hasCameraSupport() {
    return !!(
      typeof Html5Qrcode !== "undefined" &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );
  }

  function initCamera() {
    var camBtn = document.getElementById("uss-cam-btn");
    var closeBtn = document.getElementById("uss-cam-close");
    if (!camBtn) return;

    if (hasCameraSupport()) {
      camBtn.addEventListener("click", toggleCamera);
    } else {
      camBtn.classList.add("uss-unsupported");
      camBtn.title = "Camera scanning is not available in this browser";
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", stopCamera);
    }
  }

  function toggleCamera(onScan) {
    if (cameraActive) {
      stopCamera();
    } else {
      startCamera(onScan);
    }
  }

  function startCamera(onScan) {
    cameraScanCallback = onScan || null;
    var overlay = document.getElementById("uss-camera-overlay");
    if (!overlay) return;

    overlay.classList.add("active");
    cameraActive = true;

    var btn = document.getElementById("uss-cam-btn");
    if (btn) btn.classList.add("active");

    html5QrCode = new Html5Qrcode("uss-cam-reader");

    var config = {
      fps: 12,
      qrbox: { width: 280, height: 120 },
      aspectRatio: 1.333,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.ITF,
      ],
    };

    html5QrCode
      .start(
        { facingMode: "environment" },
        config,
        function onScanSuccess(decodedText) {
          var value = (decodedText || "").trim();
          if (!value) return;

          var cb = cameraScanCallback;
          stopCamera();

          if (cb) {
            cb(value);
            cameraScanCallback = null;
          } else {
            var input = document.getElementById("uss-input");
            input.value = value;
            playBeep("scan");
            flashInput("scan");
            doLookup(true);
          }
        },
        function onScanFailure() {}
      )
      .catch(function (err) {
        cameraActive = false;
        overlay.classList.remove("active");
        if (btn) btn.classList.remove("active");

        var msg = "Could not access camera.";
        var errStr = String(err);
        if (errStr.indexOf("NotAllowed") !== -1 || errStr.indexOf("Permission") !== -1) {
          msg = "Camera permission denied. Please allow camera access in your browser settings and try again.";
        } else if (errStr.indexOf("NotFound") !== -1) {
          msg = "No camera found on this device.";
        } else if (errStr.indexOf("NotReadable") !== -1 || errStr.indexOf("in use") !== -1) {
          msg = "Camera is in use by another app. Please close it and try again.";
        }
        showModal("error", "Camera Error", msg);
      });
  }

  function stopCamera() {
    cameraActive = false;

    var btn = document.getElementById("uss-cam-btn");
    if (btn) btn.classList.remove("active");

    if (html5QrCode) {
      html5QrCode
        .stop()
        .then(function () {
          html5QrCode.clear();
        })
        .catch(function () {
          try { html5QrCode.clear(); } catch (e) {}
        });
      html5QrCode = null;
    }

    var overlay = document.getElementById("uss-camera-overlay");
    if (overlay) overlay.classList.remove("active");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scan mode (continuous + quick advance)
  // ═══════════════════════════════════════════════════════════════════════════

  function initScanMode() {
    var toggle = document.getElementById("uss-scan-toggle");
    var quickWrap = document.getElementById("uss-quick-wrap");
    var quickToggle = document.getElementById("uss-quick-toggle");

    if (toggle) {
      toggle.addEventListener("change", function () {
        scanModeOn = this.checked;
        document.body.classList.toggle("uss-scan-active", scanModeOn);
        if (quickWrap) quickWrap.classList.toggle("visible", scanModeOn);
        if (!scanModeOn && quickToggle) {
          quickToggle.checked = false;
          quickAdvanceOn = false;
        }
        if (scanModeOn) {
          document.getElementById("uss-input").focus();
        }
      });
    }

    if (quickToggle) {
      quickToggle.addEventListener("change", function () {
        quickAdvanceOn = this.checked;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Audio & visual feedback
  // ═══════════════════════════════════════════════════════════════════════════

  function playBeep(type) {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";

      if (type === "success") {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.07);
        gain.gain.setValueAtTime(0.13, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.18);
      } else if (type === "error") {
        osc.frequency.setValueAtTime(260, ctx.currentTime);
        osc.frequency.setValueAtTime(200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.13, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.06);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.06);
      }
    } catch (e) {}
  }

  function flashInput(type) {
    var input = document.getElementById("uss-input");
    if (!input) return;
    input.classList.remove("uss-flash-scan", "uss-flash-success", "uss-flash-error");
    void input.offsetWidth;
    input.classList.add("uss-flash-" + type);
    setTimeout(function () {
      input.classList.remove("uss-flash-" + type);
    }, 600);
  }

  function readyForNextScan() {
    var input = document.getElementById("uss-input");
    if (input) {
      input.value = "";
      input.focus();
    }
    var result = document.getElementById("uss-result");
    if (result) {
      result.innerHTML = "";
      result.style.display = "none";
    }
    shipmentData = null;
    rapidCount = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════════════════

  function apiCall(method, args, onSuccess, onError) {
    fetch("/api/method/" + method, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Frappe-CSRF-Token":
          (typeof frappe !== "undefined" && frappe.csrf_token) || "fetch",
      },
      body: new URLSearchParams(args).toString(),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { ok: resp.ok, status: resp.status, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          var msg = "Something went wrong. Please try again.";
          if (result.data && result.data._server_messages) {
            try {
              var msgs = JSON.parse(result.data._server_messages);
              var parsed = JSON.parse(msgs[0] || "{}");
              msg = parsed.message || msg;
              msg = msg.replace(/<[^>]+>/g, "");
            } catch (e) {}
          } else if (result.data && result.data.exc_type) {
            if (result.data.exc_type === "ValidationError") {
              msg = "Validation error. Please check the shipment ID and try again.";
            } else if (result.data.exc_type === "PermissionError") {
              msg = "You do not have permission to perform this action.";
            } else if (result.data.exc_type === "DoesNotExistError") {
              msg = "The specified shipment was not found.";
            }
          }
          if (onError) onError(msg);
          return;
        }
        if (onSuccess) onSuccess(result.data);
      })
      .catch(function () {
        if (onError)
          onError(
            "Could not connect to the server. Please check your connection and try again."
          );
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lookup & render
  // ═══════════════════════════════════════════════════════════════════════════

  function doLookup(fromScanner) {
    var input = document.getElementById("uss-input");
    var val = (input.value || "").trim();
    if (!val) {
      input.focus();
      return;
    }

    var result = document.getElementById("uss-result");
    result.style.display = "block";
    result.innerHTML =
      '<div class="uss-loading"><div class="ca-spinner-sm"></div> Looking up shipment…</div>';

    apiCall(
      "courier_app.api.shipment_api.get_shipment_status_info",
      { shipment_id: val },
      function (data) {
        var d = data.message || data;
        if (!d || !d.found) {
          result.innerHTML =
            '<div class="uss-not-found">' +
            '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
            "No shipment found for <strong>" +
            escHtml(val) +
            "</strong>" +
            "</div>";
          playBeep("error");
          flashInput("error");
          if (scanModeOn) setTimeout(readyForNextScan, 2500);
          return;
        }
        shipmentData = d;
        trackingIdInputMode = d.tracking_id_input_mode || "Camera";
        renderResult(d);

        if (fromScanner && scanModeOn && quickAdvanceOn) {
          var currentIdx = STATUS_ORDER.indexOf(d.status);
          var isTerminal = d.status === "Cancelled" || d.status === "Delivered";
          var nextStatus =
            !isTerminal &&
            currentIdx >= 0 &&
            currentIdx < STATUS_ORDER.length - 1
              ? STATUS_ORDER[currentIdx + 1]
              : null;

          if (nextStatus) {
            setTimeout(function () {
              initiateUpdate(nextStatus);
            }, 400);
          } else {
            playBeep("error");
            if (scanModeOn) setTimeout(readyForNextScan, 2500);
          }
        }
      },
      function (errMsg) {
        showModal("error", "Lookup Failed", errMsg);
        result.innerHTML = "";
        result.style.display = "none";
        playBeep("error");
        if (scanModeOn) setTimeout(readyForNextScan, 2500);
      }
    );
  }

  function renderResult(d) {
    var result = document.getElementById("uss-result");
    var currentIdx = STATUS_ORDER.indexOf(d.status);
    var isCancelled = d.status === "Cancelled";
    var isDelivered = d.status === "Delivered";
    var isTerminal = isCancelled || isDelivered;
    var nextStatus =
      !isTerminal && currentIdx >= 0 && currentIdx < STATUS_ORDER.length - 1
        ? STATUS_ORDER[currentIdx + 1]
        : null;

    var route = "";
    if (d.sender_city || d.sender_country) {
      route =
        escHtml(d.sender_city || "") +
        (d.sender_city && d.sender_country ? ", " : "") +
        escHtml(d.sender_country || "");
    }
    if (d.recipient_city || d.recipient_country) {
      if (route) route += "  →  ";
      route +=
        escHtml(d.recipient_city || "") +
        (d.recipient_city && d.recipient_country ? ", " : "") +
        escHtml(d.recipient_country || "");
    }

    var html = '<div class="uss-card">';

    html += '<div class="uss-info-header">';
    html += '<div class="uss-info-left">';
    html += '<div class="uss-shipment-id">' + escHtml(d.name) + "</div>";
    if (d.tracking_number) {
      html +=
        '<div class="uss-tracking-num">Tracking: ' +
        escHtml(d.tracking_number) +
        "</div>";
    }
    html += "</div>";
    html += '<div class="uss-info-right">';
    html +=
      '<div class="uss-status-badge ' +
      statusClass(d.status) +
      '">' +
      escHtml(d.status) +
      "</div>";
    html += "</div></div>";

    html += '<div class="uss-info-grid">';
    if (d.ship_date) html += infoItem("Ship Date", d.ship_date);
    if (route) html += infoItem("Route", route, true);
    if (d.service_provider) html += infoItem("Provider", d.service_provider);
    if (d.sender_name) html += infoItem("Sender", d.sender_name);
    if (d.recipient_name) html += infoItem("Recipient", d.recipient_name);
    html += "</div>";

    html += '<div class="uss-timeline-section">';
    html += '<h3 class="uss-section-title">Status Progression</h3>';
    html += '<div class="uss-timeline">';

    for (var i = 0; i < STATUS_ORDER.length; i++) {
      var st = STATUS_ORDER[i];
      var stepClass = "uss-step";
      var isCompleted = !isCancelled && currentIdx >= 0 && i < currentIdx;
      var isCurrent = !isCancelled && i === currentIdx;
      var isNext = !isCancelled && nextStatus && st === nextStatus;

      if (isCompleted) stepClass += " uss-step--done";
      if (isCurrent) stepClass += " uss-step--current";
      if (isNext) stepClass += " uss-step--next";

      var evInfo = getEventInfo(d.events, st);

      html += '<div class="' + stepClass + '">';
      html += '<div class="uss-step-indicator">';
      if (isCompleted) {
        html +=
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else if (isCurrent) {
        html += '<div class="uss-step-pulse"></div>';
      } else {
        html += '<div class="uss-step-dot"></div>';
      }
      html += "</div>";
      html += '<div class="uss-step-content">';
      html += '<div class="uss-step-label">';
      html += (getIcon(st)) + " " + escHtml(getLabel(st));
      if (isNext) {
        html += ' <span class="uss-next-badge">Next</span>';
      }
      if (st === "Delivered" && d.enable_tracking_id) {
        html += buildTrackingIdInline(d);
      }
      html += "</div>";
      if (evInfo.time) {
        html += '<div class="uss-step-time">' + escHtml(evInfo.time);
        if (evInfo.updatedBy) {
          html +=
            ' <span class="uss-updated-by">by ' +
            escHtml(evInfo.updatedBy) +
            "</span>";
        }
        html += "</div>";
      }
      html += "</div></div>";
    }

    if (isCancelled) {
      var cancelInfo = getEventInfo(d.events, "Cancelled");
      html += '<div class="uss-step uss-step--cancelled">';
      html +=
        '<div class="uss-step-indicator">' +
        getIcon("Cancelled") +
        "</div>";
      html += '<div class="uss-step-content">';
      html +=
        '<div class="uss-step-label">' +
        getIcon("Cancelled") +
        " Cancelled</div>";
      if (cancelInfo.time) {
        html += '<div class="uss-step-time">' + escHtml(cancelInfo.time);
        if (cancelInfo.updatedBy) {
          html +=
            ' <span class="uss-updated-by">by ' +
            escHtml(cancelInfo.updatedBy) +
            "</span>";
        }
        html += "</div>";
      }
      html += "</div></div>";
    }

    html += "</div></div>";

    if (!isTerminal) {
      if (d.can_update === false) {
        html += '<div class="uss-terminal-msg">';
        html += '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.3"/><path d="M10 6v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14" r="1.2" fill="currentColor"/></svg>';
        html += " You have already updated a status on this shipment. Another user must perform the next update.";
        html += "</div>";
      } else {
        html += '<div class="uss-actions">';
        if (nextStatus) {
          html +=
            '<button class="ca-btn ca-btn-primary uss-update-btn" id="uss-update-btn" data-status="' +
            escAttr(nextStatus) +
            '">';
          html += getIcon(nextStatus);
          html +=
            " Update to: " + escHtml(getLabel(nextStatus));
          html += "</button>";
        }
        html += "</div>";
      }
    } else {
      html += '<div class="uss-terminal-msg">';
      if (isDelivered) {
        html +=
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.3"/><path d="M6 10l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        html += " This shipment has been delivered. No further status updates.";
      } else {
        html +=
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.3"/><path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        html += " This shipment has been cancelled.";
      }
      html += "</div>";
    }

    html += "</div>";
    result.innerHTML = html;

    var updateBtn = document.getElementById("uss-update-btn");
    if (updateBtn) {
      updateBtn.addEventListener("click", function () {
        initiateUpdate(this.getAttribute("data-status"));
      });
    }

    bindTrackingIdEvents();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Status update — with Airport popup when needed
  // ═══════════════════════════════════════════════════════════════════════════

  function initiateUpdate(newStatus) {
    if (!shipmentData) return;
    var locOpt = getLocationOption(newStatus);
    if (locOpt === "Airport") {
      showAirportModal(function (airportName) {
        doUpdate(newStatus, airportName);
      });
    } else {
      doUpdate(newStatus);
    }
  }

  function doUpdate(newStatus, airport) {
    if (!shipmentData) return;

    var updateBtn = document.getElementById("uss-update-btn");
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.innerHTML = '<div class="ca-spinner-sm"></div> Updating…';
    }

    var shipName = shipmentData.name;
    var args = { shipment_id: shipName, new_status: newStatus };
    if (airport) args.airport = airport;

    apiCall(
      "courier_app.api.shipment_api.update_status",
      args,
      function (data) {
        var d = data.message || data;
        if (d && d.status === "ok") {
          playBeep("success");
          flashInput("success");

          if (scanModeOn) {
            showModal(
              "success",
              "Status Updated",
              "<strong>" +
                escHtml(shipName) +
                "</strong> → <strong>" +
                escHtml(getLabel(newStatus)) +
                "</strong>",
              true
            );
            setTimeout(readyForNextScan, 1800);
          } else {
            showModal(
              "success",
              "Status Updated",
              "Shipment <strong>" +
                escHtml(shipName) +
                "</strong> has been updated to <strong>" +
                escHtml(getLabel(newStatus)) +
                "</strong>.",
              true
            );
            doLookup(false);
          }
        } else {
          showModal(
            "error",
            "Update Failed",
            "Failed to update shipment status. Please try again."
          );
          playBeep("error");
          resetButtons(updateBtn);
        }
      },
      function (errMsg) {
        showModal("error", "Update Failed", errMsg);
        playBeep("error");
        resetButtons(updateBtn);
      }
    );
  }

  function resetButtons(updateBtn) {
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "Retry";
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Airport Modal
  // ═══════════════════════════════════════════════════════════════════════════

  function showAirportModal(onSelect) {
    removeAirportModal();

    var backdrop = document.createElement("div");
    backdrop.id = "ca-airport-backdrop";
    backdrop.className = "ca-ap-backdrop";

    var modal = document.createElement("div");
    modal.className = "ca-ap-modal";
    modal.innerHTML =
      '<div class="ca-ap-header">' +
        '<div class="ca-ap-title">' +
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 15h14M4 12l3.5-6 2.5 2.5 5-3.5 1.2 1.2L12 12z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          ' Select Airport' +
        '</div>' +
        '<button class="ca-ap-close" id="ca-ap-close">&times;</button>' +
      '</div>' +
      '<div class="ca-ap-search-wrap">' +
        '<svg class="ca-ap-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
        '<input type="text" class="ca-ap-search" id="ca-ap-search" placeholder="Search by name, code, city or country..." autocomplete="off">' +
      '</div>' +
      '<div class="ca-ap-list" id="ca-ap-list">' +
        '<div class="ca-ap-loading"><div class="ca-spinner-sm"></div> Loading airports...</div>' +
      '</div>' +
      '<div class="ca-ap-add-row" id="ca-ap-add-row">' +
        '<button class="ca-ap-add-btn" id="ca-ap-add-btn">' +
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
          ' Add New Airport' +
        '</button>' +
      '</div>';

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    requestAnimationFrame(function () {
      backdrop.classList.add("ca-ap-visible");
    });

    var searchInput = document.getElementById("ca-ap-search");
    var listEl = document.getElementById("ca-ap-list");

    document.getElementById("ca-ap-close").addEventListener("click", removeAirportModal);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) removeAirportModal();
    });

    document.getElementById("ca-ap-add-btn").addEventListener("click", function () {
      showAddAirportModal(function (newAirport) {
        airportsCache = null;
        loadAirportsIntoList(listEl, searchInput.value, onSelect);
      });
    });

    function onKeydown(e) {
      if (e.key === "Escape") {
        removeAirportModal();
        document.removeEventListener("keydown", onKeydown);
      }
    }
    document.addEventListener("keydown", onKeydown);

    loadAirportsIntoList(listEl, "", onSelect);

    searchInput.addEventListener("input", function () {
      renderAirportList(listEl, searchInput.value, onSelect);
    });

    setTimeout(function () { searchInput.focus(); }, 100);
  }

  function loadAirportsIntoList(listEl, filter, onSelect) {
    if (airportsCache) {
      renderAirportList(listEl, filter, onSelect);
      return;
    }
    apiCall(
      "courier_app.api.location_api.list_airports",
      {},
      function (data) {
        airportsCache = data.message || data || [];
        renderAirportList(listEl, filter, onSelect);
      },
      function () {
        listEl.innerHTML = '<div class="ca-ap-empty">Failed to load airports</div>';
      }
    );
  }

  function renderAirportList(listEl, filter, onSelect) {
    var airports = airportsCache || [];
    var lf = (filter || "").toLowerCase().trim();

    var filtered = lf
      ? airports.filter(function (a) {
          return (
            (a.airport_name || "").toLowerCase().indexOf(lf) !== -1 ||
            (a.iata_code || "").toLowerCase().indexOf(lf) !== -1 ||
            (a.city || "").toLowerCase().indexOf(lf) !== -1 ||
            (a.country || "").toLowerCase().indexOf(lf) !== -1
          );
        })
      : airports;

    if (!filtered.length) {
      listEl.innerHTML =
        '<div class="ca-ap-empty">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="opacity:.4"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '<span>' + (lf ? "No airports matching \"" + escHtml(lf) + "\"" : "No airports added yet") + '</span>' +
        '</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < filtered.length; i++) {
      var a = filtered[i];
      var subtitle = [a.city, a.country].filter(Boolean).join(", ");
      html +=
        '<div class="ca-ap-item" data-name="' + escAttr(a.name) + '">' +
          '<div class="ca-ap-item-main">' +
            '<div class="ca-ap-item-name">' + escHtml(a.airport_name) + '</div>' +
            (subtitle ? '<div class="ca-ap-item-sub">' + escHtml(subtitle) + '</div>' : '') +
          '</div>' +
          (a.iata_code ? '<div class="ca-ap-item-code">' + escHtml(a.iata_code) + '</div>' : '') +
        '</div>';
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll(".ca-ap-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var name = this.getAttribute("data-name");
        removeAirportModal();
        if (onSelect) onSelect(name);
      });
    });
  }

  function removeAirportModal() {
    var el = document.getElementById("ca-airport-backdrop");
    if (el) {
      el.classList.remove("ca-ap-visible");
      setTimeout(function () { el.remove(); }, 200);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Add New Airport Modal
  // ═══════════════════════════════════════════════════════════════════════════

  function showAddAirportModal(onCreated) {
    var existing = document.getElementById("ca-add-airport-backdrop");
    if (existing) existing.remove();

    var backdrop = document.createElement("div");
    backdrop.id = "ca-add-airport-backdrop";
    backdrop.className = "ca-ap-backdrop ca-ap-backdrop--nested";

    var modal = document.createElement("div");
    modal.className = "ca-ap-modal ca-ap-modal--add";
    modal.innerHTML =
      '<div class="ca-ap-header">' +
        '<div class="ca-ap-title">' +
          '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
          ' New Airport' +
        '</div>' +
        '<button class="ca-ap-close" id="ca-add-ap-close">&times;</button>' +
      '</div>' +
      '<div class="ca-ap-form">' +
        '<div class="ca-ap-field">' +
          '<label class="ca-ap-label">Airport Name <span class="ca-ap-req">*</span></label>' +
          '<input type="text" class="ca-ap-input" id="ca-add-ap-name" placeholder="e.g. Jinnah International Airport">' +
        '</div>' +
        '<div class="ca-ap-field-row">' +
          '<div class="ca-ap-field">' +
            '<label class="ca-ap-label">IATA Code</label>' +
            '<input type="text" class="ca-ap-input" id="ca-add-ap-iata" placeholder="e.g. KHI" maxlength="3" style="text-transform:uppercase">' +
          '</div>' +
          '<div class="ca-ap-field">' +
            '<label class="ca-ap-label">City</label>' +
            '<input type="text" class="ca-ap-input" id="ca-add-ap-city" placeholder="e.g. Karachi">' +
          '</div>' +
        '</div>' +
        '<div class="ca-ap-field">' +
          '<label class="ca-ap-label">Country</label>' +
          '<input type="text" class="ca-ap-input" id="ca-add-ap-country" placeholder="e.g. Pakistan">' +
        '</div>' +
        '<div class="ca-ap-form-actions">' +
          '<button class="ca-ap-btn-cancel" id="ca-add-ap-cancel">Cancel</button>' +
          '<button class="ca-ap-btn-create" id="ca-add-ap-create">' +
            '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            ' Create Airport' +
          '</button>' +
        '</div>' +
      '</div>';

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    requestAnimationFrame(function () {
      backdrop.classList.add("ca-ap-visible");
    });

    function closeAdd() {
      backdrop.classList.remove("ca-ap-visible");
      setTimeout(function () { backdrop.remove(); }, 200);
    }

    document.getElementById("ca-add-ap-close").addEventListener("click", closeAdd);
    document.getElementById("ca-add-ap-cancel").addEventListener("click", closeAdd);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeAdd();
    });

    document.getElementById("ca-add-ap-create").addEventListener("click", function () {
      var name = (document.getElementById("ca-add-ap-name").value || "").trim();
      var iata = (document.getElementById("ca-add-ap-iata").value || "").trim().toUpperCase();
      var city = (document.getElementById("ca-add-ap-city").value || "").trim();
      var country = (document.getElementById("ca-add-ap-country").value || "").trim();

      if (!name) {
        document.getElementById("ca-add-ap-name").focus();
        document.getElementById("ca-add-ap-name").style.borderColor = "#dc2626";
        return;
      }

      var createBtn = document.getElementById("ca-add-ap-create");
      createBtn.disabled = true;
      createBtn.innerHTML = '<div class="ca-spinner-sm"></div> Creating...';

      apiCall(
        "courier_app.api.location_api.add_airport",
        { airport_name: name, iata_code: iata, city: city, country: country },
        function () {
          closeAdd();
          if (onCreated) onCreated({ name: name, iata_code: iata, city: city, country: country });
        },
        function (errMsg) {
          createBtn.disabled = false;
          createBtn.innerHTML = 'Create Airport';
          showModal("error", "Error", errMsg);
        }
      );
    });

    setTimeout(function () {
      document.getElementById("ca-add-ap-name").focus();
    }, 100);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // Tracking ID inline (next to Delivered)
  // ═══════════════════════════════════════════════════════════════════════════

  function buildTrackingIdInline(d) {
    var tid = d.tracking_id || "";
    if (tid) {
      return ' <span class="uss-tid-value" id="uss-tid-value" title="Click to edit">' + escHtml(tid) + '</span>';
    }
    return ' <button class="uss-tid-btn" id="uss-tid-btn" type="button">+ Tracking ID</button>';
  }

  function bindTrackingIdEvents() {
    var valueEl = document.getElementById("uss-tid-value");
    if (valueEl && !valueEl._bound) {
      valueEl._bound = true;
      valueEl.addEventListener("click", function () {
        if (trackingIdInputMode === "Camera" && hasCameraSupport()) {
          startCameraForTrackingId(valueEl.textContent.trim());
        } else {
          showTrackingIdInput(valueEl.textContent.trim());
        }
      });
    }
    var btnEl = document.getElementById("uss-tid-btn");
    if (btnEl && !btnEl._bound) {
      btnEl._bound = true;
      btnEl.addEventListener("click", function () {
        if (trackingIdInputMode === "Camera" && hasCameraSupport()) {
          startCameraForTrackingId("");
        } else {
          showTrackingIdInput("");
        }
      });
    }
  }

  function startCameraForTrackingId(currentVal) {
    startCamera(function (value) {
      playBeep("scan");
      saveTrackingIdDirect(value);
    });
  }

  function saveTrackingIdDirect(val) {
    if (!shipmentData) return;
    apiCall(
      "courier_app.api.shipment_api.save_tracking_id",
      { shipment_id: shipmentData.name, tracking_id: val },
      function (data) {
        var d = data.message || data;
        if (d && d.status === "ok") {
          shipmentData.tracking_id = d.tracking_id;
          renderResult(shipmentData);
          playBeep("success");
        }
      },
      function () {
        playBeep("error");
      }
    );
  }

  function showTrackingIdInput(currentVal) {
    var container = document.getElementById("uss-tid-value") || document.getElementById("uss-tid-btn");
    if (!container) return;

    var wrapper = document.createElement("span");
    wrapper.className = "uss-tid-wrap";
    wrapper.id = "uss-tid-wrap";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "uss-tid-input";
    input.value = currentVal;
    input.placeholder = "Scan or enter tracking ID";

    wrapper.appendChild(input);

    if (hasCameraSupport()) {
      var camBtn = document.createElement("button");
      camBtn.type = "button";
      camBtn.className = "uss-tid-cam-btn";
      camBtn.title = "Scan barcode";
      camBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.4"/><circle cx="14.5" cy="6.5" r="1" fill="currentColor"/></svg>';
      camBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      camBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        startCamera(function (value) {
          input.value = value;
          playBeep("scan");
          input.focus();
        });
      });
      wrapper.appendChild(camBtn);
    }

    container.replaceWith(wrapper);
    input.focus();
    input.select();

    function replaceWithEl(span) {
      wrapper.replaceWith(span);
      bindTrackingIdEvents();
    }

    function save() {
      var val = (input.value || "").trim();
      if (!shipmentData) return;
      apiCall(
        "courier_app.api.shipment_api.save_tracking_id",
        { shipment_id: shipmentData.name, tracking_id: val },
        function (data) {
          var d = data.message || data;
          if (d && d.status === "ok") {
            shipmentData.tracking_id = d.tracking_id;
            var span;
            if (d.tracking_id) {
              span = document.createElement("span");
              span.className = "uss-tid-value";
              span.id = "uss-tid-value";
              span.title = "Click to edit";
              span.textContent = d.tracking_id;
            } else {
              span = document.createElement("button");
              span.className = "uss-tid-btn";
              span.id = "uss-tid-btn";
              span.type = "button";
              span.textContent = "+ Tracking ID";
            }
            replaceWithEl(span);
          }
        },
        function () {
          var span;
          if (currentVal) {
            span = document.createElement("span");
            span.className = "uss-tid-value";
            span.id = "uss-tid-value";
            span.title = "Click to edit";
            span.textContent = currentVal;
          } else {
            span = document.createElement("button");
            span.className = "uss-tid-btn";
            span.id = "uss-tid-btn";
            span.type = "button";
            span.textContent = "+ Tracking ID";
          }
          replaceWithEl(span);
        }
      );
    }

    input.addEventListener("blur", save);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(tidScanTimer);
        tidRapidCount = 0;
        input.blur();
      }
      if (e.key === "Escape") {
        clearTimeout(tidScanTimer);
        tidRapidCount = 0;
        var span;
        if (currentVal) {
          span = document.createElement("span");
          span.className = "uss-tid-value";
          span.id = "uss-tid-value";
          span.title = "Click to edit";
          span.textContent = currentVal;
        } else {
          span = document.createElement("button");
          span.className = "uss-tid-btn";
          span.id = "uss-tid-btn";
          span.type = "button";
          span.textContent = "+ Tracking ID";
        }
        replaceWithEl(span);
      }
    });

    var tidLastInput = 0;
    var tidRapidCount = 0;
    var tidScanTimer = null;
    input.addEventListener("input", function (e) {
      var now = Date.now();
      var data = e.data || "";
      if (data.length === 1) {
        if (now - tidLastInput < RAPID_MS && tidRapidCount > 0) {
          tidRapidCount++;
        } else {
          tidRapidCount = 1;
        }
        tidLastInput = now;
        clearTimeout(tidScanTimer);
        tidScanTimer = setTimeout(function () {
          if (tidRapidCount >= SCAN_MIN_CHARS) {
            var val = (input.value || "").trim();
            if (val.length >= SCAN_MIN_CHARS) {
              playBeep("scan");
              input.blur();
            }
          }
          tidRapidCount = 0;
        }, SCAN_SUBMIT_DELAY);
      } else if (data.length > 1) {
        clearTimeout(tidScanTimer);
        tidRapidCount = 0;
        tidScanTimer = setTimeout(function () {
          var val = (input.value || "").trim();
          if (val.length >= SCAN_MIN_CHARS) {
            playBeep("scan");
            input.blur();
          }
        }, 120);
      }
    });
  }

  function getEventInfo(events, status) {
    if (!events) return { time: "", updatedBy: "" };
    for (var i = events.length - 1; i >= 0; i--) {
      if (events[i].status === status) {
        var dt = events[i].datetime;
        var loc = events[i].location;
        var updatedBy = events[i].updated_by || "";
        var parts = [];
        if (dt) {
          try {
            var d = new Date(dt);
            parts.push(
              d.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              }) +
                " " +
                d.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
            );
          } catch (e) {
            parts.push(dt);
          }
        }
        if (loc) parts.push(loc);
        return { time: parts.join(" — "), updatedBy: updatedBy };
      }
    }
    return { time: "", updatedBy: "" };
  }

  function statusClass(status) {
    if (status === "Delivered") return "uss-badge--delivered";
    if (status === "Cancelled") return "uss-badge--cancelled";
    var idx = STATUS_ORDER.indexOf(status);
    if (idx <= 1) return "uss-badge--pending";
    return "uss-badge--transit";
  }

  function infoItem(label, value, isHtml) {
    return (
      '<div class="uss-info-item"><span class="uss-info-label">' +
      escHtml(label) +
      '</span><span class="uss-info-value">' +
      (isHtml ? value : escHtml(value)) +
      "</span></div>"
    );
  }

  function escHtml(s) {
    if (!s) return "";
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Airport Modal Styles (injected once)
  // ═══════════════════════════════════════════════════════════════════════════

  function injectAirportStyles() {
    if (document.getElementById("ca-airport-modal-css")) return;
    var style = document.createElement("style");
    style.id = "ca-airport-modal-css";
    style.textContent = [
      /* Backdrop */
      ".ca-ap-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease}",
      ".ca-ap-backdrop.ca-ap-visible{opacity:1}",
      ".ca-ap-backdrop--nested{z-index:10001}",

      /* Modal */
      ".ca-ap-modal{background:#fff;border-radius:14px;width:460px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.18),0 4px 16px rgba(0,0,0,.08);transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.22,1,.36,1);overflow:hidden}",
      ".ca-ap-visible .ca-ap-modal{transform:translateY(0) scale(1)}",
      ".ca-ap-modal--add{width:420px}",

      /* Header */
      ".ca-ap-header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 14px;border-bottom:1px solid #e5e7eb}",
      ".ca-ap-title{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;color:#1a1d23;letter-spacing:-.02em}",
      ".ca-ap-close{background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;transition:color .15s,background .15s}",
      ".ca-ap-close:hover{color:#1a1d23;background:#f3f4f6}",

      /* Search */
      ".ca-ap-search-wrap{display:flex;align-items:center;gap:8px;padding:8px 16px;margin:12px 16px 0;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:10px;transition:border-color .15s,box-shadow .15s}",
      ".ca-ap-search-wrap:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}",
      ".ca-ap-search-icon{flex-shrink:0;color:#9ca3af}",
      ".ca-ap-search-wrap:focus-within .ca-ap-search-icon{color:#2563eb}",
      ".ca-ap-search{flex:1;border:none;background:none;font-size:13.5px;color:#1a1d23;outline:none;font-family:inherit;min-width:0}",
      ".ca-ap-search::placeholder{color:#9ca3af}",

      /* List */
      ".ca-ap-list{flex:1;overflow-y:auto;padding:8px 0;min-height:120px;max-height:380px}",
      ".ca-ap-list::-webkit-scrollbar{width:5px}",
      ".ca-ap-list::-webkit-scrollbar-track{background:transparent}",
      ".ca-ap-list::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}",

      /* Item */
      ".ca-ap-item{display:flex;align-items:center;gap:12px;padding:10px 22px;cursor:pointer;transition:background .12s}",
      ".ca-ap-item:hover{background:#eff6ff}",
      ".ca-ap-item-main{flex:1;min-width:0}",
      ".ca-ap-item-name{font-size:13.5px;font-weight:500;color:#1a1d23;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".ca-ap-item-sub{font-size:11.5px;color:#6b7280;margin-top:1px}",
      ".ca-ap-item-code{flex-shrink:0;font-size:11px;font-weight:700;font-family:'DM Mono',monospace;letter-spacing:.06em;padding:3px 10px;border-radius:6px;background:#e0e7ff;color:#3730a3}",

      /* Empty */
      ".ca-ap-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;color:#9ca3af;font-size:13px}",

      /* Loading */
      ".ca-ap-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:32px 16px;color:#6b7280;font-size:13px}",

      /* Add row */
      ".ca-ap-add-row{padding:10px 16px 14px;border-top:1px solid #e5e7eb}",
      ".ca-ap-add-btn{display:flex;align-items:center;gap:6px;width:100%;padding:10px 16px;background:#f0f9ff;border:1.5px dashed #93c5fd;border-radius:10px;color:#2563eb;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s}",
      ".ca-ap-add-btn:hover{background:#dbeafe;border-color:#60a5fa}",

      /* Form (Add Airport) */
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
    ].join("\n");
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Modals (success/error/confirm)
  // ═══════════════════════════════════════════════════════════════════════════

  function removeModal() {
    var existing = document.getElementById("uss-modal-backdrop");
    if (existing) existing.remove();
  }

  function showModal(type, title, message, autoClose) {
    removeModal();

    var iconSvg =
      type === "success"
        ? '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" stroke="currentColor" stroke-width="1.5"/><path d="M9 14.5l3.5 3.5 6.5-6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" stroke="currentColor" stroke-width="1.5"/><path d="M14 9v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="19" r="1.2" fill="currentColor"/></svg>';

    var iconClass =
      type === "success" ? "uss-modal-icon--success" : "uss-modal-icon--error";

    var backdrop = document.createElement("div");
    backdrop.id = "uss-modal-backdrop";
    backdrop.className = "uss-modal-backdrop";
    backdrop.innerHTML =
      '<div class="uss-modal">' +
      '<div class="uss-modal-icon ' +
      iconClass +
      '">' +
      iconSvg +
      "</div>" +
      '<h2 class="uss-modal-title">' +
      escHtml(title) +
      "</h2>" +
      '<p class="uss-modal-msg">' +
      message +
      "</p>" +
      '<button class="ca-btn ca-btn-primary uss-modal-close-btn">OK</button>' +
      "</div>";

    document.body.appendChild(backdrop);

    backdrop
      .querySelector(".uss-modal-close-btn")
      .addEventListener("click", removeModal);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) removeModal();
    });

    if (autoClose) {
      setTimeout(removeModal, 3000);
    }
  }

  function showConfirmModal(title, message, onConfirm) {
    removeModal();

    var backdrop = document.createElement("div");
    backdrop.id = "uss-modal-backdrop";
    backdrop.className = "uss-modal-backdrop";
    backdrop.innerHTML =
      '<div class="uss-modal">' +
      '<div class="uss-modal-icon uss-modal-icon--warn">' +
      '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 3L2 25h24L14 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="21" r="1.2" fill="currentColor"/></svg>' +
      "</div>" +
      '<h2 class="uss-modal-title">' +
      escHtml(title) +
      "</h2>" +
      '<p class="uss-modal-msg">' +
      escHtml(message) +
      "</p>" +
      '<div class="uss-modal-actions">' +
      '<button class="ca-btn ca-btn-ghost uss-modal-cancel-btn">Cancel</button>' +
      '<button class="ca-btn uss-confirm-danger-btn">Yes, Cancel Shipment</button>' +
      "</div></div>";

    document.body.appendChild(backdrop);

    backdrop
      .querySelector(".uss-modal-cancel-btn")
      .addEventListener("click", removeModal);
    backdrop
      .querySelector(".uss-confirm-danger-btn")
      .addEventListener("click", function () {
        removeModal();
        if (onConfirm) onConfirm();
      });
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) removeModal();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Boot
  // ═══════════════════════════════════════════════════════════════════════════

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
