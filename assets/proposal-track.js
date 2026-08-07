/**
 * Proposal engagement tracking — per-recipient, first-party, no dependencies.
 *
 * Opt-in per page:
 *   <script src="/assets/proposal-track.js" data-slug="boothalicious-seo-audit" defer></script>
 *
 * Does nothing at all unless the visitor arrived with a ?k=<token> that
 * matches a known recipient server-side. No token → no session, no beacons.
 *
 * What it measures, and why:
 *   · per-section visible time  — the real "what did they care about"
 *   · <details> expansions      — a click, so deliberate interest not scroll
 *   · furthest section reached  — did they get to the part that matters
 *   · total visible time        — paused while the tab is hidden
 * Hover is deliberately not tracked: it doesn't exist on touch, where a lot
 * of proposals get opened first, and it reads as interest when it's usually
 * just where the cursor was parked.
 *
 * The token is removed from the address bar on arrival. That keeps it out of
 * the reader's view, and means a forwarded URL carries no token — a second
 * reader is counted as untracked rather than misattributed to the first.
 */
(function () {
  "use strict";

  var ENDPOINT = "/api/proposal-view";
  var BATCH_MS = 20000;       // flush cadence while the page is visible
  var SESSION_MAX_MS = 6 * 60 * 60 * 1000; // matches the server's session TTL
  // A section is "being read" when it crosses the middle of the viewport.
  // Shrinking the observer root to a thin central band does that, and unlike
  // an intersectionRatio threshold it works for sections taller than the
  // screen — most of them are, and a ratio test can never fire for those.
  var CENTRE_BAND = "-45% 0px -45% 0px";

  // currentScript is set for deferred classic scripts, but fall back to a
  // src lookup so this still resolves if the tag is ever moved or inlined.
  var script = document.currentScript || document.querySelector('script[src*="proposal-track.js"]');
  var slug = (script && script.getAttribute("data-slug")) || "";
  if (!slug) return;

  var store;
  try {
    store = window.sessionStorage;
    // Safari private mode throws on write rather than on access.
    store.setItem("__pv_probe", "1");
    store.removeItem("__pv_probe");
  } catch (e) {
    store = null;
  }

  // ── token: from the URL on arrival, then remembered for the tab ──────
  var tokenKey = "pv_k_" + slug;
  var token = "";
  try {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("k");
    if (fromUrl) {
      token = fromUrl;
      if (store) store.setItem(tokenKey, token);
      // Strip ?k= without adding a history entry, preserving everything else.
      params.delete("k");
      var qs = params.toString();
      // Not named `clean` — that identifier is the label helper below, and a
      // `var` here would shadow the hoisted function for the whole IIFE.
      var cleanUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", cleanUrl);
      }
    } else if (store) {
      token = store.getItem(tokenKey) || "";
    }
  } catch (e) { /* malformed URL — nothing to track */ }

  if (!token) return;

  // ── session: survives a reload in the same tab, expires after 6h ─────
  var stateKey = "pv_s_" + slug;
  var state = { sid: "", started: 0, seconds: 0, sections: {}, expanded: [], furthest: "" };
  try {
    var saved = store && JSON.parse(store.getItem(stateKey) || "null");
    if (saved && saved.sid && Date.now() - saved.started < SESSION_MAX_MS) state = saved;
  } catch (e) { /* corrupt state — start fresh */ }

  if (!state.sid) {
    state.sid = randomId();
    state.started = Date.now();
  }

  function persist() {
    try { if (store) store.setItem(stateKey, JSON.stringify(state)); } catch (e) {}
  }

  function randomId() {
    try {
      var a = new Uint8Array(10);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    } catch (e) {
      return String(Date.now()).slice(-8) + Math.floor(Math.random() * 1e8).toString(16);
    }
  }

  // ── section labels ───────────────────────────────────────────────────
  function labelFor(el) {
    var explicit = el.getAttribute("data-track-label");
    if (explicit) return explicit.slice(0, 80);
    var eyebrow = el.querySelector(".eyebrow");
    if (eyebrow && eyebrow.textContent.trim()) return clean(eyebrow.textContent);
    var heading = el.querySelector("h2, h3");
    if (heading && heading.textContent.trim()) return clean(heading.textContent);
    return clean(el.id || "section");
  }

  function clean(s) {
    return String(s).replace(/\s+/g, " ").trim().slice(0, 80);
  }

  var sections = [].slice.call(document.querySelectorAll("section[id]"));
  if (!sections.length) return;

  var meta = sections.map(function (el, i) {
    return { el: el, label: labelFor(el), order: i, since: 0 };
  });

  // ── visible-time accounting ──────────────────────────────────────────
  var pageVisible = document.visibilityState !== "hidden";
  var pageSince = pageVisible ? now() : 0;
  var maxOrder = -1;

  function now() { return Date.now(); }

  function addSection(m) {
    if (!m.since) return;
    var secs = (now() - m.since) / 1000;
    m.since = 0;
    if (secs <= 0) return;
    state.sections[m.label] = (state.sections[m.label] || 0) + secs;
  }

  function settleAll() {
    if (pageSince) {
      state.seconds += (now() - pageSince) / 1000;
      pageSince = pageVisible ? now() : 0;
    }
    meta.forEach(function (m) {
      if (m.since) { addSection(m); if (pageVisible && m.onScreen) m.since = now(); }
    });
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var m = meta[sections.indexOf(entry.target)];
        if (!m) return;
        var on = entry.isIntersecting;
        if (on === Boolean(m.onScreen)) return;
        m.onScreen = on;
        if (on) {
          if (pageVisible) m.since = now();
          if (m.order > maxOrder) { maxOrder = m.order; state.furthest = m.label; }
        } else {
          addSection(m);
        }
      });
    }, { rootMargin: CENTRE_BAND, threshold: 0 });
    sections.forEach(function (el) { io.observe(el); });
  }

  // ── deliberate expansions ────────────────────────────────────────────
  document.addEventListener("toggle", function (e) {
    var el = e.target;
    if (!el || el.tagName !== "DETAILS" || !el.open) return;
    var summary = el.querySelector("summary");
    var label = clean((summary && summary.textContent) || "Expanded section");
    if (state.expanded.indexOf(label) === -1) {
      state.expanded.push(label);
      persist();
    }
  }, true);

  // ── visibility: stop the clock when the tab isn't in front ───────────
  document.addEventListener("visibilitychange", function () {
    var visible = document.visibilityState !== "hidden";
    if (visible === pageVisible) return;
    settleAll();
    pageVisible = visible;
    if (visible) {
      pageSince = now();
      meta.forEach(function (m) { if (m.onScreen) m.since = now(); });
    } else {
      pageSince = 0;
      meta.forEach(function (m) { m.since = 0; });
      send(false);
    }
  });

  // ── beacons ──────────────────────────────────────────────────────────
  var sent = false;

  function payload(final) {
    var rounded = {};
    Object.keys(state.sections).forEach(function (k) {
      var v = Math.round(state.sections[k]);
      if (v > 0) rounded[k] = v;
    });
    return JSON.stringify({
      k: token,
      slug: slug,
      sid: state.sid,
      final: final === true,
      seconds: Math.round(state.seconds),
      sections: rounded,
      expanded: state.expanded,
      furthest: state.furthest,
      title: document.title
    });
  }

  function send(final) {
    settleAll();
    persist();
    var body = payload(final);
    try {
      if (navigator.sendBeacon) {
        // Blob with an explicit type keeps it a simple request (no preflight).
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
        return;
      }
    } catch (e) { /* fall through to fetch */ }
    try {
      fetch(ENDPOINT, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* tracking must never break the page */ }
  }

  setInterval(function () { if (pageVisible) send(false); }, BATCH_MS);

  // pagehide fires reliably on mobile Safari where unload does not.
  window.addEventListener("pagehide", function () {
    if (sent) return;
    sent = true;
    send(true);
  });
})();
