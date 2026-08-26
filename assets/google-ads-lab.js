/**
 * Google Ads Lab — the tool itself.
 *
 * Drives the whole run: URL capture → qualify → gate → live stages →
 * the generated pack. Pairs with /assets/google-ads-lab.css and the
 * _partials/google-ads-lab-{form,flow,booking}.html markup, so the tool
 * can be dropped onto any page (the lab page, a location page) rather
 * than living inline on one.
 *
 * Sitewide hooks it uses, all optional: window.zibClickIds / zibQualify /
 * zibLead / zibQualifiedLead / zibNurtureLead / zibPackDelivered /
 * zibCallBooked from /assets/conversion.js.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const heroForm = $('heroForm'), heroUrl = $('heroUrl');
  // No tool markup on this page — nothing to wire up.
  if (!heroForm) return;
  const stages = Array.from(document.querySelectorAll('.gal-stage'));
  const elapsed = $('elapsed'), elapsedT = elapsed?.querySelector('.t');
  const gateSec = $('gate'), gateForm = $('gateForm');
  const qualSec = $('qualify');
  const reveal = $('reveal'), brandLbl = $('brandLabel');
  const state = { url: '', email: '', brand: null, pack: null, assets: { logo: null, colors: [] }, isRunning: false };
  let elapsedStart = 0, elapsedTick = null;

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const startElapsed = () => { elapsedStart = Date.now(); elapsed.classList.add('is-on'); elapsed.classList.remove('is-done'); elapsedTick = setInterval(() => { elapsedT.textContent = ((Date.now() - elapsedStart) / 1000).toFixed(1) + 's'; }, 50); };
  const stopElapsed = () => { if (elapsedTick) { clearInterval(elapsedTick); elapsedTick = null; } elapsed.classList.add('is-done'); };
  const resetStages = () => stages.forEach(s => { s.classList.remove('is-active', 'is-done'); s.querySelector('.timer').textContent = 'Queued'; });
  const stageActive = (i, msg) => { const s = stages[i]; if (!s) return; s.classList.remove('is-done'); s.classList.add('is-active'); s.querySelector('.timer').textContent = msg || 'Running…'; };
  const stageDone = (i) => { const s = stages[i]; if (!s) return; s.classList.remove('is-active'); s.classList.add('is-done'); s.querySelector('.timer').textContent = `${((Date.now() - elapsedStart) / 1000).toFixed(1)}s · done`; };


  // ── Live brand board ─────────────────────────────────────────────
  const waitHub = $('waitHub'), hubLogo = $('hubLogo'), hubName = $('hubName'), hubCat = $('hubCat');
  const hubTagline = $('hubTagline'), hubColors = $('hubColors'), hubSwatches = $('hubSwatches');
  const hubKw = $('hubKw'), hubTicker = $('hubTicker');
  let tickerTimer = null, tickerIdx = 0, renderedCount = 0;

  const setTicker = (html) => {
    hubTicker.classList.add('is-fading');
    setTimeout(() => { hubTicker.innerHTML = html; hubTicker.classList.remove('is-fading'); }, 240);
  };
  const hubSetBrand = (brand) => {
    hubName.textContent = brand.name || 'Your brand';
    hubCat.textContent = brand.category || '';
    if (brand.tagline) { hubTagline.hidden = false; hubTagline.querySelector('.v').textContent = brand.tagline; }
    if (!state.assets.logo && brand.name) hubLogo.textContent = brand.name.slice(0, 1).toUpperCase();
    setTicker('Brand DNA locked. Writing the ads…');
  };
  const hubSetAssets = (assets) => {
    if (assets.logo) { hubLogo.innerHTML = `<img src="${esc(assets.logo)}" alt="">`; hubLogo.classList.add('is-filled'); }
    if (assets.colors && assets.colors.length) {
      hubColors.hidden = false;
      hubSwatches.innerHTML = assets.colors.map(c => `<div class="sw" style="background:${esc(c)}" title="${esc(c)}"></div>`).join('');
      hubSwatches.querySelectorAll('.sw').forEach((sw, i) => setTimeout(() => sw.classList.add('is-in'), 150 + i * 140));
    }
  };
  // Once the pack lands, rotate its RSA headlines with a live render count.
  const startTicker = () => {
    if (tickerTimer) clearInterval(tickerTimer);
    tickerIdx = 0;
    const heads = (state.pack && state.pack.search && state.pack.search.headlines) || [];
    const kws = (state.pack && state.pack.keywordThemes) || [];
    if (kws.length) { hubKw.hidden = false; hubKw.querySelector('.v').textContent = kws.map(k => k.theme).slice(0, 3).join(' · '); }
    if (!heads.length) return;
    const total = ((state.pack.pmax || {}).images || []).length;
    const tick = () => {
      const progress = renderedCount
        ? `Rendering image assets · ${renderedCount} of ${total} done`
        : `Headline ${(tickerIdx % heads.length) + 1} of ${heads.length} written`;
      setTicker(`${progress} · <em>“${esc(heads[tickerIdx % heads.length])}”</em>`);
      tickerIdx++;
    };
    tick();
    tickerTimer = setInterval(tick, 3800);
  };
  const hubReset = () => {
    if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
    renderedCount = 0; tickerIdx = 0;
    hubLogo.innerHTML = ''; hubLogo.classList.remove('is-filled');
    hubName.innerHTML = '<span class="skel"></span>'; hubCat.textContent = '';
    hubTagline.hidden = true; hubColors.hidden = true; hubKw.hidden = true;
    hubSwatches.innerHTML = '';
    hubTicker.innerHTML = 'Crawling the site + Transparency Center…';
  };
  const startWaitHub = () => {
    if (!waitHub || !waitHub.hidden) return;
    hubReset();
    // The quiz has already run — this card now confirms what's coming rather
    // than asking anything, so the wait stays occupied without a second ask.
    renderPackChecklist();
    waitHub.hidden = false;
    requestAnimationFrame(() => waitHub.classList.add('is-on'));
  };
  const stopWaitHub = () => {
    if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
    if (!waitHub || waitHub.hidden) return;
    waitHub.classList.remove('is-on');
    setTimeout(() => { waitHub.hidden = true; }, 500);
  };

  // ── Qualify step (runs BEFORE the gate, see the #qualify section) ─
  const qualBody = $('qualBody');
  const quizBody = $('quizBody');
  // `v` is the stable key the scoring reads; `label` is what the visitor sees
  // and what lands in HubSpot, so sales reads words rather than slugs.
  const QUIZ = [
    { key: 'spend', q: 'What do you spend on ads per month?', sub: 'Sets the budget plan and bidding advice in your pack.', options: [
      { v: 'none', label: 'Nothing yet' },
      { v: 'under-1k', label: 'Under $1k' },
      { v: '1k-3k', label: '$1k – $3k' },
      { v: '3k-10k', label: '$3k – $10k' },
      { v: '10k-plus', label: '$10k+' },
    ] },
    { key: 'dealValue', q: "What's a new customer typically worth to you?", sub: 'Decides whether the spend plan can actually pay for itself.', options: [
      { v: 'lt500', label: 'Under $500' },
      { v: '500-2k', label: '$500 – $2k' },
      { v: '2k-10k', label: '$2k – $10k' },
      { v: '10k-50k', label: '$10k – $50k' },
      { v: 'gt50k', label: '$50k+' },
      { v: 'unsure', label: 'Not sure' },
    ] },
    { key: 'goal', q: 'What matters most right now?', sub: 'Decides which keyword themes we build around.', options: [
      { v: 'more-leads', label: 'More leads' },
      { v: 'cheaper-leads', label: 'Cheaper leads' },
      { v: 'new-market', label: 'New market or launch' },
      { v: 'competitor', label: 'Beating a competitor' },
    ] },
  ];
  const quizAnswers = {};
  const quizLabels = {};

  const renderQuizStep = (step) => {
    if (step >= QUIZ.length) { revealGate(); return; }
    const q = QUIZ[step];
    qualBody.innerHTML = `
      <div class="qual-q">${q.q}</div>
      <div class="q-chips">${q.options.map(o =>
        `<button type="button" data-v="${esc(o.v)}" data-label="${esc(o.label)}">${esc(o.label)}</button>`).join('')}</div>
      <div class="q-step">Question ${step + 1} of ${QUIZ.length} · ${esc(q.sub)}</div>`;
    qualBody.querySelectorAll('.q-chips button').forEach(b =>
      b.addEventListener('click', () => {
        quizAnswers[q.key] = b.dataset.v;
        quizLabels[q.key] = b.dataset.label;
        renderQuizStep(step + 1);
      }));
  };
  const renderPackChecklist = () => {
    quizBody.innerHTML = `
      <h3>Locked in. Here's what's coming.</h3>
      <ul class="q-done-list">
        <li><span class="tick">✓</span>A commercial audit of your current Google Ads footprint</li>
        <li><span class="tick">✓</span>A full Responsive Search Ad inside Google's character limits</li>
        <li><span class="tick">✓</span>Keyword themes a Premier Partner would bid on</li>
        <li><span class="tick">✓</span>A Performance Max asset group with branded images</li>
        <li><span class="tick">✓</span>Senior strategist call within 24 hours, already briefed</li>
      </ul>`;
    quizBody.querySelectorAll('.q-done-list li').forEach((li, i) =>
      setTimeout(() => li.classList.add('is-in'), 200 + i * 220));
  };
  // Sent once the gate hands us an email — the answers are already in hand by
  // then, so this is the only round-trip and it never blocks the pack.
  const submitQuiz = () => {
    fetch('/api/lab-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: state.email || '', url: state.url,
        budget: quizLabels.spend || '', goal: quizLabels.goal || '',
        dealValue: quizLabels.dealValue || '',
        spendKey: quizAnswers.spend || '', dealValueKey: quizAnswers.dealValue || '',
        goalKey: quizAnswers.goal || '',
        tier: state.qualification?.tier || '',
        score: state.qualification?.score ?? null,
        clickIds: (window.zibClickIds && window.zibClickIds()) || {},
        lab: 'Google Ads Lab',
      }),
    }).catch(() => {});
  };

  /* ─── Post-pack branch · calendar or nurture ────────────────────── */
  const MEETINGS_SRC = 'https://meetings.hubspot.com/mglasser';
  let meetingsLoaded = false;

  const loadMeetingsEmbed = (container, email, firstname) => {
    // Prefill what we know so booking is a time-pick, not a re-typed form.
    const src = MEETINGS_SRC + '?embed=true'
      + (email ? '&email=' + encodeURIComponent(email) : '')
      + (firstname ? '&firstName=' + encodeURIComponent(firstname) : '');
    container.innerHTML =
      `<div class="meetings-iframe-container" data-src="${src}"></div>` +
      `<span class="cal-fallback">Prefer email? <a href="mailto:michael.glasser@zibdigital.com.au">Reply to the pack instead</a>.</span>`;
    if (meetingsLoaded) return;
    meetingsLoaded = true;
    // Loaded only when a qualified lead reaches this point — never on a page
    // view, and never for a nurture lead.
    const tag = document.createElement('script');
    tag.src = 'https://static.hsappstatic.net/MeetingsEmbed/ex/MeetingsEmbedCode.js';
    tag.async = true;
    document.body.appendChild(tag);
  };

  // HubSpot's embed reports a completed booking by postMessage. That's the
  // strongest signal the page can produce, so it gets its own event.
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.meetingBookSucceeded !== true) return;
    window.zibCallBooked && window.zibCallBooked({
      tool: 'Google Ads Lab',
      email: state.email,
      tier: state.qualification?.tier,
      score: state.qualification?.score,
    });
  });

  const renderAfterBranch = () => {
    const after = $('revealAfter');
    const qualified = $('afterQualified');
    const nurture = $('afterNurture');
    if (!after || !qualified || !nurture) return;
    const salesReady = state.qualification?.salesReady;
    qualified.hidden = !salesReady;
    nurture.hidden = !!salesReady;
    after.hidden = false;
    if (salesReady) loadMeetingsEmbed($('afterCal'), state.email, state.firstname);
  };


  /* ─── Sticky booking CTA + calendar modal ───────────────────────── */
  const bookBar = $('bookBar');
  const bookModal = $('bookModal');
  let bookDismissed = false;

  const showBookBar = () => {
    // Sales-ready tiers only. A nurture lead has already been told the pack
    // is in their inbox; putting a calendar in front of them undoes the
    // whole point of asking the questions.
    if (bookDismissed || !bookBar || !state.qualification?.salesReady) return;
    bookBar.hidden = false;
    document.body.classList.add('has-book-bar');
    requestAnimationFrame(() => bookBar.classList.add('is-in'));
  };

  const hideBookBar = () => {
    if (!bookBar) return;
    bookBar.classList.remove('is-in');
    document.body.classList.remove('has-book-bar');
    setTimeout(() => { bookBar.hidden = true; }, 420);
  };

  const closeBookModal = () => {
    if (!bookModal || bookModal.hidden) return;
    bookModal.classList.remove('is-in');
    document.documentElement.style.overflow = '';
    setTimeout(() => { bookModal.hidden = true; }, 320);
    $('bookBarCta')?.focus();
  };

  const openBookModal = () => {
    if (!bookModal) return;
    bookModal.hidden = false;
    // Lock the page behind the modal so a scroll gesture drives the calendar
    // rather than the ad grid underneath it.
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => bookModal.classList.add('is-in'));
    loadMeetingsEmbed($('bookModalCal'), state.email, state.firstname);
    $('bookModalClose')?.focus();

    // Opening the calendar is a real intent signal short of a booking —
    // useful as a retargeting audience. dataLayer only: it doesn't warrant
    // another Meta custom event competing with CallBooked.
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'zib_booking_opened',
        zib_tool: 'Google Ads Lab',
        zib_lead_tier: state.qualification?.tier || '',
        zib_lead_score: state.qualification?.score ?? null,
      });
    } catch {}
  };

  $('bookBarCta')?.addEventListener('click', openBookModal);
  $('bookBarClose')?.addEventListener('click', () => { bookDismissed = true; hideBookBar(); });
  $('bookModalClose')?.addEventListener('click', closeBookModal);
  bookModal?.querySelector('[data-book-close]')?.addEventListener('click', closeBookModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBookModal(); });

  // A booking closes the loop — drop the bar rather than keep nagging someone
  // who has already picked a time.
  window.addEventListener('message', (e) => {
    if (e.data && e.data.meetingBookSucceeded === true) { bookDismissed = true; hideBookBar(); }
  });

  const ratioClass = (r) => /1:1/.test(r) ? 'square' : /4:5/.test(r) ? 'portrait' : '';

  const renderPack = () => {
    const p = state.pack; if (!p) return;
    const brand = p.brand || {};
    brandLbl.textContent = brand.name || 'your brand';

    // audit
    $('auditGrid').innerHTML = (p.audit || []).map(a =>
      `<div class="gal-audit-card"><div class="t">${esc(a.title)}</div><div class="d">${esc(a.detail)}</div></div>`).join('');
    if (p.transparency?.url) $('transpLink').href = p.transparency.url;

    // RSA search mockup — show up to 3 headlines + 2 descriptions
    const s = p.search || {};
    const heads = s.headlines || [], descs = s.descriptions || [];
    const initial = (brand.name || '').slice(0, 1).toUpperCase() || 'A';
    const path = (s.paths || []).filter(Boolean).join('/');
    $('serp').innerHTML = `
      <div class="sponsored">Sponsored</div>
      <div class="url-row">
        <div class="fav">${state.assets.logo ? `<img src="${esc(state.assets.logo)}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:999px;">` : esc(initial)}</div>
        <div class="url">${esc(brand.name || '')}<br><span class="path">${esc(brand.domain || '')}${path ? ' › ' + esc(path.replace(/\//g, ' › ')) : ''}</span></div>
      </div>
      <div class="title">${esc(heads.slice(0, 3).join(' | '))}</div>
      <div class="desc">${esc(descs.slice(0, 2).join(' '))}</div>
      <div class="ext">${(s.headlines || []).slice(3, 7).map(h => `<a href="#">${esc(h)}</a>`).join('')}</div>`;

    $('hCount').textContent = heads.length;
    $('rsaHeadlines').innerHTML = heads.map(h => `<span class="gal-chip">${esc(h)}<span class="c">${h.length}</span></span>`).join('');
    $('rsaDescriptions').innerHTML = descs.map(d => `<li>${esc(d)}</li>`).join('');

    // keyword themes
    $('kwGrid').innerHTML = (p.keywordThemes || []).map(k =>
      `<div class="gal-kw"><div class="th">${esc(k.theme)}</div><div class="ex">${esc(k.examples)}</div></div>`).join('');

    // PMAX text
    const px = p.pmax || {};
    $('pmaxShort').innerHTML = (px.shortHeadlines || []).map(h => `<span class="gal-chip">${esc(h)}<span class="c">${h.length}</span></span>`).join('');
    $('pmaxLong').innerHTML = (px.longHeadlines || []).map(h => `<li>${esc(h)}</li>`).join('');
    $('pmaxDesc').innerHTML = (px.descriptions || []).map(d => `<li>${esc(d)}</li>`).join('');
    $('pmaxCallouts').innerHTML = (px.callouts || []).map(c => `<span class="gal-chip">${esc(c)}</span>`).join('');
    $('pmaxSitelinks').innerHTML = (px.sitelinks || []).map(sl => `<li><strong>${esc(sl.text)}</strong> — ${esc(sl.desc)}</li>`).join('');

    // PMAX images (placeholders; fill via pmax-image events)
    $('pmaxImgGrid').innerHTML = (px.images || []).map((img, i) =>
      `<div class="gal-img-card" data-img-idx="${i}">
         <div class="gal-img-visual placeholder ${ratioClass(img.ratio)}"></div>
         <div class="gal-img-meta"><span class="ratio">${esc(img.ratio)}</span><span class="concept">${esc(img.concept || '')}</span></div>
       </div>`).join('');

    if (reveal.hidden) {
      reveal.hidden = false;

      // The pack genuinely rendered. `zibLead` fired when the server accepted
      // the submission, which isn't proof anything was delivered — a run that
      // dies mid-stream still counts as a Lead. This is the honest signal.
      window.zibPackDelivered && window.zibPackDelivered({
        tool: 'Google Ads Lab',
        url: state.url,
        email: state.email,
        tier: state.qualification?.tier,
        score: state.qualification?.score,
      });
      renderAfterBranch();
      showBookBar();
      stopWaitHub();
      setTimeout(() => {
        reveal.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('.gal-img-card').forEach((c, i) => setTimeout(() => c.classList.add('is-revealed'), 200 + i * 90));
      }, 400);
    }
  };

  const setImage = (idx, url) => {
    const card = document.querySelector(`[data-img-idx="${idx}"]`);
    if (!card) return;
    const v = card.querySelector('.gal-img-visual');
    v.classList.remove('placeholder');
    v.style.backgroundImage = `url('${url}')`;
  };

  const showError = (msg) => {
    stages.forEach(s => { s.classList.remove('is-active', 'is-done'); s.querySelector('.timer').textContent = ''; });
    stopWaitHub();
    stopElapsed(); elapsedT.textContent = 'Failed';
    const head = document.querySelector('.gal-stages h2');
    if (head && !$('galErr')) head.insertAdjacentHTML('afterend',
      `<p id="galErr" style="margin-top:14px;color:var(--score-bad);font-size:15px;">Something went wrong: ${esc(msg)}. Try a different URL.</p>`);
  };

  const handleEvent = (event, payload) => {
    if (event === 'stage') {
      if (payload.status === 'active') stageActive(payload.idx, payload.message);
      if (payload.status === 'done') stageDone(payload.idx);
    } else if (event === 'transparency') {
      if (payload.url) $('transpLink').href = payload.url;
      const el = $('transpSummary');
      if (el) {
        el.hidden = false;
        if (payload.found) {
          el.innerHTML = `<span class="dot"></span><div><strong>Live from the Transparency Center:</strong> matched advertiser “${esc(payload.advertiserName)}”${payload.region ? ' (' + esc(payload.region) + ')' : ''}, running <strong>${esc(payload.adCountLabel || 'ads')}</strong> ad variations right now${payload.verified ? ', verified advertiser' : ''}. The audit below reads that live footprint.</div>`;
          $('transpLink').textContent = 'Open their advertiser page in the Transparency Center →';
        } else {
          el.innerHTML = `<span class="dot"></span><div>No matching advertiser found in the Google Ads Transparency Center. You may not be running Google Ads yet — that is the opportunity the pack below is built around.</div>`;
        }
      }
    } else if (event === 'brand') {
      state.brand = payload; brandLbl.textContent = payload.name || 'your brand';
      hubSetBrand(payload);
    } else if (event === 'brand-assets') {
      state.assets = { logo: payload.logo || null, colors: Array.isArray(payload.colors) ? payload.colors : [] };
      hubSetAssets(state.assets);
    } else if (event === 'pack') {
      state.pack = payload; renderPack(); startTicker();
    } else if (event === 'pmax-image') {
      if (typeof payload.idx === 'number' && payload.image_url) {
        setImage(payload.idx, payload.image_url);
        renderedCount++;
        const s3 = stages[3];
        const total = ((state.pack?.pmax || {}).images || []).length;
        if (s3 && total) s3.querySelector('.timer').textContent = `${renderedCount} of ${total} rendered`;
      }
    } else if (event === 'done') {
      stopWaitHub();
      stopElapsed();
    } else if (event === 'error') {
      showError(payload.message || 'unknown');
    }
  };

  const consumeSse = async (resp) => {
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let eventName = 'message', data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        let p = {}; try { p = data ? JSON.parse(data) : {}; } catch {}
        handleEvent(eventName, p);
      }
    }
  };

  // Step 1: URL → email gate
  heroForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.isRunning) return;
    // The visible "https://" prefix means people type only the domain. Strip any
    // protocol they paste in and prepend https:// so the submitted URL is valid.
    const typed = heroUrl.value.trim().replace(/^https?:\/\//i, '');
    state.url = typed ? 'https://' + typed : '';
    $('galErr')?.remove();
    resetStages(); reveal.hidden = true;
    state.assets = { logo: null, colors: [] };
    if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
    waitHub.classList.remove('is-on'); waitHub.hidden = true;
    // A fresh URL means a fresh set of answers — don't carry the last run's
    // tier over onto a different business.
    Object.keys(quizAnswers).forEach((k) => delete quizAnswers[k]);
    Object.keys(quizLabels).forEach((k) => delete quizLabels[k]);
    state.qualification = null;
    bookDismissed = false;
    hideBookBar();
    $('revealAfter')?.setAttribute('hidden', '');
    // Qualify first. The gate only appears once both chips are answered, so
    // there is no path to the pack that skips them.
    gateSec.hidden = true;
    qualSec.hidden = false;
    renderQuizStep(0);
    requestAnimationFrame(() => qualSec.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });

  /**
   * Both chips answered — score them, then hand over to the email gate.
   * The tier is held on `state` so the gate submit can report it and the
   * reveal can decide whether to offer a calendar.
   */
  function revealGate() {
    state.qualification = (window.zibQualify && window.zibQualify(quizAnswers)) || { tier: 'review', score: 0, salesReady: true };
    qualSec.hidden = true;
    gateSec.hidden = false;
    requestAnimationFrame(() => gateSec.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setTimeout(() => gateForm.querySelector('input[name=name]')?.focus(), 600);
  }

  // Step 2: email → generate
  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isRunning) return;
    state.isRunning = true;
    const btn = gateForm.querySelector('.submit');
    btn.disabled = true; btn.textContent = 'Building…';
    const fd = new FormData(gateForm);
    state.email = (fd.get('email') || '').toString().trim();
    const qual = state.qualification || { tier: 'review', score: 0, salesReady: true };
    state.firstname = (fd.get('name') || '').toString().trim();
    const payload = {
      url: state.url,
      email: state.email,
      firstname: (fd.get('name') || '').toString().trim(),
      phone: (fd.get('phone') || '').toString().trim(),
      sourceTag: document.querySelector('meta[name="zib:source-tag"]')?.content || '',
      // The answers travel with the lead so the server can score them and
      // HubSpot has the tier the moment the contact is created, rather than
      // a note that lands seconds later. The server scores, not the browser.
      spend: quizLabels.spend || '',
      goal: quizLabels.goal || '',
      dealValue: quizLabels.dealValue || '',
      spendKey: quizAnswers.spend || '',
      dealValueKey: quizAnswers.dealValue || '',
      goalKey: quizAnswers.goal || '',
      // Ad click ids, so HubSpot outcomes can be uploaded back to Google and
      // Meta later. See docs/offline-conversions.md.
      clickIds: (window.zibClickIds && window.zibClickIds()) || {},
    };
    gateSec.style.transition = 'opacity 320ms ease'; gateSec.style.opacity = '0';
    setTimeout(() => { gateSec.hidden = true; gateSec.style.opacity = ''; $('flow').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 320);
    await new Promise(r => setTimeout(r, 500));
    startElapsed();
    startWaitHub();
    try {
      const resp = await fetch('/api/google-ads-lab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || `${resp.status}`); }

      // Lead captured — the server accepted it and is pushing it to HubSpot.
      // This is the conversion point; the pack streams into this same view, so
      // there's no thank-you page load for the pixel to fire on.
      window.zibLead && window.zibLead({ tool: 'Google Ads Lab', url: payload.url, email: payload.email });

      // …and the quality signal on top. `Lead` fires for everyone so the
      // historical numbers stay comparable; this is the one worth optimising
      // and building audiences against.
      const quality = { tool: 'Google Ads Lab', url: payload.url, email: payload.email, tier: qual.tier, score: qual.score };
      if (qual.salesReady) window.zibQualifiedLead && window.zibQualifiedLead(quality);
      else window.zibNurtureLead && window.zibNurtureLead(quality);

      // The answers now have an email to hang off, so send them.
      submitQuiz();

      await consumeSse(resp);
    } catch (err) {
      showError(err?.message || 'Request failed');
      btn.disabled = false; btn.innerHTML = 'Build my Google Ads <span class="arr">→</span>';
      gateSec.hidden = false;
    } finally {
      state.isRunning = false;
    }
  });
})();
