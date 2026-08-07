/**
 * Lead API proxy — Netlify Function / Vercel Serverless Function
 * ---------------------------------------------------------------------------
 * Third option alongside lead-proxy.php and cloudflare-worker.js. Pick whichever
 * matches your hosting; the behaviour is identical.
 *
 * NETLIFY   save as  netlify/functions/lead.js
 *           add to netlify.toml:
 *             [[redirects]]
 *             from = "/api/lead"
 *             to   = "/.netlify/functions/lead"
 *             status = 200
 *
 * VERCEL    save as  api/lead.js  (it is then already served at /api/lead)
 *
 * Set LEAD_API_KEY in the host's environment variables, not in this file.
 */

const UPSTREAM_URL = "https://catalog.peptidescostarica.net/api/leads/contact";
const ALLOWED_ORIGINS = [
  "https://peptidescostarica.net",
  "https://www.peptidescostarica.net",
];

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method not allowed" });
  if (origin && !ALLOWED_ORIGINS.includes(origin))
    return res.status(403).json({ ok: false, error: "forbidden" });

  const input = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!input) return res.status(400).json({ ok: false, error: "invalid json" });

  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const digits = phone.replace(/\D/g, "");

  if (name.length < 2 || name.length > 120) return res.status(422).json({ ok: false, error: "name" });
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || email.length > 254)
    return res.status(422).json({ ok: false, error: "email" });
  if (digits.length < 7 || digits.length > 15) return res.status(422).json({ ok: false, error: "phone" });

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

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.LEAD_API_KEY) headers.Authorization = `Bearer ${process.env.LEAD_API_KEY}`;

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 300);
      console.error(`upstream ${upstream.status}:`, detail);
      return res.status(upstream.status >= 500 ? 502 : 400).json({ ok: false, error: "upstream rejected" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("upstream unreachable:", err.message);
    return res.status(502).json({ ok: false, error: "upstream unavailable" });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
