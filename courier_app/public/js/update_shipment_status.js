(function () {
  "use strict";

  var STATUS_ORDER = [
    "Shipment Information Received",
    "Collection",
    "In Transit to Destination",
    "Departed Origin Airport",
    "Arrived at Destination Airport",
    "Delivered",
  ];

  var STATUS_LABELS = {
    "Shipment Information Received": "Info Received",
    "Collection": "Collection",
    "In Transit to Destination": "In Transit",
    "Departed Origin Airport": "Departed Origin",
    "Arrived at Destination Airport": "Arrived Destination",
    "Delivered": "Delivered",
    "Cancelled": "Cancelled",
  };

  var STATUS_ICONS = {
    "Shipment Information Received": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 8h6M5 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    "Collection": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 12V6l4-3 4 3v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12V9h4v3" stroke="currentColor" stroke-width="1.3"/></svg>',
    "In Transit to Destination": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 10h9V4H1zM10 6h2l2 2v2h-4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="4" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>',
    "Departed Origin Airport": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12h12M3 9l3-5 2 2 4-3 1 1-3 5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Arrived at Destination Airport": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12h12M13 9l-3-5-2 2-4-3-1 1 3 5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Delivered": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Cancelled": '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  // ── State ──
  var shipmentData = null;
  var scanModeOn = false;
  var quickAdvanceOn = false;

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

    // Scanner machine detection — rapid keystroke tracking
    input.addEventListener("input", onRapidInput);

    // Camera button
    initCamera();

    // Scan mode toggles
    initScanMode();

    // URL query parameter
    if (typeof USS_QUERY !== "undefined" && USS_QUERY) {
      input.value = USS_QUERY;
      doLookup(false);
    }
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

  function toggleCamera() {
    if (cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  }

  function startCamera() {
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

          stopCamera();

          var input = document.getElementById("uss-input");
          input.value = value;
          playBeep("scan");
          flashInput("scan");
          doLookup(true);
        },
        function onScanFailure() {
          // Called on every frame without a barcode — ignored
        }
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
        renderResult(d);

        // Quick advance: auto-update to next status when scanned
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
              doUpdate(nextStatus);
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
      html += (STATUS_ICONS[st] || "") + " " + escHtml(STATUS_LABELS[st] || st);
      if (isNext) {
        html += ' <span class="uss-next-badge">Next</span>';
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
        STATUS_ICONS["Cancelled"] +
        "</div>";
      html += '<div class="uss-step-content">';
      html +=
        '<div class="uss-step-label">' +
        STATUS_ICONS["Cancelled"] +
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
      html += '<div class="uss-actions">';
      if (nextStatus) {
        html +=
          '<button class="ca-btn ca-btn-primary uss-update-btn" id="uss-update-btn" data-status="' +
          escAttr(nextStatus) +
          '">';
        html += STATUS_ICONS[nextStatus] || "";
        html +=
          " Update to: " + escHtml(STATUS_LABELS[nextStatus] || nextStatus);
        html += "</button>";
      }
      html += '<button class="ca-btn uss-cancel-btn" id="uss-cancel-btn">';
      html += STATUS_ICONS["Cancelled"] + " Cancel Shipment";
      html += "</button>";
      html += "</div>";
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
        doUpdate(this.getAttribute("data-status"));
      });
    }
    var cancelBtn = document.getElementById("uss-cancel-btn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        showConfirmModal(
          "Cancel Shipment",
          "Are you sure you want to cancel this shipment? This action cannot be undone.",
          function () {
            doUpdate("Cancelled");
          }
        );
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Status update
  // ═══════════════════════════════════════════════════════════════════════════

  function doUpdate(newStatus) {
    if (!shipmentData) return;

    var updateBtn = document.getElementById("uss-update-btn");
    var cancelBtn = document.getElementById("uss-cancel-btn");
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.innerHTML = '<div class="ca-spinner-sm"></div> Updating…';
    }
    if (cancelBtn) cancelBtn.disabled = true;

    var shipName = shipmentData.name;

    apiCall(
      "courier_app.api.shipment_api.update_status",
      { shipment_id: shipName, new_status: newStatus },
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
                escHtml(STATUS_LABELS[newStatus] || newStatus) +
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
                escHtml(STATUS_LABELS[newStatus] || newStatus) +
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
          resetButtons(updateBtn, cancelBtn);
        }
      },
      function (errMsg) {
        showModal("error", "Update Failed", errMsg);
        playBeep("error");
        resetButtons(updateBtn, cancelBtn);
      }
    );
  }

  function resetButtons(updateBtn, cancelBtn) {
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "Retry";
    }
    if (cancelBtn) cancelBtn.disabled = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

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
    if (
      status === "Shipment Information Received" ||
      status === "Collection"
    )
      return "uss-badge--pending";
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
  // Modals
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
