/**
 * Shared audit widget — used by audit.html, index.html, seo-agency.html.
 * Expects these DOM ids on the page: auditForm, auditUrl, auditEmail, auditPhone,
 * auditBtn, auditStatus, auditStages, stageList, stageElapsed, auditResult,
 * resUrl, resSeoWall, wallDomain, statScore, statScoreBox, statPassed, statIssues,
 * statPages, catGrid, resRadar, resStrategist, resSampleAd, resAdImg, resPunchline.
 * If #auditForm is absent, the script is a no-op.
 */
(() => {
  const form = document.getElementById('auditForm');
  if (!form) return;

  const urlInput    = document.getElementById('auditUrl');
  const emailInput  = document.getElementById('auditEmail');
  const phoneInput  = document.getElementById('auditPhone');
  const btn         = document.getElementById('auditBtn');
  const statusEl    = document.getElementById('auditStatus');
  const resultEl    = document.getElementById('auditResult');
  const resUrl      = document.getElementById('resUrl');
  const resSeoWall    = document.getElementById('resSeoWall');
  const wallDomainEl  = document.getElementById('wallDomain');
  const statScoreEl   = document.getElementById('statScore');
  const statScoreBox  = document.getElementById('statScoreBox');
  const statPassedEl  = document.getElementById('statPassed');
  const statIssuesEl  = document.getElementById('statIssues');
  const statPagesEl   = document.getElementById('statPages');
  const catGridEl     = document.getElementById('catGrid');
  const resRadar      = document.getElementById('resRadar');
  const resStrategist = document.getElementById('resStrategist');
  const resSampleAd = document.getElementById('resSampleAd');
  const resAdImg    = document.getElementById('resAdImg');
  const resPunchline = document.getElementById('resPunchline');
  const stagesEl    = document.getElementById('auditStages');
  const stageListEl = document.getElementById('stageList');
  const stageElapsedEl = document.getElementById('stageElapsed');

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const setStatus = (msg, mode) => {
    statusEl.className = 'audit-status mono' + (mode ? ' is-' + mode : '');
    statusEl.innerHTML = mode === 'loading'
      ? `<span class="spinner" aria-hidden="true"></span><span>${msg}</span>`
      : msg;
  };
  const clearStatus = () => { statusEl.className = 'audit-status mono'; statusEl.textContent = ''; };

  /* ─── Stage tracker · real backend phases, elapsed timer, tick-off UX ── */
  const STAGE_ORDER = ['fetch', 'discover', 'crawl', 'score', 'think'];
  let stageStart = 0;
  let stageTick = null;
  const stageState = {};

  const stageEl = (id) => stageListEl?.querySelector(`.stage-item[data-stage="${id}"]`);
  const stageSetDetail = (id, txt) => {
    const el = stageEl(id); if (!el) return;
    el.querySelector('.detail').textContent = txt || '';
  };
  const stageActivate = (id) => {
    const el = stageEl(id); if (!el) return;
    el.classList.remove('is-done');
    el.classList.add('is-active');
    stageState[id] = 'active';
  };
  const stageComplete = (id, detail) => {
    const el = stageEl(id); if (!el) return;
    el.classList.remove('is-active');
    el.classList.add('is-done');
    if (detail) stageSetDetail(id, detail);
    else {
      const t = ((Date.now() - stageStart) / 1000).toFixed(1) + 's';
      stageSetDetail(id, t);
    }
    stageState[id] = 'done';
  };
  const stageAdvance = (target) => {
    for (const id of STAGE_ORDER) {
      if (id === target) break;
      if (stageState[id] !== 'done') stageComplete(id);
    }
    stageActivate(target);
  };
  const stagesShow = () => {
    stagesEl.classList.add('is-shown');
    stageStart = Date.now();
    stageElapsedEl.textContent = '0.0s';
    if (stageTick) clearInterval(stageTick);
    stageTick = setInterval(() => {
      stageElapsedEl.textContent = ((Date.now() - stageStart) / 1000).toFixed(1) + 's';
    }, 100);
  };
  const stagesFinish = () => {
    for (const id of STAGE_ORDER) if (stageState[id] !== 'done') stageComplete(id);
    if (stageTick) { clearInterval(stageTick); stageTick = null; }
  };
  const stagesReset = () => {
    if (stageTick) { clearInterval(stageTick); stageTick = null; }
    stagesEl.classList.remove('is-shown');
    stageListEl.querySelectorAll('.stage-item').forEach(el => {
      el.classList.remove('is-active', 'is-done');
      el.querySelector('.detail').textContent = '';
    });
    for (const k of Object.keys(stageState)) delete stageState[k];
  };
  const phaseToStage = {
    fetch: 'fetch',
    discover: 'discover',
    crawl: 'crawl',
    score: 'score',
    parallel: 'discover',
    think: 'think',
    strategist: 'think',
  };

  // Tiny streaming-safe markdown → HTML for ##, **, *, -, 1.
  const mdToHtml = (md) => {
    let s = escapeHtml(md);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    const lines = s.split('\n');
    const out = [];
    let inUl = false, inOl = false;
    const closeLists = () => {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    };
    for (const line of lines) {
      if (/^##\s+/.test(line)) {
        closeLists();
        out.push(`<h3>${line.replace(/^##\s+/, '')}</h3>`);
      } else if (/^-\s+/.test(line)) {
        if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
        out.push(`<li>${line.replace(/^-\s+/, '')}</li>`);
      } else if (/^\d+\.\s+/.test(line)) {
        if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
        out.push(`<li>${line.replace(/^\d+\.\s+/, '')}</li>`);
      } else if (line.trim() === '') {
        closeLists();
      } else {
        closeLists();
        out.push(`<p>${line}</p>`);
      }
    }
    closeLists();
    return out.join('');
  };

  /* ─── SEO WALL renderers ─── */
  const scoreClass = (s) => s >= 90 ? '' : s >= 50 ? 'mid' : 'bad';
  const iconPass = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg>`;
  const iconWarn = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="7" x2="12" y2="13"/><circle cx="12" cy="17" r="1.3" fill="currentColor"/></svg>`;
  const iconFail = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`;
  const statusIcon = (s) => s === 'pass' ? iconPass : s === 'warn' ? iconWarn : iconFail;
  const catIcons = {
    foundation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.4 9.2 8 10 4.6-.8 8-5 8-10V6z"/></svg>`,
    crawl:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
    content:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    meta:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>`,
    media:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    architecture:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>`,
    geo:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.5 6h6l-5 4 2 7-5.5-4L6 19l2-7-5-4h6z"/></svg>`,
  };

  const renderRadar = (categories) => {
    const W = 320, H = 320, CX = W/2, CY = H/2, R = 92;
    const n = categories.length;
    const angle = (i) => (-Math.PI/2) + (i * 2 * Math.PI / n);
    const rings = [0.25, 0.5, 0.75, 1].map(f => {
      const pts = Array.from({length: n}, (_, i) => {
        const a = angle(i);
        return `${CX + Math.cos(a) * R * f},${CY + Math.sin(a) * R * f}`;
      }).join(' ');
      return `<polygon points="${pts}" class="radar-grid-poly"/>`;
    }).join('');
    const dataPts = categories.map((c, i) => {
      const a = angle(i);
      const f = Math.max(0.05, c.score / 100);
      return { x: CX + Math.cos(a) * R * f, y: CY + Math.sin(a) * R * f };
    });
    const poly = dataPts.map(p => `${p.x},${p.y}`).join(' ');
    const dots = dataPts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" class="radar-dot"/>`).join('');
    const radarLabel = {
      foundation: 'FOUND', crawl: 'CRAWL', content: 'CONTENT', meta: 'META',
      media: 'MEDIA', architecture: 'LINKS', geo: 'GEO',
    };
    const labels = categories.map((c, i) => {
      const a = angle(i);
      const lr = R + 26;
      const x = CX + Math.cos(a) * lr;
      const y = CY + Math.sin(a) * lr;
      const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      const label = radarLabel[c.id] || c.label.split(/[\s&/]/)[0];
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" class="radar-label">${label}</text>`;
    }).join('');
    resRadar.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="false">
        <g class="radar-grid">${rings}</g>
        <polygon points="${poly}" class="radar-poly"/>
        ${dots}
        ${labels}
      </svg>`;
    resRadar.querySelectorAll('.radar-grid-poly').forEach((p) => {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#E8E5DD');
      p.setAttribute('stroke-width', '0.5');
    });
  };

  const countUp = (el, target, { duration = 1200, suffix = '' } = {}) => {
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const p = Math.min((now - start) / duration, 1);
      el.textContent = Math.round(target * ease(p)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const renderSeoWall = (audit) => {
    const raw = urlInput.value.trim().replace(/^https?:\/\//i, '');
    try { wallDomainEl.textContent = new URL('https://' + raw).hostname; } catch { wallDomainEl.textContent = raw; }
    statScoreEl.textContent = '0%';
    statPassedEl.textContent = '0';
    statIssuesEl.textContent = '0';
    statPagesEl.textContent = '0';
    statScoreBox.className = 'wall-stat is-score ' + scoreClass(audit.overallScore);

    catGridEl.innerHTML = audit.categories.map(cat => {
      const cls = scoreClass(cat.score);
      const items = cat.checks.map(ch => `
        <li class="check-item">
          <span class="icon ${ch.status}" aria-hidden="true">${statusIcon(ch.status)}</span>
          <span class="body">
            <span class="t">${ch.title}</span>
            <span class="v">${ch.value}</span>
          </span>
        </li>
      `).join('');
      return `
        <div class="cat-card" data-cat="${cat.id}">
          <div class="cat-head">
            <div class="cat-title">${catIcons[cat.id] || ''}${cat.label}</div>
            <div class="cat-score ${cls}">${cat.score}%</div>
          </div>
          <div class="cat-bar"><div class="cat-bar-fill ${cls}" style="width:0%"></div></div>
          <ul class="check-list">${items}</ul>
        </div>
      `;
    }).join('');

    resSeoWall.classList.add('is-shown');
    renderRadar(audit.categories);

    countUp(statScoreEl, audit.overallScore, { suffix: '%' });
    countUp(statPassedEl, audit.passed);
    countUp(statIssuesEl, audit.issues);
    countUp(statPagesEl, audit.pagesCrawled);

    const cards = [...catGridEl.querySelectorAll('.cat-card')];
    cards.forEach((card, idx) => {
      setTimeout(() => {
        card.classList.add('is-in');
        card.querySelector('.cat-bar-fill').style.width = card.querySelector('.cat-score').textContent;
        card.querySelectorAll('.check-item').forEach((li, cIdx) => {
          li.style.transitionDelay = (cIdx * 60) + 'ms';
        });
      }, 400 + idx * 140);
    });
  };

  const parseSseBlock = (block) => {
    const ev = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!ev || !data) return null;
    try { return { event: ev, data: JSON.parse(data) }; } catch { return null; }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let raw = urlInput.value.trim().replace(/^https?:\/\//i, '');
    const url = raw ? 'https://' + raw : '';
    const email = emailInput.value.trim();
    const phone = phoneInput.value.trim();
    if (!url || !raw.includes('.')) { setStatus("Enter a valid website URL.", 'error'); urlInput.focus(); return; }
    if (!emailRe.test(email)) { setStatus('Enter a valid work email.', 'error'); emailInput.focus(); return; }
    if (phone.replace(/\D/g, '').length < 6) { setStatus('Enter a valid phone number.', 'error'); phoneInput.focus(); return; }

    btn.disabled = true;
    resultEl.classList.remove('is-shown');
    resStrategist.innerHTML = '';
    resSeoWall.classList.remove('is-shown');
    catGridEl.innerHTML = '';
    resRadar.innerHTML = '';
    if (resSampleAd) resSampleAd.classList.add('is-shown');
    if (resAdImg) { resAdImg.classList.add('is-loading'); resAdImg.innerHTML = ''; }
    if (resPunchline) resPunchline.classList.remove('is-shown');
    stagesReset();
    stagesShow();
    stageActivate('fetch');
    clearStatus();

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, email, phone })
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }

      resultEl.classList.add('is-shown');
      resUrl.textContent = url;
      stagesEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let strategistText = '';
      const MIN_REVEAL_MS = 9000;
      const revealWallWhenReady = async (audit) => {
        const elapsed = Date.now() - stageStart;
        const wait = Math.max(0, MIN_REVEAL_MS - elapsed);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        stageComplete('score');
        stageActivate('think');
        renderSeoWall(audit);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop() || '';

        for (const rawBlock of blocks) {
          const parsed = parseSseBlock(rawBlock);
          if (!parsed) continue;
          const { event, data } = parsed;

          if (event === 'status') {
            const stage = phaseToStage[data.phase];
            if (stage) stageAdvance(stage);
          } else if (event === 'crawl-progress') {
            stageActivate('crawl');
            stageSetDetail('crawl', `${data.done}/${data.total}`);
          } else if (event === 'checks') {
            stageComplete('crawl', `${data.pagesCrawled} pages`);
            stageActivate('score');
            revealWallWhenReady(data);
          } else if (event === 'chunk') {
            strategistText += data.text;
            resStrategist.innerHTML = mdToHtml(strategistText) + '<span class="typing"></span>';
            stageAdvance('think');
          } else if (event === 'image') {
            if (resAdImg) {
              resAdImg.classList.remove('is-loading');
              resAdImg.innerHTML = `<img src="${data.url}" alt="Sample ad creative generated for your brand" loading="lazy" />`;
            }
            if (resSampleAd) resSampleAd.classList.add('is-shown');
          } else if (event === 'done') {
            resStrategist.innerHTML = mdToHtml(strategistText);
            if (resAdImg && resAdImg.classList.contains('is-loading')) {
              if (resSampleAd) resSampleAd.classList.remove('is-shown');
              resAdImg.classList.remove('is-loading');
            }
            if (resPunchline) resPunchline.classList.add('is-shown');
            stagesFinish();
            setTimeout(() => stagesEl.classList.remove('is-shown'), 1600);
            clearStatus();
            document.dispatchEvent(new CustomEvent('audit:done', { detail: { url } }));
          } else if (event === 'error') {
            throw new Error(data.message || 'Audit failed');
          }
        }
      }
    } catch (err) {
      setStatus('Audit failed: ' + (err.message || 'try again'), 'error');
      resStrategist.innerHTML = '';
      stagesReset();
    } finally {
      btn.disabled = false;
    }
  });
})();
