#!/usr/bin/env node
/**
 * Local test harness for the lead form.
 * ---------------------------------------------------------------------------
 * Serves index.html and answers /api/lead, so you can click through the real
 * form in your own browser and watch exactly what gets sent. No dependencies,
 * no build, no deployment. Node 18 or newer.
 *
 *   node dev-server.js                 mock mode — prints every payload
 *   node dev-server.js --fail 500      always fail, to exercise the error path
 *   node dev-server.js --fail 400      fail without retrying (4xx is terminal)
 *   node dev-server.js --flaky         first attempt fails, retry succeeds
 *   node dev-server.js --slow 20000    stall, to exercise the 15s timeout
 *   node dev-server.js --port 4000     use a different port
 *
 * Real end-to-end, before deploying anything:
 *   LEAD_API_URL=https://catalog.peptidescostarica.net/api/leads/contact \
 *   LEAD_API_KEY=optional-key node dev-server.js
 * The server then behaves exactly like the production proxy and forwards the
 * lead upstream, so you can confirm the real API accepts your payload.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const PORT = Number(flag('port', 3000));
const FAIL = flag('fail');
const FLAKY = !!flag('flaky');
const SLOW = Number(flag('slow', 0));
const UPSTREAM = process.env.LEAD_API_URL || null;
const API_KEY = process.env.LEAD_API_KEY || '';

const PAGE_PATH = path.join(__dirname, 'index.html');
if (!fs.existsSync(PAGE_PATH)) {
  console.error('Cannot find index.html next to this script.');
  process.exit(1);
}

let count = 0;
let flakyHits = 0;

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  amber: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

const EXPECTED = ['name', 'email', 'phone', 'language', 'source', 'utm_source', 'utm_medium', 'utm_campaign'];

function report(payload) {
  count++;
  console.log('\n' + c.bold(`── lead #${count} ─────────────────────────────`) + '  ' + c.dim(new Date().toLocaleTimeString()));
  for (const k of EXPECTED) {
    const v = payload[k];
    const shown = v === '' ? c.dim('(empty)') : v;
    console.log('  ' + k.padEnd(14) + shown);
  }
  const extra = Object.keys(payload).filter(k => !EXPECTED.includes(k));
  const missing = EXPECTED.filter(k => !(k in payload));
  if (extra.length) console.log(c.amber('  unexpected fields: ' + extra.join(', ')));
  if (missing.length) console.log(c.red('  MISSING fields: ' + missing.join(', ')));
  if (!extra.length && !missing.length) console.log(c.green('  ✓ payload matches the API contract exactly'));
}

async function forward(payload, res) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const up = await fetch(UPSTREAM, {
      method: 'POST', headers, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    const body = await up.text().catch(() => '');
    if (up.ok) {
      console.log(c.green(`  → upstream accepted (HTTP ${up.status})`), c.dim(body.slice(0, 200)));
      return send(res, 200, { ok: true });
    }
    console.log(c.red(`  → upstream rejected (HTTP ${up.status})`), c.dim(body.slice(0, 300)));
    return send(res, up.status >= 500 ? 502 : 400, { ok: false, error: 'upstream rejected' });
  } catch (err) {
    console.log(c.red('  → upstream unreachable:'), err.message);
    return send(res, 502, { ok: false, error: 'upstream unavailable' });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/lead') {
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });

    let raw = '';
    req.on('data', ch => (raw += ch));
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(raw); }
      catch { console.log(c.red('  invalid JSON received')); return send(res, 400, { ok: false, error: 'invalid json' }); }

      report(payload);

      if (SLOW) { console.log(c.amber(`  stalling ${SLOW}ms to exercise the client timeout…`)); return setTimeout(() => send(res, 200, { ok: true }), SLOW); }
      if (FLAKY) { flakyHits++; if (flakyHits % 2 === 1) { console.log(c.amber('  returning 503 — the client should retry automatically')); return send(res, 503, { ok: false }); } }
      if (FAIL)  { console.log(c.amber(`  returning ${FAIL} on purpose`)); return send(res, Number(FAIL), { ok: false }); }
      if (UPSTREAM) return forward(payload, res);

      return send(res, 200, { ok: true });
    });
    return;
  }

  // everything else serves the page
  fs.readFile(PAGE_PATH, (err, buf) => {
    if (err) { res.writeHead(500); return res.end('cannot read index.html'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(c.bold('\nLead form test harness'));
  console.log('  page          ' + c.green(base + '/'));
  console.log('  with UTMs     ' + c.green(base + '/?utm_source=google&utm_medium=ppc&utm_campaign=weight-loss-search'));
  console.log('  endpoint      /api/lead');
  console.log('  mode          ' + (
    UPSTREAM ? c.amber('FORWARDING to ' + UPSTREAM + (API_KEY ? ' (with API key)' : '')) :
    SLOW     ? c.amber(`stalling ${SLOW}ms`) :
    FLAKY    ? c.amber('flaky — every other attempt fails') :
    FAIL     ? c.amber('always failing with ' + FAIL) :
               'mock — accepts everything'));
  console.log(c.dim('\n  Submit the form in your browser; payloads appear here. Ctrl-C to stop.\n'));
});
