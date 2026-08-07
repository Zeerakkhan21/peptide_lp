const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = 8123;
let mode = 'ok';           // ok | fail500 | fail400 | hang | flaky
let hits = [];
let flakyCount = 0;

const html = fs.readFileSync('peptides-costa-rica-landing.html','utf8');

const server = http.createServer((req,res)=>{
  if (req.url.startsWith('/api/lead')) {
    let body=''; req.on('data',c=>body+=c);
    req.on('end',()=>{
      hits.push({ ctype:req.headers['content-type'], body });
      if (mode==='hang') return;                                  // never responds
      if (mode==='fail500'){ res.writeHead(500,{'Content-Type':'application/json'}); return res.end('{"ok":false}'); }
      if (mode==='fail400'){ res.writeHead(400,{'Content-Type':'application/json'}); return res.end('{"ok":false}'); }
      if (mode==='flaky'){ flakyCount++; if(flakyCount===1){res.writeHead(503); return res.end('{}');} }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(html);
});

const R=[]; const P=(c,m)=>R.push((c?'  PASS  ':'  FAIL  ')+m)||c;
let failed=0; const chk=(c,m)=>{ if(!c) failed++; R.push((c?'  PASS  ':'  FAIL  ')+m); };

async function fill(p, {first='Jane',last='Doe',email='jane@example.com',phone='88881234',lang='Spanish'}={}) {
  await p.waitForSelector('#ov.open',{timeout:9000});
  await p.click('.opt[data-val="Weight Loss"]');   await p.waitForTimeout(270);
  await p.click('.opt[data-val="Costa Rica"]');    await p.waitForTimeout(270);
  await p.click('.opt[data-val="5–9 vials"]');     await p.waitForTimeout(270);
  await p.click(`.opt[data-val="${lang}"]`);       await p.waitForTimeout(320);
  await p.fill('#fname',first); await p.fill('#lname',last);
  await p.fill('#email',email); await p.fill('#phone',phone);
  await p.check('#consent');
}

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b = await chromium.launch();

  const newPage = async (url) => {
    const p = await b.newPage({viewport:{width:1440,height:950}});
    await p.addInitScript(()=>{ window.__gtag=[]; window.gtag=function(){window.__gtag.push([...arguments]);}; window.dataLayer=[]; });
    await p.goto(url);
    return p;
  };

  // ── 1. payload shape + UTM capture ────────────────────────────────────────
  hits=[]; mode='ok';
  let p = await newPage(`http://127.0.0.1:${PORT}/?utm_source=google&utm_medium=ppc&utm_campaign=weight-loss-search`);
  await fill(p);
  await p.click('#qSubmit'); await p.waitForTimeout(900);
  const sent = JSON.parse(hits[0].body);
  chk(hits[0].ctype && hits[0].ctype.includes('application/json'), 'sent as application/json');
  chk(JSON.stringify(Object.keys(sent).sort())===JSON.stringify(['email','language','name','phone','source','utm_campaign','utm_medium','utm_source']),
      'payload contains exactly the eight documented fields — got: '+Object.keys(sent).join(','));
  chk(sent.name==='Jane Doe', 'first + last joined into name: '+JSON.stringify(sent.name));
  chk(sent.email==='jane@example.com', 'email mapped');
  chk(sent.phone==='88881234', 'phone mapped');
  chk(sent.language==='es', 'Preferred Language "Spanish" -> "es" (got '+JSON.stringify(sent.language)+')');
  chk(sent.source==='adwords_lp', 'source defaults to adwords_lp');
  chk(sent.utm_source==='google'&&sent.utm_medium==='ppc'&&sent.utm_campaign==='weight-loss-search','UTMs captured from the URL');
  chk(await p.locator('.pane[data-step="6"]').isVisible(), 'thank-you shown on success');

  const dl = await p.evaluate(()=>window.dataLayer.filter(e=>e.event==='generate_lead'));
  chk(dl.length===1, 'dataLayer generate_lead fired once');
  chk(dl[0] && dl[0].utm_campaign==='weight-loss-search', 'generate_lead carries campaign attribution');
  const gt = await p.evaluate(()=>window.__gtag);
  chk(gt.some(a=>a[0]==='event'&&a[1]==='generate_lead'), 'GA4 gtag generate_lead fired');
  chk(!gt.some(a=>a[1]==='conversion'), 'Ads conversion skipped while conversionId is unset (no bad send_to)');
  await p.close();

  // ── 2. Ads conversion when configured ─────────────────────────────────────
  hits=[];
  const cfgHtml = html.replace('ads: { conversionId: "", conversionLabel: "" }','ads: { conversionId: "AW-123456789", conversionLabel: "abcDEF" }');
  server.removeAllListeners('request');
  server.on('request',(req,res)=>{
    if(req.url.startsWith('/api/lead')){let bd='';req.on('data',c=>bd+=c);req.on('end',()=>{hits.push({body:bd});res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');});return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(cfgHtml);
  });
  p = await newPage(`http://127.0.0.1:${PORT}/`);
  await fill(p,{lang:'English'});
  await p.click('#qSubmit'); await p.waitForTimeout(900);
  const gt2 = await p.evaluate(()=>window.__gtag);
  const conv = gt2.find(a=>a[1]==='conversion');
  chk(!!conv, 'Google Ads conversion event fires when configured');
  chk(conv && conv[2].send_to==='AW-123456789/abcDEF', 'send_to built correctly: '+(conv?conv[2].send_to:'—'));
  chk(JSON.parse(hits[0].body).language==='en', 'Preferred Language "English" -> "en"');
  chk(JSON.parse(hits[0].body).utm_source==='', 'missing UTMs default to empty string');
  await p.close();

  // restore normal handler
  server.removeAllListeners('request');
  server.on('request',(req,res)=>{
    if(req.url.startsWith('/api/lead')){let bd='';req.on('data',c=>bd+=c);req.on('end',()=>{
      hits.push({body:bd});
      if(mode==='hang')return;
      if(mode==='fail500'){res.writeHead(500);return res.end('{}');}
      if(mode==='fail400'){res.writeHead(400);return res.end('{}');}
      if(mode==='flaky'){flakyCount++;if(flakyCount===1){res.writeHead(503);return res.end('{}');}}
      res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');});return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
  });

  // ── 3. source override ────────────────────────────────────────────────────
  hits=[]; mode='ok';
  p = await newPage(`http://127.0.0.1:${PORT}/?source=meta_lp`);
  await fill(p); await p.click('#qSubmit'); await p.waitForTimeout(900);
  chk(JSON.parse(hits[0].body).source==='meta_lp', 'source overridable per campaign via ?source=');
  await p.close();

  // ── 4. validation ─────────────────────────────────────────────────────────
  hits=[];
  p = await newPage(`http://127.0.0.1:${PORT}/`);
  await fill(p,{email:'nope@',phone:'123'});
  await p.click('#qSubmit'); await p.waitForTimeout(400);
  chk(hits.length===0, 'invalid email + short phone blocked before any request');
  chk(await p.locator('.err.show').count()===2, 'two inline field errors shown');
  await p.fill('#email','jane@example.com'); await p.fill('#phone','1234567890123456');
  await p.click('#qSubmit'); await p.waitForTimeout(400);
  chk(hits.length===0, '16-digit phone rejected (E.164 max is 15)');
  await p.fill('#phone','88881234');
  await p.click('#qSubmit'); await p.waitForTimeout(800);
  chk(hits.length===1, 'submits once corrected');
  await p.close();

  // ── 5. duplicate-submit guard ─────────────────────────────────────────────
  hits=[]; mode='hang';
  p = await newPage(`http://127.0.0.1:${PORT}/`);
  await fill(p);
  await p.click('#qSubmit');
  await p.waitForTimeout(150);
  const disabled = await p.locator('#qSubmit').isDisabled();
  const busy = await p.locator('#qSubmit').getAttribute('aria-busy');
  await p.locator('#qSubmit').dispatchEvent('click');
  await p.evaluate(()=>document.getElementById('qForm').requestSubmit());
  await p.waitForTimeout(600);
  chk(disabled && busy==='true', 'button disabled and aria-busy during flight');
  chk(hits.length===1, 'repeat submits ignored while in flight — requests sent: '+hits.length);
  await p.close();

  // ── 6. error path, data retention, retry ──────────────────────────────────
  hits=[]; mode='fail500';
  p = await newPage(`http://127.0.0.1:${PORT}/`);
  const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text());});
  await fill(p);
  await p.click('#qSubmit');
  await p.waitForTimeout(4000);                       // 1 retry + backoff
  chk(hits.length===2, '5xx retried once, then given up — attempts: '+hits.length);
  chk(await p.locator('#formErr').isVisible(), 'friendly error message shown');
  chk(!(await p.locator('#qSubmit').isDisabled()), 'button re-enabled so the visitor can retry');
  chk(await p.inputValue('#fname')==='Jane' && await p.inputValue('#email')==='jane@example.com'
      && await p.inputValue('#phone')==='88881234', 'entered data retained after failure');
  chk(!(await p.locator('.pane[data-step="6"]').isVisible()), 'thank-you NOT shown on failure');
  const dlFail = await p.evaluate(()=>window.dataLayer.filter(e=>e.event==='generate_lead').length);
  chk(dlFail===0, 'no conversion fired on failure');
  chk(logs.some(l=>l.includes('Lead submission failed')), 'error logged for debugging');
  mode='ok';
  await p.click('#qSubmit'); await p.waitForTimeout(900);
  chk(await p.locator('.pane[data-step="6"]').isVisible(), 'retry after recovery succeeds');
  chk(await p.evaluate(()=>window.dataLayer.filter(e=>e.event==='generate_lead').length)===1,'conversion fires exactly once, on the successful attempt');
  await p.close();

  // ── 7. 4xx is not retried ─────────────────────────────────────────────────
  hits=[]; mode='fail400';
  p = await newPage(`http://127.0.0.1:${PORT}/`);
  await fill(p); await p.click('#qSubmit'); await p.waitForTimeout(3000);
  chk(hits.length===1, '4xx not retried (a rejected payload will not pass on retry) — attempts: '+hits.length);
  chk(await p.locator('#formErr').isVisible(), 'error surfaced on 4xx');
  await p.close();

  // ── 8. transient failure self-heals ───────────────────────────────────────
  hits=[]; flakyCount=0; mode='flaky';
  p = await newPage(`http://127.0.0.1:${PORT}/`);
  await fill(p); await p.click('#qSubmit'); await p.waitForTimeout(3500);
  chk(hits.length===2 && await p.locator('.pane[data-step="6"]').isVisible(),
      'one-off 503 recovered automatically, visitor never sees an error');
  await p.close();

  // ── 9. no upstream URL anywhere in the shipped file ───────────────────────
  chk(!html.includes('catalog.peptidescostarica.net'),
      'upstream Lead API URL does not appear in the page source at all');

  await b.close(); server.close();
  console.log(R.join('\n'));
  console.log(`\n${R.length-failed} passed, ${failed} failed`);
  process.exit(failed?1:0);
})();
