/* Sue's Nails booking widget.
 * Embed:
 *   <div id="sues-booking"></div>
 *   <script src="https://YOUR-WORKER-URL/widget.js" data-target="#sues-booking" defer></script>
 * The API base is derived from this script's own src, so no other config is needed.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var API = new URL(script.src).origin;
  var targetSel = script.getAttribute("data-target") || "#sues-booking";
  var root = document.querySelector(targetSel);
  if (!root) return;

  var CSS = [
    ".snb{--snb-ink:#262016;--snb-soft:#57503f;--snb-muted:#8a8171;--snb-gold:#a8842c;--snb-gold-dark:#8c6d20;--snb-hairline:rgba(168,132,44,.28);--snb-cream:#faf6ef;--snb-white:#fff;--snb-green:#2e7d4f;color:var(--snb-ink);line-height:1.5}",
    ".snb *{box-sizing:border-box;margin:0;padding:0}",
    ".snb-step-label{text-transform:uppercase;letter-spacing:.18em;font-size:.7rem;font-weight:600;color:var(--snb-gold-dark);margin:1.75rem 0 .75rem}",
    ".snb-step-label:first-child{margin-top:0}",
    ".snb-services{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.75rem;list-style:none}",
    ".snb-service{border:1px solid var(--snb-hairline);border-radius:6px;background:var(--snb-white);padding:.85rem 1rem;cursor:pointer;text-align:left;font:inherit;transition:border-color .15s,box-shadow .15s;width:100%}",
    ".snb-service:hover{border-color:var(--snb-gold)}",
    ".snb-service.snb-selected{border-color:var(--snb-gold-dark);box-shadow:0 0 0 1px var(--snb-gold-dark)}",
    ".snb-service-name{font-weight:600}",
    ".snb-service-meta{font-size:.85rem;color:var(--snb-soft);margin-top:.15rem}",
    ".snb-service-desc{font-size:.8rem;color:var(--snb-muted);margin-top:.15rem}",
    ".snb-price{color:var(--snb-gold-dark);font-weight:600}",
    ".snb-days,.snb-times{display:flex;flex-wrap:wrap;gap:.5rem}",
    ".snb-timegroup{margin:.75rem 0 .25rem;font-size:.75rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--snb-muted)}",
    ".snb-chip{border:1px solid var(--snb-hairline);background:var(--snb-white);border-radius:999px;padding:.45rem .9rem;font:inherit;font-size:.88rem;cursor:pointer;transition:border-color .15s}",
    ".snb-chip:hover{border-color:var(--snb-gold)}",
    ".snb-chip.snb-selected{background:var(--snb-ink);color:var(--snb-cream);border-color:var(--snb-ink)}",
    ".snb-chip:disabled{opacity:.4;cursor:default}",
    ".snb-note{font-size:.85rem;color:var(--snb-muted);margin:.5rem 0}",
    ".snb-form{display:grid;gap:.75rem;max-width:420px}",
    ".snb-form label{font-size:.8rem;font-weight:600;color:var(--snb-soft);display:block;margin-bottom:.25rem}",
    ".snb-form input,.snb-form select,.snb-form textarea{width:100%;font:inherit;padding:.6rem .75rem;border:1px solid var(--snb-hairline);border-radius:6px;background:var(--snb-white);color:var(--snb-ink)}",
    ".snb-form input:focus,.snb-form select:focus,.snb-form textarea:focus{outline:2px solid var(--snb-gold);outline-offset:1px}",
    ".snb-submit{display:inline-flex;align-items:center;gap:.5rem;background:var(--snb-ink);color:var(--snb-cream);border:none;border-radius:999px;padding:.8rem 1.7rem;font:inherit;font-weight:600;cursor:pointer;transition:background .15s}",
    ".snb-submit:hover{background:var(--snb-gold-dark)}",
    ".snb-submit:disabled{opacity:.5;cursor:default}",
    ".snb-error{color:#a33;font-size:.9rem;margin-top:.5rem}",
    ".snb-success{border:1px solid var(--snb-hairline);border-top:3px solid var(--snb-gold);border-radius:6px;background:var(--snb-white);padding:1.5rem;max-width:480px}",
    ".snb-success h3{font-size:1.2rem;margin-bottom:.5rem}",
    ".snb-success .snb-code{font-weight:700;letter-spacing:.06em}",
    ".snb-linkbtn{background:none;border:none;color:var(--snb-gold-dark);font:inherit;font-size:.85rem;cursor:pointer;text-decoration:underline;padding:0;margin-top:1rem}",
  ].join("\n");

  var state = {
    services: [],
    service: null,
    date: null,
    slots: [],
    slot: null,
    party: 1,
    capacity: 1,
    loading: false,
  };

  var styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
  root.classList.add("snb");

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function fetchJson(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || "Request failed");
        return data;
      });
    });
  }

  function fmtDay(d) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function fmtPrice(cents) {
    if (!cents) return "";
    return cents % 100 === 0 ? "$" + cents / 100 : "$" + (cents / 100).toFixed(2);
  }

  function ymd(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function render() {
    root.innerHTML = "";

    // Step 1: service
    root.appendChild(el("p", { class: "snb-step-label", text: "1. Choose a service" }));
    var list = el("div", { class: "snb-services" });
    state.services.forEach(function (s) {
      var btn = el("button", {
        class: "snb-service" + (state.service && state.service.id === s.id ? " snb-selected" : ""),
        type: "button",
        onclick: function () {
          state.service = s;
          state.slot = null;
          state.slots = [];
          if (state.date) loadSlots();
          else render();
        },
      });
      btn.appendChild(el("div", { class: "snb-service-name", text: s.name }));
      var meta = el("div", { class: "snb-service-meta", text: s.duration_min + " min" });
      if (s.price_cents) {
        meta.appendChild(document.createTextNode(" · "));
        meta.appendChild(el("span", { class: "snb-price", text: fmtPrice(s.price_cents) }));
      }
      btn.appendChild(meta);
      if (s.description) btn.appendChild(el("div", { class: "snb-service-desc", text: s.description }));
      list.appendChild(btn);
    });
    root.appendChild(list);

    if (!state.service) return;

    // Step 2: date
    root.appendChild(el("p", { class: "snb-step-label", text: "2. Pick a day" }));
    var days = el("div", { class: "snb-days" });
    for (var i = 0; i < 14; i++) {
      var d = new Date();
      d.setDate(d.getDate() + i);
      var dstr = ymd(d);
      days.appendChild(
        el("button", {
          class: "snb-chip" + (state.date === dstr ? " snb-selected" : ""),
          type: "button",
          text: i === 0 ? "Today" : fmtDay(d),
          "data-date": dstr,
          onclick: (function (dateStr) {
            return function () {
              state.date = dateStr;
              state.slot = null;
              loadSlots();
            };
          })(dstr),
        })
      );
    }
    root.appendChild(days);

    if (!state.date) return;

    // Step 3: time
    root.appendChild(el("p", { class: "snb-step-label", text: "3. Pick a time" }));
    if (state.loading) {
      root.appendChild(el("p", { class: "snb-note", text: "Checking availability…" }));
      return;
    }
    if (!state.slots.length) {
      root.appendChild(el("p", { class: "snb-note", text: "No times available that day — try another day." }));
      return;
    }
    // Group time chips into morning / afternoon / evening for readability.
    var groups = [
      { name: "Morning", test: function (h) { return h < 12; } },
      { name: "Afternoon", test: function (h) { return h >= 12 && h < 17; } },
      { name: "Evening", test: function (h) { return h >= 17; } },
    ];
    groups.forEach(function (g) {
      var inGroup = state.slots.filter(function (s) {
        var m = /^(\d+):\d+\s*(AM|PM)$/i.exec(s.label);
        if (!m) return g.name === "Morning";
        var h = (+m[1] % 12) + (m[2].toUpperCase() === "PM" ? 12 : 0);
        return g.test(h);
      });
      if (!inGroup.length) return;
      root.appendChild(el("p", { class: "snb-timegroup", text: g.name }));
      var times = el("div", { class: "snb-times" });
      inGroup.forEach(function (s) {
        var labelText = s.label + (s.remaining < state.capacity && s.remaining <= 2 ? " · " + s.remaining + " left" : "");
        times.appendChild(
          el("button", {
            class: "snb-chip" + (state.slot && state.slot.start_ts === s.start_ts ? " snb-selected" : ""),
            type: "button",
            text: labelText,
            onclick: function () {
              state.slot = s;
              render();
            },
          })
        );
      });
      root.appendChild(times);
    });

    if (!state.slot) return;

    // Step 4: details
    root.appendChild(el("p", { class: "snb-step-label", text: "4. Your details" }));
    var form = el("form", { class: "snb-form" });
    var maxParty = Math.min(state.slot.remaining, state.capacity);
    var partyWrap = el("div");
    partyWrap.appendChild(el("label", { for: "snb-party", text: "Booking for how many people?" }));
    var partySel = el("select", { id: "snb-party", name: "party" });
    for (var p = 1; p <= maxParty; p++) {
      var priceSuffix = state.service.price_cents ? " — " + fmtPrice(state.service.price_cents * p) : "";
      var opt = el("option", { value: String(p), text: (p === 1 ? "Just me" : p + " people, same service together") + priceSuffix });
      if (p === state.party) opt.selected = true;
      partySel.appendChild(opt);
    }
    partyWrap.appendChild(partySel);
    if (maxParty > 1) {
      partyWrap.appendChild(el("div", { class: "snb-note", text: "Booking for a group reserves side-by-side seats at the same time." }));
    }
    form.appendChild(partyWrap);

    [
      { id: "snb-name", label: "Name", type: "text", name: "name", required: true, autocomplete: "name" },
      { id: "snb-phone", label: "Phone", type: "tel", name: "phone", required: true, autocomplete: "tel" },
      { id: "snb-email", label: "Email (optional)", type: "email", name: "email", autocomplete: "email" },
    ].forEach(function (f) {
      var wrap = el("div");
      wrap.appendChild(el("label", { for: f.id, text: f.label }));
      var input = el("input", { id: f.id, type: f.type, name: f.name, autocomplete: f.autocomplete });
      if (f.required) input.required = true;
      wrap.appendChild(input);
      form.appendChild(wrap);
    });

    var notesWrap = el("div");
    notesWrap.appendChild(el("label", { for: "snb-notes", text: "Notes (optional)" }));
    notesWrap.appendChild(el("textarea", { id: "snb-notes", name: "notes", rows: "2" }));
    form.appendChild(notesWrap);

    var submit = el("button", { class: "snb-submit", type: "submit", text: "Confirm booking" });
    form.appendChild(submit);
    var errBox = el("p", { class: "snb-error" });
    form.appendChild(errBox);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.textContent = "";
      submit.disabled = true;
      submit.textContent = "Booking…";
      fetchJson("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: state.service.id,
          start: state.slot.start,
          party_size: parseInt(partySel.value, 10),
          name: form.querySelector("#snb-name").value,
          phone: form.querySelector("#snb-phone").value,
          email: form.querySelector("#snb-email").value,
          notes: form.querySelector("#snb-notes").value,
        }),
      })
        .then(function (data) {
          renderSuccess(data.booking);
        })
        .catch(function (err) {
          errBox.textContent = err.message;
          submit.disabled = false;
          submit.textContent = "Confirm booking";
          // Times may have changed; refresh them.
          loadSlots();
        });
    });

    root.appendChild(form);
  }

  function renderSuccess(booking) {
    root.innerHTML = "";
    var box = el("div", { class: "snb-success" });
    box.appendChild(el("h3", { text: "You're booked!" }));
    var p1 = el("p");
    p1.appendChild(document.createTextNode(booking.service + " · " + booking.label + (booking.party_size > 1 ? " · " + booking.party_size + " people" : "")));
    box.appendChild(p1);
    if (booking.total_cents) {
      box.appendChild(el("p", { class: "snb-note", text: "Estimated total: " + fmtPrice(booking.total_cents) + " (pay at the salon)" }));
    }
    var p2 = el("p");
    p2.appendChild(document.createTextNode("Confirmation code: "));
    p2.appendChild(el("span", { class: "snb-code", text: booking.code }));
    box.appendChild(p2);
    box.appendChild(el("p", { class: "snb-note", text: "Save this code. Call us if you need to change or cancel." }));
    box.appendChild(
      el("button", {
        class: "snb-linkbtn",
        type: "button",
        text: "Book another appointment",
        onclick: function () {
          state.service = null;
          state.date = null;
          state.slot = null;
          state.slots = [];
          state.party = 1;
          render();
        },
      })
    );
    root.appendChild(box);
  }

  function loadSlots() {
    state.loading = true;
    render();
    fetchJson("/api/availability?service_id=" + state.service.id + "&date=" + state.date)
      .then(function (data) {
        state.slots = data.slots || [];
        state.capacity = data.capacity || 1;
        state.loading = false;
        render();
      })
      .catch(function () {
        state.slots = [];
        state.loading = false;
        render();
      });
  }

  fetchJson("/api/services")
    .then(function (data) {
      state.services = data.services || [];
      render();
    })
    .catch(function () {
      root.innerHTML = "";
      root.appendChild(el("p", { class: "snb-note", text: "Online booking is temporarily unavailable — please call us to book." }));
    });
})();
