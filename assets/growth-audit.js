/**
 * Growth Audit — orchestrates the three existing tool endpoints from one URL.
 *
 *   /api/audit            SSE  technical SEO + strategist read
 *   /api/google-ads-lab   SSE  live Transparency Center footprint + account audit
 *   /api/meta-ads-lab     SSE  audience, strategy and ad concepts
 *
 * All three are POST + Server-Sent Events, so EventSource is no use (it is
 * GET only) — each stream is read off fetch's body reader instead.
 *
 * The three tracks are deliberately independent. One endpoint failing, or
 * being rate limited, leaves the others untouched and the report renders
 * whatever finished with an honest note where a section is missing. A tool
 * that returns nothing because one channel errored is worse than one that
 * returns two thirds.
 *
 * All three require an email, which is why the contact gate runs before the
 * audits rather than in front of the results.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const urlForm = $('gaUrlForm');
  if (!urlForm) return;

  const state = { url: '', domain: '', lead: null, started: 0,
                  seo: null, gads: null, meta: null,
                  seoProse: '', errors: {}, competitors: null };

  const show = (el) => el && el.classList.remove('ga-hide');
  const hide = (el) => el && el.classList.add('ga-hide');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const bareDomain = (input) => {
    try {
      return new URL(input.startsWith('http') ? input : 'https://' + input)
        .hostname.replace(/^www\./, '').toLowerCase();
    } catch { return input.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase(); }
  };

  /* ── Step 1 · URL ──────────────────────────────────────────────── */
  urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('gaUrl').value.trim().replace(/^https?:\/\//i, '');
    if (!raw || !raw.includes('.')) {
      const err = $('gaUrlErr');
      err.textContent = 'Enter a website address, like yourbusiness.com.au';
      show(err);
      return;
    }
    hide($('gaUrlErr'));
    state.url = 'https://' + raw;
    state.domain = bareDomain(raw);
    $('gaGateDomain').textContent = state.domain;
    hide($('ga-hero'));
    show($('ga-gate'));
    $('ga-gate').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('gaFirst').focus();
  });

  /* Handoff from the automotive page: /growth-audit?url=… arrives with the
     URL already typed, so go straight to the gate rather than asking twice. */
  const handoff = new URLSearchParams(location.search).get('url');
  if (handoff && handoff.trim()) {
    $('gaUrl').value = handoff.trim().replace(/^https?:\/\//i, '');
    if ($('gaUrl').value.includes('.')) {
      urlForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  }

  /* ── Step 2 · Gate ─────────────────────────────────────────────── */
  $('gaGateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('gaEmail').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const err = $('gaGateErr');
      err.textContent = 'That email address does not look right.';
      show(err);
      return;
    }
    hide($('gaGateErr'));
    state.lead = {
      firstname: $('gaFirst').value.trim(),
      company: $('gaCompany').value.trim(),
      email,
      phone: $('gaPhone').value.trim(),
    };
    $('gaGateBtn').disabled = true;
    hide($('ga-gate'));
    show($('ga-run'));
    $('gaRunDomain').textContent = state.domain;
    $('ga-run').scrollIntoView({ behavior: 'smooth', block: 'start' });
    runAll();
  });

  /* ── SSE over POST ─────────────────────────────────────────────── */
  async function stream(endpoint, body, onEvent) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      let msg = 'Request failed (' + res.status + ')';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // SSE frames are separated by a blank line; a frame can straddle chunks.
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = 'message', data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        onEvent(ev, parsed);
      }
    }
  }

  const track = (id, cls, msg) => {
    const el = $(id);
    if (!el) return;
    el.classList.remove('is-running', 'is-done', 'is-failed');
    if (cls) el.classList.add(cls);
    if (msg != null) el.querySelector('.ga-track-status').textContent = msg;
  };

  /* ── Step 3 · Run all three ────────────────────────────────────── */
  function runAll() {
    state.started = Date.now();
    const tick = setInterval(() => {
      $('gaElapsed').textContent = Math.round((Date.now() - state.started) / 1000) + 's elapsed';
    }, 1000);

    const base = { url: state.url, ...state.lead, sourceTag: 'Growth Audit' };

    const seo = (async () => {
      track('trk-seo', 'is-running', 'Starting…');
      // mode "seo" skips the sample-ad image generation: this report has its
      // own creative section from the Meta track, so that work is wasted here.
      await stream('/api/audit', { ...base, mode: 'seo' }, (ev, d) => {
        if (ev === 'status') track('trk-seo', 'is-running', d.message || 'Working…');
        else if (ev === 'checks') { state.seo = d; track('trk-seo', 'is-running', 'Scoring pages…'); }
        else if (ev === 'chunk') state.seoProse += (d.text || d.delta || '');
        else if (ev === 'error') throw new Error(d.message || 'SEO audit failed');
      });
      track('trk-seo', 'is-done', 'Done');
    })().catch((e) => { state.errors.seo = e.message; track('trk-seo', 'is-failed', e.message); });

    const gads = (async () => {
      track('trk-gads', 'is-running', 'Starting…');
      await stream('/api/google-ads-lab', base, (ev, d) => {
        if (ev === 'stage' && d.message) track('trk-gads', 'is-running', d.message);
        else if (ev === 'transparency') {
          state.gads = Object.assign({}, state.gads, { transparency: d });
          track('trk-gads', 'is-running', d.found
            ? 'Found them running ads — auditing…'
            : 'No live Google Ads found — checking the opportunity…');
        } else if (ev === 'pack') state.gads = Object.assign({}, state.gads, d);
        else if (ev === 'error') throw new Error(d.message || 'Google Ads audit failed');
      });
      track('trk-gads', 'is-done', 'Done');
    })().catch((e) => { state.errors.gads = e.message; track('trk-gads', 'is-failed', e.message); });

    const meta = (async () => {
      track('trk-meta', 'is-running', 'Starting…');
      await stream('/api/meta-ads-lab', base, (ev, d) => {
        if (ev === 'stage' && d.message) track('trk-meta', 'is-running', d.message);
        else if (ev === 'ads') state.meta = d;
        else if (ev === 'error') throw new Error(d.message || 'Meta audit failed');
      });
      track('trk-meta', 'is-done', 'Done');
    })().catch((e) => { state.errors.meta = e.message; track('trk-meta', 'is-failed', e.message); });

    Promise.allSettled([seo, gads, meta]).then(() => {
      clearInterval(tick);
      render();
    });
  }

  /* ── Step 4 · Report ───────────────────────────────────────────── */
  const missing = (what, why) =>
    `<div class="ga-missing"><strong>${esc(what)} isn't in this report.</strong> ${esc(why)} Matt can pull it manually on the call.</div>`;

  function renderSeo() {
    const el = $('gaSeoBody');
    if (!state.seo) { el.innerHTML = missing('The technical SEO audit', state.errors.seo || 'The audit did not finish.'); return; }
    const s = state.seo;
    const score = s.overallScore != null ? s.overallScore : '—';
    const cls = typeof score === 'number' ? (score >= 70 ? 'is-good' : score < 45 ? 'is-bad' : '') : '';
    let html = `<div class="ga-stats">
      <div class="ga-stat ${cls}"><div class="v">${esc(score)}</div><div class="k">Overall score</div></div>
      <div class="ga-stat is-good"><div class="v">${esc(s.passed ?? '—')}</div><div class="k">Checks passed</div></div>
      <div class="ga-stat is-bad"><div class="v">${esc(s.issues ?? '—')}</div><div class="k">Issues found</div></div>
      <div class="ga-stat"><div class="v">${esc(s.pagesCrawled ?? '—')}</div><div class="k">Pages crawled</div></div>
    </div>`;
    if (state.seoProse.trim()) {
      const paras = state.seoProse.trim().split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
      html += `<div class="ga-prose">${paras}</div>`;
    }
    el.innerHTML = html;
  }

  function renderGads() {
    const el = $('gaGadsBody');
    if (!state.gads) { el.innerHTML = missing('The Google Ads audit', state.errors.gads || 'The audit did not finish.'); return; }
    const g = state.gads;
    const t = g.transparency || {};
    let html = '';
    if (t.found) {
      html += `<div class="ga-stats">
        <div class="ga-stat is-good"><div class="v">Live</div><div class="k">Running Google Ads now</div></div>
        <div class="ga-stat"><div class="v">${esc(t.adCountLabel || '—')}</div><div class="k">Ads in market</div></div>
        <div class="ga-stat"><div class="v">${esc(t.region || '—')}</div><div class="k">Region</div></div>
      </div>
      <p class="ga-note">Advertiser <strong>${esc(t.advertiserName || '')}</strong>${t.verified ? ', verified by Google' : ''}. Taken live from Google's own Ads Transparency Center, not estimated.</p>`;
    } else {
      html += `<div class="ga-stats">
        <div class="ga-stat is-bad"><div class="v">None</div><div class="k">Google Ads found</div></div>
      </div>
      <p class="ga-note">No matching advertiser in Google's Ads Transparency Center. Either you're not running Google Ads, or you advertise under a different legal name — worth confirming on the call.</p>`;
    }
    if (Array.isArray(g.audit) && g.audit.length) {
      html += '<ul class="ga-list">' + g.audit.map((a) => {
        const text = typeof a === 'string' ? a : (a.point || a.text || a.title || '');
        return text ? `<li>${esc(text)}</li>` : '';
      }).join('') + '</ul>';
    }
    if (Array.isArray(g.keywordThemes) && g.keywordThemes.length) {
      html += '<div class="ga-chips">' + g.keywordThemes.slice(0, 14).map((k) => {
        const text = typeof k === 'string' ? k : (k.theme || k.name || '');
        return text ? `<span class="ga-chip">${esc(text)}</span>` : '';
      }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  function renderMeta() {
    const el = $('gaMetaBody');
    if (!state.meta) { el.innerHTML = missing('The Meta Ads strategy', state.errors.meta || 'The run did not finish.'); return; }
    const m = state.meta;
    let html = '';
    if (m.audience) html += `<div class="ga-prose"><p><strong>Who we'd target.</strong> ${esc(typeof m.audience === 'string' ? m.audience : JSON.stringify(m.audience))}</p></div>`;
    if (m.strategy) {
      const st = m.strategy;
      const points = Array.isArray(st) ? st : (Array.isArray(st.points) ? st.points : []);
      if (points.length) {
        html += '<ul class="ga-list">' + points.map((p) => {
          const text = typeof p === 'string' ? p : (p.point || p.text || p.title || '');
          return text ? `<li>${esc(text)}</li>` : '';
        }).join('') + '</ul>';
      } else if (typeof st === 'string') {
        html += `<div class="ga-prose"><p>${esc(st)}</p></div>`;
      }
    }
    if (Array.isArray(m.ads) && m.ads.length) {
      html += `<p class="ga-note">${m.ads.length} ad concepts drafted for your brand. Matt will bring the creative to the call.</p>`;
    }
    el.innerHTML = html || missing('The Meta Ads strategy', 'The run returned no usable detail.');
  }

  function render() {
    $('gaRepDomain').textContent = state.domain;
    $('gaRepMeta').innerHTML =
      `Prepared for ${esc(state.lead.firstname || 'you')}<br>` +
      `${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}<br>` +
      `Zib Digital`;
    renderSeo(); renderGads(); renderMeta(); renderCompetitors();
    hide($('ga-run'));
    show($('ga-report'));
    $('ga-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Competitors · asked during the run, never blocking ─────────── */
  const compForm = $('gaCompForm');
  if (compForm) {
    compForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const names = ['gaComp1', 'gaComp2', 'gaComp3']
        .map((id) => $(id).value.trim()).filter(Boolean);
      const msg = $('gaCompMsg');
      if (!names.length) {
        msg.textContent = 'Add at least one name, or skip — your report is running either way.';
        show(msg);
        return;
      }
      $('gaCompBtn').disabled = true;
      msg.textContent = 'Looking them up…';
      show(msg);
      try {
        const res = await fetch('/api/competitor-ads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names, region: 'AU' }),
        });
        const data = await res.json();
        state.competitors = Array.isArray(data.results) ? data.results : [];
        msg.textContent = state.competitors.some((c) => c.found)
          ? 'Added to your report.'
          : "We couldn't match those in Google's Transparency Center — they may advertise under a different legal name.";
        // The report may already be on screen if the audits finished first.
        renderCompetitors();
      } catch {
        msg.textContent = "Couldn't reach the lookup. Your report is unaffected.";
      } finally {
        $('gaCompBtn').disabled = false;
      }
    });
  }

  function renderCompetitors() {
    const sec = $('gaSecComp');
    const body = $('gaCompBody');
    if (!sec || !body || !state.competitors || !state.competitors.length) return;

    // The client's own footprint comes from the Google Ads track. Without it
    // there is nothing to compare against, so show the competitors alone
    // rather than implying a comparison that isn't there.
    const mine = state.gads && state.gads.transparency && state.gads.transparency.found
      ? { name: state.domain, label: state.gads.transparency.adCountLabel || '—',
          max: Number(state.gads.transparency.adCountMax || 0), you: true }
      : null;

    const rows = (mine ? [mine] : []).concat(
      state.competitors.map((c) => ({
        name: c.found ? (c.name || c.query) : c.query,
        label: c.found ? (c.adCountLabel || 'unknown') : 'no live ads found',
        max: Number(c.adCountMax || 0),
        you: false,
      })),
    );
    const ceiling = Math.max(1, ...rows.map((r) => r.max));
    body.innerHTML = '<div class="ga-cmp">' + rows.map((r) => {
      const pct = Math.max(r.max > 0 ? 2 : 0, Math.round((r.max / ceiling) * 100));
      return `<div class="ga-cmp-row${r.you ? ' is-you' : ''}">
        <div class="ga-cmp-name">${esc(r.name)}${r.you ? ' (you)' : ''}</div>
        <div class="ga-cmp-bar"><div class="ga-cmp-fill" style="width:${pct}%"></div></div>
        <div class="ga-cmp-val">${esc(r.label)}</div>
      </div>`;
    }).join('') + '</div>' +
      `<p class="ga-note">Live ad counts from Google's Ads Transparency Center${mine ? '' : ' — we could not match your own domain to an advertiser, so only competitors are shown'}. Counts are Google's own published ranges, not estimates.</p>`;
    show(sec);
  }

  $('gaPrint').addEventListener('click', () => window.print());
})();
