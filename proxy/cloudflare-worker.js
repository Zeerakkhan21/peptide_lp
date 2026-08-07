/**
 * Lead API proxy — Cloudflare Worker
 * ---------------------------------------------------------------------------
 * Same job as lead-proxy.php: the browser talks only to your own domain, and
 * this Worker forwards the lead to the Lead API. The upstream URL and the API
 * key stay server-side, so DevTools shows a request to /api/lead and nothing
 * more.
 *
 * Use this whenever the page is on hosting that cannot run server-side code:
 * GitHub Pages, S3, Netlify/Vercel static, or plain file hosting. On those, a
 * same-origin path like /api/lead can never be served, so the PHP proxy is not
 * an option. Free tier covers 100k requests a day.
 *
 * DEPLOY — no domain required
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler deploy
 *      Cloudflare gives you a working https URL immediately, something like
 *      https://lead-proxy.<your-subdomain>.workers.dev
 *   3. wrangler secret put LEAD_API_KEY       (skip if the API needs no key)
 *   4. Add the domain your page is served from to ALLOWED_ORIGINS below, then
 *      redeploy. This is the step people miss — a missing origin returns 403.
 *   5. In index.html set the full Worker URL:
 *        endpoint: "https://lead-proxy.<your-subdomain>.workers.dev"
 *
 * DEPLOY — on your own domain (nicer, optional)
 *   Keep the [[routes]] entry in wrangler.toml so the Worker answers at
 *   yourdomain.com/api/lead, and leave endpoint as the relative "/api/lead".
 *   Same-origin means no CORS involved at all.
 *
 * Rate limiting uses a KV namespace when one is bound, and degrades to
 * no limiting when it is not, so the Worker still runs without KV.
 */

const UPSTREAM_URL = "https://catalog.peptidescostarica.net/api/leads/contact";
const UPSTREAM_TIMEOUT_MS = 12000;
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_S = 600;
// Every origin the landing page is served from. A request from anywhere else
// gets a 403. Add your GitHub Pages / staging / local URLs here as needed —
// an origin missing from this list is the most common cause of a 403.
const ALLOWED_ORIGINS = [
  "https://peptidescostarica.net",
  "https://www.peptidescostarica.net",
  "https://zeerakkhan21.github.io",   // GitHub Pages
  "http://localhost:3000",            // dev-server.js
  "http://127.0.0.1:3000",
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      // The page posts application/json cross-origin, which always preflights.
      // Answering with the CORS headers is what makes the real POST possible.
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method not allowed" }, 405, cors);
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: "forbidden" }, 403, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await rateLimited(env, ip)) {
      return json({ ok: false, error: "too many requests" }, 429, cors);
    }

    // ---- parse ----
    let input;
    try {
      const raw = await request.text();
      if (raw.length > 8192) throw new Error("payload too large");
      input = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "invalid json" }, 400, cors);
    }

    // ---- validate ----
    const name = String(input.name ?? "").trim();
    const email = String(input.email ?? "").trim();
    const phone = String(input.phone ?? "").trim();
    const digits = phone.replace(/\D/g, "");

    if (name.length < 2 || name.length > 120) return json({ ok: false, error: "name" }, 422, cors);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || email.length > 254)
      return json({ ok: false, error: "email" }, 422, cors);
    if (digits.length < 7 || digits.length > 15) return json({ ok: false, error: "phone" }, 422, cors);

    // ---- whitelist: anything not listed here is dropped ----
    const clean = (v, fallback = "") =>
      String(v ?? "").replace(/[^\w \-./:]/g, "").slice(0, 120) || fallback;

    const payload = {
      name,
      email,
      phone,
      language: ["en", "es"].includes(input.language) ? input.language : "en",
      source: clean(input.source, "adwords_lp"),
      utm_source: clean(input.utm_source),
      utm_medium: clean(input.utm_medium),
      utm_campaign: clean(input.utm_campaign),
    };

    // ---- forward ----
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (env.LEAD_API_KEY) headers.Authorization = `Bearer ${env.LEAD_API_KEY}`;

    let upstream;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      console.error("upstream unreachable:", err.message);
      return json({ ok: false, error: "upstream unavailable" }, 502, cors);
    }

    if (!upstream.ok) {
      // Log the detail, return something generic: the upstream contract stays private.
      const detail = (await upstream.text().catch(() => "")).slice(0, 300);
      console.error(`upstream ${upstream.status}:`, detail);
      return json({ ok: false, error: "upstream rejected" }, upstream.status >= 500 ? 502 : 400, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};

function corsHeaders(origin) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
    h["Access-Control-Allow-Headers"] = "Content-Type, Accept";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function rateLimited(env, ip) {
  if (!env.RATE_LIMIT) return false;            // no KV bound: skip, do not fail
  const key = `lead:${ip}`;
  const count = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
  if (count >= RATE_LIMIT_MAX) return true;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });
  return false;
}
