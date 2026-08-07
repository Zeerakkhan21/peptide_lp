# Peptides Costa Rica — Landing Page

A single-file, bilingual (English/Spanish) lead-generation landing page. A modal opens five seconds after landing, visitors answer four short questions, leave their contact details, and see a confirmation telling them a specialist will be in touch. There is no messaging-app handoff — the objective is first-party contact data.

Built as one self-contained `index.html`: no build step, no framework, no dependencies. The only external request is the Poppins webfont from Google Fonts.

---

## Quick start

Open `index.html` in a browser. That's it — everything runs locally with no server.

To deploy on GitHub Pages, push this repository, then go to **Settings → Pages** and set the source to your default branch, root folder. The page will be live at `https://<username>.github.io/<repo>/` within a minute or two. Netlify, Vercel and Cloudflare Pages all work the same way: point them at the repository root with no build command.

If you already have hosting, upload `index.html` wherever you want the page to live.

---

## Configuration

Everything you need to change lives in one place. Open `index.html`, search for `var CONFIG`, and you'll find it near the top of the script block at the bottom of the file:

```js
var CONFIG = {
  email: "info@peptidescostarica.net",
  phoneUS: "+18314715559",
  phoneCR: "+50684046973",

  leadApi: {
    endpoint: "/api/lead",       // same-origin proxy path
    source: "adwords_lp",        // overridable per campaign via ?source=
    timeoutMs: 15000,
    retries: 1,
    retryDelayMs: 1200,
    utmDefaults: { utm_source: "", utm_medium: "", utm_campaign: "" }
  },

  ads: { conversionId: "", conversionLabel: "" },
  sheetMirror: { enabled: false, endpoint: null },

  autoOpenEnabled: true,
  timeTriggerMs: 5000,
  scrollTriggerPct: 0.55,
  exitIntentEnabled: true,
  messagingChannel: { enabled: false, /* ... */ }
};
```

## Lead API integration

On submit the page POSTs `application/json` to `CONFIG.leadApi.endpoint` with exactly eight fields:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "88881234",
  "language": "es",
  "source": "adwords_lp",
  "utm_source": "google",
  "utm_medium": "ppc",
  "utm_campaign": "weight-loss-search"
}
```

`name` is the first and last name fields joined (last name is optional, so a blank one produces no trailing space). `language` is the visitor's step-four choice mapped to a code — English to `en`, Spanish to `es` — falling back to the page language if the step was skipped. `source` defaults to `adwords_lp` and can be overridden per campaign with a `?source=` parameter on the landing URL, so a Meta or newsletter campaign can be attributed without a redeploy.

UTM values are read from the URL once at page load, so they survive the visitor opening the modal several minutes later. Missing parameters fall back to `utmDefaults`, empty strings out of the box; change them there if your CRM prefers something like `direct` and `none`.

### Securing the endpoint

**A request made by the browser is always visible in the network tab.** There is no way around that — obfuscating the URL, encoding it, or encrypting the body changes nothing, because the browser still has to make a real request to a real host and DevTools reports what it did. Anyone who wants the endpoint will have it in ten seconds.

What *is* achievable is keeping the upstream API off the client entirely. That is what `/proxy` does. The page posts to `/api/lead` on your own domain; your server receives it and forwards to the Lead API. The browser then sees a request to your own path and nothing else — the upstream host, the API key and the upstream contract never reach it. The page source contains no reference to the Lead API at all; there is an automated check for that in `api-test.js`.

Three interchangeable implementations are provided, all behaving identically. Pick the one that matches your hosting:

| File | Use when |
|---|---|
| `proxy/lead-proxy.php` | The site is on shared hosting, cPanel or WordPress. Most likely fit. |
| `proxy/cloudflare-worker.js` | Static hosting with no PHP. Free tier covers 100k requests a day. |
| `proxy/netlify-vercel-function.js` | Already deploying on Netlify or Vercel. |

Each one revalidates the payload server-side (a client-side check protects nobody), whitelists the eight fields so nothing extra can be injected, restricts CORS to your own origins, rate-limits per IP, attaches the API key from an environment variable, and returns a generic error rather than echoing whatever the upstream said. Setup instructions are in the header comment of each file.

To skip the proxy and post directly to the Lead API, set `endpoint` to the full URL. The integration works either way — but the endpoint becomes public and the API must return CORS headers for your domain or the browser will block the request outright.

### Why the form shows an error before the proxy is deployed

`endpoint` defaults to `/api/lead`, a path on your own domain. Until something answers there, the POST returns 404 and the visitor-facing error appears. That is the error handling working, not a bug — but it does mean **the form cannot succeed until you deploy one of the files in `/proxy`.**

**If the page is on static hosting — GitHub Pages, S3, plain file hosting — a same-origin path can never work there**, because static hosts cannot run server-side code. Use `proxy/cloudflare-worker.js` instead: `wrangler deploy` gives you a working `https://lead-proxy.<subdomain>.workers.dev` URL in about a minute with no domain required, and you set `endpoint` to that full URL. Add the origin your page is served from to `ALLOWED_ORIGINS` in the Worker before deploying, or every request comes back 403 — that is the step people miss.

Opening `index.html` straight from disk is handled separately: on `file://` a same-origin path cannot resolve at all, so the page skips the network call, shows the confirmation panel, and logs the payload to the console under a `LOCAL PREVIEW` warning. That lets you review the flow without a backend. It only ever applies to `file://` — on any real domain, localhost included, the page always makes the real request.

When a hosted request does fail, the console names the likely cause rather than leaving you with a bare status: a 404 points at the missing proxy, a 403 at `ALLOWED_ORIGINS`, a 502 at the upstream URL or API key, a network-level failure at CORS. 

### Testing it

`dev-server.js` serves the page and answers `/api/lead`, so you can click through the real form in your browser and watch the payload arrive in the terminal. Node 18+, no dependencies, nothing to deploy.

```bash
node dev-server.js                 # mock mode, prints every payload
node dev-server.js --fail 500      # exercise the error banner and retry
node dev-server.js --fail 400      # terminal failure, no retry
node dev-server.js --flaky         # first attempt fails, retry succeeds
node dev-server.js --slow 20000    # stall, to trigger the 15s timeout
```

It checks each payload against the API contract and flags anything missing or unexpected. Open the second URL it prints to test UTM capture.

For a genuine end-to-end run before deploying anything, point it upstream and it behaves exactly like the production proxy:

```bash
LEAD_API_URL=https://catalog.peptidescostarica.net/api/leads/contact node dev-server.js
```

That confirms the real API accepts your payload shape, which is the one thing a mock cannot tell you.

### Postman

`postman/lead-api.postman_collection.json` imports eleven ready-made requests. In Postman: **File → Import**, drop the file in, then open the collection's **Variables** tab and set `proxyBase` to your domain. Every request asserts its expected status in the Tests tab, so the Test Results panel tells you pass or fail without reading the body.

Three folders. *Upstream Lead API* hits the client's endpoint directly — including an `OPTIONS` preflight that reveals whether a browser could post there at all, which is the definitive answer to whether the proxy is optional. *Your proxy* covers the happy path plus the cases that matter: extra fields stripped, invalid email, short phone, missing name, `GET` refused, foreign origin refused. *Local dev-server* points at `localhost:3000`.

The proxy expectations were verified against `lead-proxy.php` running locally:

| Request | Expected | Actual |
|---|---|---|
| valid lead | 200 `{"ok":true}` | 502 locally, no upstream reachable from the test box |
| invalid email | 422 `{"error":"email"}` | matched |
| short phone | 422 `{"error":"phone"}` | matched |
| missing name | 422 `{"error":"name"}` | matched |
| `GET` | 405 | matched |
| foreign `Origin` | 403 | matched |
| malformed JSON | 400 | matched |
| preflight, known origin | 204 | matched |

Requests in the *Upstream* folder create real leads in the CRM. Use obvious test data.

### Behaviour on success and failure

Success shows the existing confirmation panel, fires `generate_lead` on `window.dataLayer`, fires the GA4 `generate_lead` event via `gtag`, and fires the Google Ads conversion when `ads.conversionId` and `ads.conversionLabel` are both set. Leave either empty and the Ads event is skipped rather than sent with a malformed `send_to`.

Failure shows a friendly inline message above the submit button, re-enables the button, and leaves every field exactly as typed so pressing submit again is all that is needed. No conversion fires — verified, so your Ads data never counts a lead that did not arrive. The error is logged to the console with the status and the payload keys, never the payload values.

Network errors, timeouts, 5xx and 429 are retried once automatically after a short delay, so a one-off blip resolves without the visitor seeing anything. A 4xx is never retried, because a payload the API rejected will be rejected again. Requests time out after 15 seconds. Repeat submits are ignored while one is in flight, and the button carries `aria-busy` throughout.

`sheetMirror` optionally sends a fuller copy of the lead — including the category, delivery location and volume answers, which the Lead API contract does not carry — to the Google Apps Script from `google-apps-script.gs`. It is fire-and-forget and off by default; enabling it cannot affect what the visitor sees.

---

## How the lead flow works

There are six ways to open the modal by hand: the header button and a floating button (desktop only), plus the hero, the end of the "why buy from us" section, the final call-to-action and a footer button (every breakpoint). On top of those the modal opens itself **once per session**, five seconds after landing. Scroll depth and exit intent remain as backups in case the timer is disabled. It never auto-opens if the visitor has already started answering or has already submitted.

The four questions are category, delivery location, volume and preferred reply language. The questions auto-advance on selection, answers accumulate as chips so progress stays visible, and closing partway through preserves state — reopening resumes from the same question.

Step five collects first name, last name (optional), email, phone, and an optional second messaging number for anyone who would rather be reached elsewhere. Only first name, email, phone and consent are enforced.

On submission the page posts the lead to the API, fires the conversion events, and shows a confirmation panel: a personalised thank-you using their first name, a note that a member of the team will contact them shortly, a summary of their answers, a three-step "what happens next", and a prompt to check their email including the spam folder. Nothing redirects anywhere.

---

## Analytics

The page pushes events to `window.dataLayer`, so Google Tag Manager picks them up with no code changes. If GTM isn't installed the events are logged to the console instead.

Events fired: `enquiry_open` (with the trigger source — `timer-5000ms`, `hero`, `sticky`, `exit-intent` and so on), `enquiry_start`, `enquiry_step`, `enquiry_answer`, `enquiry_validation_error`, `enquiry_close`, `generate_lead`, `cta_click` (with the button location), `faq_open`, and `language_switch`.

Fire your Google Ads conversion tag on `generate_lead`, not on page load. It carries `preferredLanguage`, `category`, `location` and `volume` so you can segment conversions without extra tagging. The number worth watching most closely is the step-by-step drop-off inside the modal, which tells you exactly which question is costing you leads.

---

## Languages

English is written directly into the HTML. Spanish lives in the `ES` object inside the script block, keyed to the `data-i18n` attributes on each element.

To edit English copy, change the text in the markup. To edit Spanish, find the matching key in the `ES` object. Every one of the 154 translatable strings has a Spanish counterpart — if you add a new element with a `data-i18n` attribute, add the matching key to `ES` or that element will stay in English when the page is switched.

The page detects Spanish from the browser and also honours a URL parameter, so you can point Spanish ad groups straight at `index.html?lang=es` while keeping one file to maintain.

---

## Reviews section

The three rating cards show the figures published on your main site (Trustpilot 4.2, Google 5.0, Facebook 5.0), with the Trustpilot card linking to your live profile.

Replace them with the official widgets so the numbers update themselves — look for the comment marked `Live rating widgets` in the markup. Trustpilot's TrustBox, the Google Reviews widget and the Facebook Page plugin all drop straight in, and a self-updating widget is more persuasive than a typed number because visitors can tell it's real.

Directly below that row sits `<template id="tpl-testimonials">`, holding a ready-styled review card. Templates are valid HTML that never renders, so the markup waits there without affecting the page. To publish, move the cards out of the template into the section above and replace each one with a real review — quote text, first name, and which platform it came from. Delete any card you don't fill.

It ships dormant because your site currently has no written testimonials to draw from, and inventing them is both an advertising-misrepresentation problem and the kind of thing a buyer can check in ten seconds.

---

## Editing notes

Colours are CSS custom properties defined in `:root` at the top of the stylesheet. `--b900` through `--b50` are the navy/blue brand scale; `--o700` through `--o400` are the orange action scale that every CTA uses.

The orange stops were picked so white button text clears WCAG AA: the lightest gradient stop `--o500` (#C85207) gives 4.50:1 against white. If you brighten it, re-check that ratio — a punchier orange like #F97316 drops to 2.8:1 and the button text stops being legible for a lot of people. Change the two `--o` values and every button on the page follows. Typography is Poppins throughout at four weights; swapping the font means changing the Google Fonts `<link>` in `<head>` and the `font-family` on `body`.

Section IDs are `#why`, `#trust`, `#faq` and `#enquiry`, and the header navigation anchors to them. The page is deliberately short: hero, figures, four proof cards, ratings, six service facts, seven FAQs, closing call to action.

CTAs are worded per section — "Request Information" in the header and footer, "Get Started Today" in the hero and sticky bar, "Receive Personalized Guidance" after the proof cards, "Request More Information" in the closing panel, and "Get My Personalized Plan" on the submit button. All of them open the same modal.

The reveal-on-scroll animation is gated behind a `js` class applied by an inline script, so with JavaScript disabled the page still renders completely. Don't remove that — a page that looks blank without JavaScript is a real problem for crawlers and ad reviewers.

---

## Compliance

The research-use-only disclosure appears in the "why buy from us" section, the FAQ answer on medical advice, and the footer, where your existing legal notice is reproduced verbatim. The consent checkbox restates it a fourth time.

Keep all four. They are what makes the page defensible if it's ever reviewed, and they cost essentially nothing in conversion.

The consent line covers both a reply to the enquiry *and* occasional product and stock updates by email or WhatsApp, with an unsubscribe promise. That wording is what makes the captured list usable for marketing — consent to "a reply about my enquiry" does not cover a newsletter, and sending one anyway is how domains and WhatsApp numbers get blocked. Honour the unsubscribe.

Delivery is described as "we confirm the options available for your location" rather than naming countries, so the page works for US and Costa Rican traffic without claiming shipping lanes you may not have in place. Tighten that wording once your US fulfilment is settled.

The footer links to Terms of Sale and other policy pages currently point at anchors — repoint them at your real pages before launch.

---

## Browser support

Chrome, Edge, Firefox and Safari, current and previous major versions, on desktop and mobile. Verified at 390px and 1440px with no horizontal overflow. The modal is keyboard operable with focus trapping and Escape to close, tap targets meet the 44px minimum, and contrast passes WCAG AA throughout.

---

## Quality checks

Two Playwright suites. `qa.js` covers 55 assertions: WCAG AA contrast on every rendered text node, one-`h1` and heading order, duplicate IDs, form labelling, dead links, tap-target sizes, the full five-step flow, the validation matrix, CRM payload shape, focus trapping and restoration, EN→ES→EN round-tripping, translation completeness, horizontal overflow at nine widths from 320px to 1920px, reduced-motion, and a no-JavaScript render.

`api-test.js` covers 37 more, all against a mock endpoint: exact payload shape, UTM capture and defaults, the `?source=` override, language mapping, name joining, validation, the duplicate-submit guard, the error path with data retention and retry, 5xx retried versus 4xx not retried, transient-failure recovery, conversion events firing once and only on success, and a check that the upstream URL appears nowhere in the page.

Run `node qa.js && node api-test.js` after any edit. Both exit non-zero on failure, so they drop straight into CI. The page also parses clean under an HTML5 strict parser.

---

## Mobile behaviour

Nothing is pinned to the viewport below 1040px. The bottom bar that used to carry "Get Started Today" and a call button has been removed outright, and the desktop floating button and header CTA are hidden at that breakpoint too, so the mobile page scrolls clean with no overlay competing for the screen.

That leaves four in-page entry points on mobile — hero, after the proof cards, the closing panel, and the footer — plus the modal that opens on its own five seconds in. Worth watching your mobile conversion rate after this change: a persistent CTA usually earns its keep on long pages, and if the number dips the cheapest thing to try is unhiding the header button rather than bringing the bottom bar back. That is one line: delete `.hdr__cta .btn{display:none}` from the `max-width:1040px` media query.

Layout is verified at 320, 375, 390, 414, 430, 740×360 landscape, 768, 1024, 1280, 1440 and 1920 with no horizontal overflow and no component crossing the viewport edge. No text renders below 12px at any width — the uppercase micro-labels (section eyebrows, rating platform names, footer headings, the modal step counter) were sitting between 10.9 and 11.8px and have been raised. The modal fits within the viewport down to 320×640 and scrolls internally on short screens, including phone landscape.
