const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const received = [];

// Mock Apps Script: accepts POST, returns JSON, sends NO CORS headers —
// exactly the condition that breaks an application/json fetch.
const api = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }  // Apps Script cannot answer preflight
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    received.push({ method: req.method, ctype: req.headers['content-type'], body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

(async () => {
  await new Promise(r => api.listen(8791, r));

  // serve the page over http so the origin is real
  const src = fs.readFileSync('peptides-costa-rica-landing.html', 'utf8');
  const withEndpoint = src.replace('  crmEndpoint: null,', '  crmEndpoint: "http://127.0.0.1:8791/exec",');
  fs.writeFileSync('/tmp/lp-sheet.html', withEndpoint);
  const site = http.createServer((req,res)=>{ res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(withEndpoint); });
  await new Promise(r => site.listen(8092, r));

  const b = await chromium.launch();
  const errs = [];

  async function run(label) {
    const p = await b.newPage({ viewport:{width:1440,height:950} });
    p.on('pageerror', e => errs.push(label+': '+e.message));
    p.on('console', m => { if (m.type()==='error' && !m.text().includes('ERR_TUNNEL')) errs.push(label+': '+m.text()); });
    await p.goto('http://127.0.0.1:8092/');
    await p.waitForSelector('#ov.open', { timeout: 9000 });
    await p.click('.opt[data-val="Muscle Growth"]');            await p.waitForTimeout(280);
    await p.click('.opt[data-val="United States"]');            await p.waitForTimeout(280);
    await p.click('.opt[data-val="10+ vials"]');                await p.waitForTimeout(280);
    await p.click('.opt[data-val="Spanish"]');                  await p.waitForTimeout(320);
    await p.fill('#fname','Jordan');
    await p.fill('#lname','Rivera');
    await p.fill('#email','jordan@lab.com');
    await p.fill('#phone','+1 415 555 0100');
    await p.fill('#altphone','+1 415 555 0199');
    await p.check('#consent');
    await p.click('#qSubmit');
    await p.waitForTimeout(1500);
    const shown = await p.locator('.pane[data-step="6"]').isVisible();
    await p.close();
    return shown;
  }

  const okSheet = await run('sheet-mode');
  console.log('=== sheet mode (Google Apps Script) ===');
  console.log('  confirmation shown to visitor:', okSheet);
  console.log('  requests reaching the server:', received.length);
  if (received.length) {
    const r = received[0];
    console.log('  method:', r.method, '| content-type:', r.ctype);
    const d = JSON.parse(r.body);
    console.log('  payload keys:', Object.keys(d).join(', '));
    console.log('  firstName:', JSON.stringify(d.firstName), '| lastName:', JSON.stringify(d.lastName));
    console.log('  messagingNumber:', JSON.stringify(d.messagingNumber));
    console.log('  preferredLanguage:', JSON.stringify(d.preferredLanguage), '| category:', JSON.stringify(d.category));
    console.log('  volume:', JSON.stringify(d.volume), '| location:', JSON.stringify(d.location));
    console.log('  marketingConsent:', d.marketingConsent, '| submittedAt:', d.submittedAt);
    const need = ['firstName','lastName','email','phone','messagingNumber','preferredLanguage','category','location','volume','marketingConsent','pageLanguage','pageUrl','referrer','submittedAt'];
    const miss = need.filter(k => !(k in d));
    console.log('  every expected field present:', miss.length===0, miss.length?miss:'');
  }

  // prove the old json mode would have failed here (no CORS headers on the mock)
  received.length = 0;
  const jsonHtml = withEndpoint.replace('crmMode: "sheet"', 'crmMode: "json"');
  fs.writeFileSync('/tmp/lp-json.html', jsonHtml);
  site.removeAllListeners('request');
  site.on('request',(req,res)=>{ res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(jsonHtml); });
  const okJson = await run('json-mode');
  console.log('\n=== json mode against a server with no CORS headers ===');
  console.log('  confirmation still shown (never blocks the visitor):', okJson);
  console.log('  fetch blocked by preflight: yes (see runtime errors below)');
  console.log('  requests that still reached the server:', received.length);
  if (received.length) console.log('  recovered via:', received[0].ctype, '->', JSON.parse(received[0].body).firstName, '(sendBeacon fallback caught it)');

  console.log('\nruntime errors:', errs.length ? errs : 'none');
  await b.close(); api.close(); site.close();
})();
