const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

// Serve over HTTP with a stubbed lead endpoint. file:// cannot resolve the
// same-origin /api/lead path the page posts to, so this mirrors production.
const PORT = 8134;
const PAGE = fs.readFileSync(__dirname + '/peptides-costa-rica-landing.html', 'utf8');
const posted = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/lead')) {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { posted.push(JSON.parse(b)); res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
const F = `http://127.0.0.1:${PORT}/`;
const fail = [], warn = [], ok = [];
const P = (c, m) => (c ? ok : fail).push(m);
const W = (c, m) => { if (!c) warn.push(m); };

function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum(rgb){const [r,g,b]=rgb;return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);}
function ratio(a,b){const la=lum(a),lb=lum(b);const hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05);}
const parse = s => (s.match(/\d+/g)||[0,0,0]).slice(0,3).map(Number);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport:{width:1440,height:950} });
  page.on('console', m => { if (m.type()==='error' && !m.text().includes('ERR_TUNNEL')) errs.push('console: '+m.text()); });
  page.on('pageerror', e => errs.push('pageerror: '+e.message));

  // ---------- load ----------
  await page.goto(F);
  await page.waitForSelector('#ov.open', {timeout:9000});   // timed popup
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  P(!(await page.locator('#ov').evaluate(e=>e.classList.contains('open'))), 'timed popup opens ~5s after landing and closes on Escape');

  // ---------- structural integrity ----------
  const dupes = await page.evaluate(() => {
    const seen={}, dup=[];
    document.querySelectorAll('[id]').forEach(e=>{ seen[e.id]=(seen[e.id]||0)+1; });
    for (const k in seen) if (seen[k]>1) dup.push(k+'×'+seen[k]);
    return dup;
  });
  P(dupes.length===0, 'no duplicate element IDs' + (dupes.length?` — ${dupes}`:''));

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('#qForm input:not(.hp)')].map(i => ({
      id:i.id, labelled: !!document.querySelector(`label[for="${i.id}"]`) || !!i.getAttribute('aria-label')
    })).filter(x=>!x.labelled).map(x=>x.id));
  P(labels.length===0, 'every form input has a label' + (labels.length?` — missing: ${labels}`:''));

  const headings = await page.evaluate(()=>[...document.querySelectorAll('h1,h2,h3')].map(h=>+h.tagName[1]));
  const h1s = headings.filter(x=>x===1).length;
  P(h1s===1, `exactly one <h1> (found ${h1s})`);
  let skip=null, prev=headings[0];
  for (const h of headings.slice(1)) { if (h-prev>1) skip = `${prev}→${h}`; prev=h; }
  P(!skip, 'no heading level skipped' + (skip?` — ${skip}`:''));

  const badLinks = await page.evaluate(()=>[...document.querySelectorAll('a[href]')]
    .map(a=>a.getAttribute('href'))
    .filter(h=>h==='#' || h==='' || h.startsWith('javascript:')));
  P(badLinks.length===0, 'no dead or placeholder links' + (badLinks.length?` — ${badLinks}`:''));

  const contacts = await page.evaluate(()=>[...document.querySelectorAll('a[href^="mailto:"],a[href^="tel:"]')].map(a=>a.getAttribute('href')));
  const badContact = contacts.filter(h => h.startsWith('mailto:') ? !/^mailto:[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(h) : !/^tel:\+?[0-9]{7,}$/.test(h));
  P(badContact.length===0, `all ${contacts.length} mailto/tel links well-formed` + (badContact.length?` — ${badContact}`:''));

  const svgTitles = await page.evaluate(()=>[...document.querySelectorAll('svg')]
    .filter(s=>!s.hasAttribute('aria-hidden') && !s.getAttribute('role') && !s.getAttribute('aria-label')).length);
  W(svgTitles===0, `${svgTitles} decorative SVG(s) missing aria-hidden`);

  // ---------- orange rollout ----------
  const btnColors = await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('.btn--primary, .fab__b--q').forEach(el=>{
      const cs=getComputedStyle(el);
      out.push({ cta: el.getAttribute('data-cta')||el.className, bg: cs.backgroundImage||cs.backgroundColor, color: cs.color });
    });
    return out;
  });
  const allOrange = btnColors.every(b => /166,\s*63,\s*6/.test(b.bg) && /200,\s*82,\s*7/.test(b.bg));
  P(allOrange, `all ${btnColors.length} primary CTAs share one orange gradient`);
  const anyBlueCta = await page.evaluate(()=>[...document.querySelectorAll('.btn--primary,.fab__b--q')]
    .filter(e=>/rgb\(17,\s*96,\s*184\)|rgb\(21,\s*115,\s*214\)/.test(getComputedStyle(e).backgroundImage)).length);
  P(anyBlueCta===0, 'no primary CTA left on the old blue');

  // ---------- contrast on real rendered nodes ----------
  const cw = await page.evaluate(()=>{
    const el=document.querySelector('.btn--primary');
    return { color:getComputedStyle(el).color, fs:parseFloat(getComputedStyle(el).fontSize), fw:getComputedStyle(el).fontWeight };
  });
  const lightest = [200,82,7];
  const r = ratio(parse(cw.color), lightest);
  P(r >= 4.5, `CTA text contrast ${r.toFixed(2)}:1 on the lightest gradient stop (AA needs 4.5)`);

  const textContrast = await page.evaluate(()=>{
    const rgba = s => { const m=(s||'').match(/[\d.]+/g)||[]; return {r:+m[0]||0,g:+m[1]||0,b:+m[2]||0,a:m[3]!==undefined?+m[3]:1}; };
    // walk to the first genuinely opaque backdrop; a gradient counts, using its first stop
    const backdrop = el => {
      let n=el;
      while(n && n!==document.documentElement){
        const cs=getComputedStyle(n);
        const bi=cs.backgroundImage;
        if(bi && bi!=='none'){ const m=bi.match(/rgba?\([^)]+\)/); if(m){ const c=rgba(m[0]); if(c.a>=0.9) return [c.r,c.g,c.b]; } }
        const c=rgba(cs.backgroundColor);
        if(c.a>=0.999) return [c.r,c.g,c.b];
        n=n.parentElement;
      }
      return [255,255,255];
    };
    const out=[];
    document.querySelectorAll('p,li,span,h1,h2,h3,h4,label,dt,dd,button,a').forEach(el=>{
      if(!el.textContent.trim() || el.offsetParent===null || el.children.length) return;
      const cs=getComputedStyle(el);
      if(cs.webkitTextFillColor==='rgba(0, 0, 0, 0)') return;   // gradient-clipped text
      const fg=rgba(cs.color), bg=backdrop(el);
      const eff=[Math.round(fg.r*fg.a+bg[0]*(1-fg.a)),Math.round(fg.g*fg.a+bg[1]*(1-fg.a)),Math.round(fg.b*fg.a+bg[2]*(1-fg.a))];
      out.push({t:el.textContent.trim().slice(0,32), c:`rgb(${eff.join(',')})`, b:`rgb(${bg.join(',')})`, fs:parseFloat(cs.fontSize), fw:parseInt(cs.fontWeight)||400});
    });
    return out;
  });
  const lowC = textContrast.map(o=>{
    const rr = ratio(parse(o.c), parse(o.b));
    const large = o.fs>=24 || (o.fs>=18.66 && o.fw>=700);
    return {...o, rr:+rr.toFixed(2), need: large?3:4.5};
  }).filter(o=>o.rr < o.need);
  if (lowC.length) lowC.slice(0,8).forEach(o=>console.log(`      low: "${o.t}" ${o.rr} (${o.c} on ${o.b}, ${o.fs}px/${o.fw})`));
  P(lowC.length===0, `all ${textContrast.length} visible text nodes pass WCAG AA` + (lowC.length?` — ${lowC.length} fail, worst: "${lowC[0].t}" ${lowC[0].rr.toFixed(2)}`:''));

  // ---------- i18n round trip ----------
  const before = await page.evaluate(()=>[...document.querySelectorAll('[data-i18n]')].map(e=>e.innerHTML));
  await page.click('.lang button[data-lang="es"]'); await page.waitForTimeout(400);
  const esChanged = await page.evaluate(b=>[...document.querySelectorAll('[data-i18n]')].filter((e,i)=>e.innerHTML===b[i]).length, before);
  await page.click('.lang button[data-lang="en"]'); await page.waitForTimeout(400);
  const after = await page.evaluate(()=>[...document.querySelectorAll('[data-i18n]')].map(e=>e.innerHTML));
  const drift = before.map((v,i)=>v===after[i]?null:i).filter(x=>x!==null);
  P(drift.length===0, `EN→ES→EN round trip restores every string` + (drift.length?` — ${drift.length} drifted`:''));
  W(esChanged<=3, `${esChanged} strings identical in both languages (brand names are expected)`);

  const missing = await page.evaluate(()=>{
    const src=[...document.querySelectorAll('script:not([src])')].map(s=>s.textContent).find(s=>s.includes('var ES = {'))||'';
    const body=src.slice(src.indexOf('var ES = {'), src.indexOf('var UI ='));
    const have=new Set([...body.matchAll(/"([a-zA-Z0-9._]+)"\s*:/g)].map(m=>m[1]));
    const need=[...new Set([...document.querySelectorAll('[data-i18n]')].map(e=>e.getAttribute('data-i18n'))
      .concat([...document.querySelectorAll('[data-i18n-ph]')].map(e=>e.getAttribute('data-i18n-ph'))))];
    const unused=[...have].filter(k=>!need.includes(k));
    return {missing:need.filter(k=>!have.has(k)), unused, total:need.length};
  });
  P(missing.missing.length===0, `all ${missing.total} strings translated` + (missing.missing.length?` — missing ${missing.missing}`:''));
  P(missing.unused.length===0, 'no orphaned translation keys' + (missing.unused.length?` — ${missing.unused}`:''));

  // ---------- auto-open fires exactly once ----------
  const p2 = await b.newPage({viewport:{width:1440,height:950}});
  const opens = [];
  p2.on('console', m => { if (m.text().includes('enquiry_open')) opens.push(m.text()); });
  await p2.goto(F);
  await p2.waitForSelector('#ov.open', {timeout:9000});
  await p2.keyboard.press('Escape'); await p2.waitForTimeout(300);
  await p2.evaluate(()=>window.scrollTo(0,document.body.scrollHeight*0.8)); await p2.waitForTimeout(900);
  await p2.mouse.move(700,300); await p2.mouse.move(700,2); await p2.waitForTimeout(500);
  P(!(await p2.locator('#ov').evaluate(e=>e.classList.contains('open'))), 'auto-open fires once per session, never nags');
  await p2.close();

  // ---------- validation matrix ----------
  await page.click('button[data-cta="hero"]'); await page.waitForTimeout(350);
  await page.click('.opt[data-val="Healing & Recovery"]'); await page.waitForTimeout(280);
  await page.click('.opt[data-val="Costa Rica"]'); await page.waitForTimeout(280);
  await page.click('.opt[data-val="1–4 vials"]'); await page.waitForTimeout(280);
  await page.click('.opt[data-val="English"]'); await page.waitForTimeout(320);

  const cases = [
    { n:'all blank',        f:{}, expect:4 },
    { n:'bad email',        f:{fname:'Ana', email:'ana@', phone:'+50688881234'}, consent:true, expect:1 },
    { n:'1-char name',      f:{fname:'A', email:'ana@x.com', phone:'+50688881234'}, consent:true, expect:1 },
    { n:'short phone',      f:{fname:'Ana', email:'ana@x.com', phone:'123'}, consent:true, expect:1 },
    { n:'consent unticked', f:{fname:'Ana', email:'ana@x.com', phone:'+50688881234'}, consent:false, expect:1 },
  ];
  for (const c of cases) {
    await page.evaluate(()=>{ ['fname','lname','email','phone','altphone'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('consent').checked=false; });
    for (const [k,v] of Object.entries(c.f)) await page.fill('#'+k, v);
    if (c.consent) await page.check('#consent');
    await page.click('#qSubmit'); await page.waitForTimeout(220);
    const n = await page.locator('.err.show').count();
    P(n===c.expect, `validation "${c.n}" → ${n} error(s), expected ${c.expect}`);
  }

  // optional fields truly optional
  await page.evaluate(()=>{ ['fname','lname','email','phone','altphone'].forEach(id=>document.getElementById(id).value=''); });
  await page.fill('#fname','Ana'); await page.fill('#email','ana@correo.com'); await page.fill('#phone','+506 8888 1234');
  await page.check('#consent');
  posted.length = 0;
  await page.click('#qSubmit'); await page.waitForTimeout(1100);
  const sent = posted[0];
  P(!!sent, 'lead reaches the API endpoint');
  P(sent && JSON.stringify(Object.keys(sent).sort()) ===
      JSON.stringify(['email','language','name','phone','source','utm_campaign','utm_medium','utm_source']),
    'API payload is exactly the eight contracted fields');
  P(sent && sent.name === 'Ana', 'name sent (last name blank, so no trailing space)');
  P(sent && sent.email === 'ana@correo.com' && sent.phone === '+506 8888 1234', 'email and phone mapped');
  P(sent && sent.language === 'en' && sent.source === 'adwords_lp', 'language code and source mapped');
  P(await page.locator('.pane[data-step="6"]').isVisible(), 'submits with last name and messaging number left blank');
  P(await page.locator('#doneH').innerText().then(t=>t.includes('Ana')), 'thank-you greets the visitor by first name');
  const pages0 = b.contexts()[0].pages().length;
  await page.waitForTimeout(4200);
  P(b.contexts()[0].pages().length===pages0, 'no tab or redirect after submission');

  // ---------- keyboard ----------
  await page.click('#doneClose'); await page.waitForTimeout(300);
  P(!(await page.locator('#ov').evaluate(e=>e.classList.contains('open'))), 'thank-you close button dismisses the modal');
  P(!(await page.locator('body').evaluate(e=>e.classList.contains('is-locked'))), 'body scroll unlocks on close');

  const p3 = await b.newPage({viewport:{width:1440,height:950}});
  await p3.goto(F); await p3.waitForSelector('#ov.open',{timeout:9000});
  await p3.keyboard.press('Escape'); await p3.waitForTimeout(400);
  await p3.click('button[data-cta="header"]'); await p3.waitForTimeout(400);
  const inside = [];
  for (let i=0;i<26;i++){ await p3.keyboard.press('Tab');
    inside.push(await p3.evaluate(()=>document.getElementById('mod').contains(document.activeElement))); }
  P(inside.every(Boolean), 'focus stays trapped inside the modal across 26 tabs');
  await p3.keyboard.press('Escape'); await p3.waitForTimeout(300);
  P(await p3.evaluate(()=>document.activeElement===document.querySelector('[data-cta="header"]')), 'focus returns to the trigger on close');
  await p3.close();

  // ---------- responsive ----------
  for (const w of [320,375,390,414,768,1024,1280,1440,1920]) {
    const v = await b.newPage({viewport:{width:w,height:900}});
    await v.goto(F); await v.waitForTimeout(700);
    await v.keyboard.press('Escape');
    const over = await v.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    P(over<=0, `${w}px — no horizontal overflow (${over}px)`);
    const clipped = await v.evaluate(()=>[...document.querySelectorAll('.btn,.card,.fact,.rating,.pill')]
      .filter(e=>e.offsetParent!==null && e.getBoundingClientRect().right > document.documentElement.clientWidth+1).length);
    P(clipped===0, `${w}px — no component overflows the viewport`);
    if ([375,768,1440].includes(w)) { await v.waitForTimeout(5200); await v.keyboard.press('Escape'); await v.waitForTimeout(400); await v.screenshot({path:`qa-${w}.png`}); }
    await v.close();
  }

  // ---------- tap targets ----------
  const m = await b.newPage({viewport:{width:390,height:844}});
  await m.goto(F); await m.waitForSelector('#ov.open',{timeout:9000});
  await m.keyboard.press('Escape'); await m.waitForTimeout(400);
  const targets = await m.evaluate(()=>[...document.querySelectorAll('a,button')]
    .filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;})
    .map(e=>{const r=e.getBoundingClientRect();return{t:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,26),cta:e.classList.contains('btn')||e.classList.contains('fab__b'),h:Math.round(r.height),w:Math.round(r.width)};})
    .filter(o=>o.h>0));
  const under24 = targets.filter(o=>o.h<24||o.w<24);
  P(under24.length===0, `all ${targets.length} mobile targets meet WCAG 2.5.8 AA (24×24)` + (under24.length?` — ${JSON.stringify(under24.slice(0,4))}`:''));
  const ctaSmall = targets.filter(o=>o.cta && (o.h<44||o.w<44));
  P(ctaSmall.length===0, 'every CTA button is ≥44×44' + (ctaSmall.length?` — ${JSON.stringify(ctaSmall.slice(0,4))}`:''));
  await m.close();

  // ---------- reduced motion ----------
  const rm = await b.newPage({viewport:{width:1440,height:950}});
  await rm.emulateMedia({reducedMotion:'reduce'});
  await rm.goto(F); await rm.waitForTimeout(900); await rm.keyboard.press('Escape');
  const hidden = await rm.evaluate(()=>[...document.querySelectorAll('.rv')].filter(e=>getComputedStyle(e).opacity==='0').length);
  P(hidden===0, 'prefers-reduced-motion: all content visible, no animation');
  await rm.close();

  // ---------- no-JS ----------
  const nj = await b.newPage({javaScriptEnabled:false});
  await nj.goto(F); await nj.waitForTimeout(500);
  const njText = (await nj.locator('body').innerText()).length;
  P(njText > 3000, `renders fully with JavaScript disabled (${njText} chars visible)`);
  await nj.close();

  P(errs.length===0, 'zero console or runtime errors' + (errs.length?` — ${errs.join(' | ')}`:''));

  console.log('\n══ PASS ══');  ok.forEach(m=>console.log('  ✓ '+m));
  if (warn.length){ console.log('\n══ NOTE ══'); warn.forEach(m=>console.log('  • '+m)); }
  if (fail.length){ console.log('\n══ FAIL ══'); fail.forEach(m=>console.log('  ✗ '+m)); }
  console.log(`\n${ok.length} passed, ${fail.length} failed, ${warn.length} notes`);
  await b.close();
  server.close();
  process.exit(fail.length?1:0);
})();
