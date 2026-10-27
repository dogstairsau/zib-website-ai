(() => {
'use strict';
const $ = id => document.getElementById(id);
const form = $('campaign-audit-form');
if (!form) return;
const status = $('campaign-audit-status'), results = $('campaign-audit-results'), button = $('campaign-audit-submit');
const text = (id, value) => { $(id).textContent = String(value ?? ''); };
const track = event => { window.dataLayer = window.dataLayer || []; window.dataLayer.push({event, tool:'Website Upgrade Audit'}); };
let completedAudit = null;
let lastInsertedSummary = '';
const prefill = () => {
  for (const [from,to] of [['campaign-audit-url','website'],['campaign-audit-email','email'],['campaign-audit-phone','phone']]) {
    const target = $(to); if (target && !target.value.trim()) target.value = $(from).value.trim();
  }
};
$('campaign-audit-apply').addEventListener('click', prefill);

function normaliseSite(value) {
  try { const u = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value); return u.hostname.toLowerCase().replace(/^www\./,''); } catch { return ''; }
}
$('ca-add-findings').addEventListener('click', () => {
  if (!completedAudit) return;
  prefill();
  const notice = $('ca-handover-status'), message = $('message');
  if (normaliseSite($('website').value) !== normaliseSite(completedAudit.url)) {
    notice.textContent = 'Your application lists a different website. Match the website address before adding these findings.'; return;
  }
  const lines = ['Website audit: ' + completedAudit.url];
  if (completedAudit.checks) {
    const c=completedAudit.checks;
    lines.push('Overall score: '+c.overallScore+'%. Pages reviewed: '+c.pagesCrawled+'. Issues flagged: '+c.issues+'.');
    const issues=c.categories.flatMap(cat => (cat.checks||[]).filter(ch=>ch.status==='fail'||ch.status==='warn').map(ch=>String(cat.label)+': '+String(ch.title)));
    if (issues.length) lines.push('Items to discuss:\n'+issues.slice(0,5).map(x=>'- '+x.slice(0,120)).join('\n'));
  }
  if (completedAudit.headline) lines.push('AI-suggested headline: '+completedAudit.headline.slice(0,180));
  lines.push('Automated audit findings are a starting point for discussion.');
  const summary=lines.join('\n');
  let existing=message.value;
  if(lastInsertedSummary && existing.includes(lastInsertedSummary)) existing=existing.replace(lastInsertedSummary,'').trim();
  const combined=[existing.trim(),summary].filter(Boolean).join('\n\n');
  if(combined.length>2000){notice.textContent='There is not enough space in your application notes. Please shorten them before adding the audit summary.';return;}
  message.value=combined;lastInsertedSummary=summary;
  notice.textContent='Audit findings added. Review or edit them in your application notes below.';
  track('website_upgrade_audit_summary_added');
});

const stages = ['Reading your website','Discovering pages','Crawling your website','Checking your pages','Writing your recommendations'];
const phaseIndex = {fetch:0,discover:1,crawl:2,score:3,think:4,rewrite:4};
function stage(index) {
  document.querySelectorAll('#campaign-audit-progress li').forEach((el,i) => {
    el.classList.toggle('active',i===index); el.classList.toggle('complete',i<index);
  });
}
function checks(data) {
  if (!Array.isArray(data.categories) || !Number.isFinite(data.overallScore)) return false;
  text('ca-score',Math.round(data.overallScore) + '%');
  text('ca-passed',data.passed); text('ca-issues',data.issues); text('ca-pages',data.pagesCrawled);
  const grid = $('ca-categories'); grid.replaceChildren();
  for (const cat of data.categories) {
    const card = document.createElement('details'); card.className = 'ca-category';
    const summary = document.createElement('summary');
    const label = document.createElement('b'); label.textContent = cat.label;
    const value = document.createElement('span'); value.textContent = Math.round(Number(cat.score)||0) + '%';
    summary.append(label,value); card.append(summary);
    const bar = document.createElement('div'); bar.className='ca-bar';
    const fill=document.createElement('i'); fill.style.width=Math.max(0,Math.min(100,Number(cat.score)||0))+'%';
    bar.append(fill);card.append(bar);
    const list=document.createElement('ul');
    for(const check of cat.checks || []) {
      const li=document.createElement('li');
      const title=document.createElement('strong'); title.textContent=String(check.status||'').toUpperCase()+' / '+String(check.title||'');
      const detail=document.createElement('span');detail.textContent=String(check.value||'');
      li.append(title,detail);list.append(li);
    }
    card.append(list);grid.append(card);
  }
  $('ca-technical').hidden=false;
  return true;
}
form.addEventListener('submit',async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  let url;
  try {
    const raw=$('campaign-audit-url').value.trim();
    url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);
    if (!['https:','http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw Error();
  } catch { status.textContent='Enter a valid public website address.'; $('campaign-audit-url').focus(); return; }
  if ($('campaign-audit-fax').value) {status.textContent='Unable to run this audit. Please try again.';return;}
  const email=$('campaign-audit-email').value.trim(), phone=$('campaign-audit-phone').value.trim();
  if(phone.replace(/\D/g,'').length<6) {status.textContent='Enter a valid phone number.';return;}
  if (form.dataset.live !== 'true') { status.textContent='Your details pass the form checks. Live audits are awaiting approval; nothing has been sent.'; return; }
  completedAudit=null;
  text('ca-handover-status','Your findings can be added to the editable notes in your application.');
  button.disabled=true;button.textContent='Auditing your website…';
  results.hidden=false;results.setAttribute('aria-busy','true');
  $('campaign-audit-progress').hidden=false;
  for(const id of ['ca-technical','ca-insights','ca-hero','ca-next','ca-advisory']) $(id).hidden=true;
  text('ca-insights-body',''); text('ca-domain',url.hostname);
  stage(0);status.textContent='Reading your website. Results will appear here as they are ready.';
  track('website_upgrade_audit_started');
  let done=false, hasChecks=false, commentary='', auditChecks=null, suggestedHeadline='';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),120000);
  const onEvent=(name,data)=>{
    if(name==='status') {if (data.phase in phaseIndex) stage(phaseIndex[data.phase]);}
    if(name==='crawl-progress') status.textContent='Crawling pages: '+data.done+' / '+data.total;
    if(name==='checks') { hasChecks=checks(data); if(hasChecks) auditChecks=data; }
    if(name==='chunk') {commentary+=String(data.text||'');text('ca-insights-body',commentary);$('ca-insights').hidden=false;}
    if(name==='advisory') {text('ca-advisory',data.message);$('ca-advisory').hidden=false;}
    if(name==='hero' && data.current && data.rewrite) {
      suggestedHeadline=String(data.rewrite.headline||'');
      for(const [prefix,obj] of [['ca-now',data.current],['ca-new',data.rewrite]]) {
        text(prefix+'-h',obj.headline);text(prefix+'-s',obj.subhead);text(prefix+'-c',obj.cta);
      }
      text('ca-rationale',data.rationale);$('ca-hero').hidden=false;
    }
    if(name==='error') throw new Error(String(data.message||'Audit failed.'));
    if(name==='done') done=true;
  };
  try {
    const response=await fetch('/api/audit',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({url:url.href,email,phone,mode:'seo',sourceTag:'Free Website Upgrade / Embedded Audit',clickIds:window.zibClickIds?.()||{}})
    });
    if(!response.ok || !response.body) {
      const error=await response.json().catch(()=>({}));
      throw new Error(response.status===429?'You have reached the audit limit. Please try again later or apply for your upgrade below.':error.error||'The audit service is unavailable. Please try again.');
    }
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    const consume=block=>{
      const lines=block.split('\n'), name=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();
      const payload=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
      if(name && payload) onEvent(name,JSON.parse(payload));
    };
    while(true) {
      const part=await reader.read();
      buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
      buffer=buffer.replace(/\r\n/g,'\n');
      let end;while((end=buffer.indexOf('\n\n'))!==-1){consume(buffer.slice(0,end));buffer=buffer.slice(end+2);}
      if(part.done){if(buffer.trim())consume(buffer);break;}
    }
    if(!done) throw new Error('The connection ended before your audit finished. Please try again.');
    stage(stages.length);
    status.textContent=hasChecks?'Your audit is ready. Explore your results below.':'Your review is ready, but technical scores could not be completed for this site.';
    completedAudit={url:url.href,checks:auditChecks,headline:suggestedHeadline};
    $('ca-next').hidden=false;prefill();track('website_upgrade_audit_completed');
  } catch(error) {
    status.textContent=error.name==='AbortError'?'This audit took too long. Please try again, or apply for your upgrade below.':'Audit could not finish: '+error.message;
    $('campaign-audit-progress').hidden=true;track('website_upgrade_audit_failed');
  } finally {
    clearTimeout(timer);button.disabled=false;button.textContent='Run my free website audit ↗';
    results.setAttribute('aria-busy','false');
  }
});
})();