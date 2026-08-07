/**
 * Lead API proxy — Vercel Serverless Function
 * ---------------------------------------------------------------------------
 * Vercel maps any file in /api to a route automatically, so this file is served
 * at /api/lead with no configuration. The landing page posts here; this function
 * forwards to the Lead API server-side, which keeps the upstream URL and the API
 * key out of the browser entirely.
 *
 * DEPLOY
 *   1. Commit this file at api/lead.js in the repository root.
 *   2. Push. Vercel redeploys and /api/lead starts answering.
 *   3. Optional, only if the Lead API needs a credential:
 *      Vercel dashboard → Project → Settings → Environment Variables →
 *      add LEAD_API_KEY, then redeploy.
 *
 * VERIFY
 *   curl -X POST https://<your-deployment>.vercel.app/api/lead \
 *     -H 'Content-Type: application/json' \
 *     -d '{"name":"Test","email":"t@example.com","phone":"88881234",
 *          "language":"en","source":"adwords_lp","utm_source":"",
 *          "utm_medium":"","utm_campaign":""}'
 *   A GET to the same URL returns a health check.
 *
 * CommonJS on purpose: Vercel's Node runtime treats .js as CommonJS unless the
 * project declares "type": "module". This works with no package.json at all.
 */

const UPSTREAM_URL = 'https://catalog.peptidescostarica.net/api/leads/contact';
const UPSTREAM_TIMEOUT_MS = 12000;

// Extra origins beyond the deployment's own. Same-origin is always allowed, so
// every Vercel preview URL works without being listed here. Add a custom domain
// once you point one at this project.
const ALLOWED_ORIGINS = [
  'https://peptidescostarica.net',
  'https://www.peptidescostarica.net',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  // The page and this function are served from the same deployment, so the
  // browser's Origin will match the host. Comparing them means preview URLs,
  // production URLs and future custom domains all work untouched.
  const selfOrigin = req.headers.host ? `https://${req.headers.host}` : '';
  const allowed = !origin || origin === selfOrigin || ALLOWED_ORIGINS.includes(origin);

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(allowed ? 204 : 403).end();

  // Health check: open the URL in a browser to confirm the function deployed.
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'lead proxy', method: 'POST expected' });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
  if (!allowed) return res.status(403).json({ ok: false, error: 'forbidden' });

  // Vercel parses application/json into req.body; fall back for anything else.
  let input = req.body;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = null; }
  }
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ ok: false, error: 'invalid json' });
  }

  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim();
  const phone = String(input.phone ?? '').trim();
  const digits = phone.replace(/\D/g, '');

  if (name.length < 2 || name.length > 120) return res.status(422).json({ ok: false, error: 'name' });
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || email.length > 254) {
    return res.status(422).json({ ok: false, error: 'email' });
  }
  if (digits.length < 7 || digits.length > 15) return res.status(422).json({ ok: false, error: 'phone' });

  // Whitelist: anything the client sends beyond these eight fields is dropped.
  const clean = (v, fallback = '') =>
    String(v ?? '').replace(/[^\w \-./:]/g, '').slice(0, 120) || fallback;

  const payload = {
    name,
    email,
    phone,
    language: ['en', 'es'].includes(input.language) ? input.language : 'en',
    source: clean(input.source, 'adwords_lp'),
    utm_source: clean(input.utm_source),
    utm_medium: clean(input.utm_medium),
    utm_campaign: clean(input.utm_campaign),
  };

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.LEAD_API_KEY) headers.Authorization = `Bearer ${process.env.LEAD_API_KEY}`;

  let upstream;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[lead] upstream unreachable:', err.message);
    return res.status(502).json({ ok: false, error: 'upstream unavailable' });
  }

  const detail = await upstream.text().catch(() => '');

  if (!upstream.ok) {
    // Logged for you in Vercel; the client only ever sees a generic message,
    // so the upstream contract stays private.
    console.error(`[lead] upstream ${upstream.status}:`, detail.slice(0, 300));
    return res
      .status(upstream.status >= 500 ? 502 : 400)
      .json({ ok: false, error: 'upstream rejected' });
  }

  console.log('[lead] accepted:', payload.email, '|', payload.source, '|', payload.utm_campaign || 'no campaign');
  return res.status(200).json({ ok: true });
};
