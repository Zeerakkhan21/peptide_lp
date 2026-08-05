# Peptides Costa Rica — Landing Page

A single-file, bilingual (English/Spanish) lead-generation landing page. A modal opens five seconds after landing, visitors answer four short questions, leave their contact details, and are handed off to WhatsApp with their answers pre-filled.

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
  whatsapp: "50684046973",     // digits only, including country code
  email: "info@peptidescostarica.net",
  crmEndpoint: null,           // POST target for captured leads
  redirectDelayMs: 3500,       // pause before WhatsApp opens
  autoOpenEnabled: true,       // master switch for every automatic popup
  timeTriggerMs: 5000,         // open the modal this long after landing
  scrollTriggerPct: 0.55,      // backup: open at this scroll depth
  exitIntentEnabled: true      // backup: open when the cursor leaves the window
};
```

`timeTriggerMs` controls the timed popup. Five seconds is deliberately early and will lift raw lead volume; if bounce rate climbs, try 12000–15000 so visitors reach the proof section first, and compare. Set `autoOpenEnabled: false` to turn every automatic popup off while keeping the seven manual buttons.

**`crmEndpoint` is the one thing you must set before going live.** While it is `null`, submitted leads are written to the browser console instead of being sent anywhere — useful for testing, useless in production. Set it to a webhook URL (Zapier, Make, GoHighLevel, HubSpot, or your own endpoint) and the page will `POST` this JSON on every submission:

```json
{
  "name": "...",
  "email": "...",
  "phone": "...",
  "category": "Weight Loss",
  "location": "United States",
  "volume": "5–9 vials",
  "preferredChannel": "WhatsApp",
  "marketingConsent": true,
  "language": "en",
  "pageUrl": "...",
  "referrer": "..."
}
```

Consider adding server-side capture as a backup, so a failed browser request never silently loses a lead.

---

## How the lead flow works

There are six ways to open the enquiry modal by hand: the header button, the hero, the end of the "why buy from us" section, the final call-to-action, a sticky bar on mobile, and a floating button on desktop. On top of those the modal opens itself **once per session**, five seconds after landing. Scroll depth and exit intent remain as backups in case the timer is disabled. It never auto-opens if the visitor has already started answering or has already submitted.

The four questions are category, delivery location, volume and preferred channel. Location is there so your team knows immediately whether a lead is US or not, and it flows through to the CRM payload, the WhatsApp handoff and the `generate_lead` event.

Inside the modal, the four questions auto-advance on selection, answers accumulate as chips so progress stays visible, and closing partway through preserves state — reopening resumes from the same question.

On submission the page posts the lead to your CRM, fires a `generate_lead` analytics event, shows a summary, and then opens WhatsApp with a pre-filled message containing the visitor's name, category, what they're looking for and their volume. The lead is captured *before* the redirect, so someone who abandons at the WhatsApp step is still a lead you can follow up by email. Visitors who chose email or phone are not redirected at all.

---

## Analytics

The page pushes events to `window.dataLayer`, so Google Tag Manager picks them up with no code changes. If GTM isn't installed the events are logged to the console instead.

Events fired: `enquiry_open` (with the trigger source — `timer-5000ms`, `hero`, `sticky`, `exit-intent` and so on), `enquiry_start`, `enquiry_step`, `enquiry_answer`, `enquiry_validation_error`, `enquiry_close`, `generate_lead`, `cta_click` (with the button location), `faq_open`, and `language_switch`.

Fire your Google Ads conversion tag on `generate_lead`, not on page load. The two numbers worth watching are the step-by-step drop-off inside the modal, which tells you exactly which question is costing you leads, and the split between modal leads and direct WhatsApp clicks, segmented by language.

---

## Languages

English is written directly into the HTML. Spanish lives in the `ES` object inside the script block, keyed to the `data-i18n` attributes on each element.

To edit English copy, change the text in the markup. To edit Spanish, find the matching key in the `ES` object. Every one of the 147 translatable strings has a Spanish counterpart — if you add a new element with a `data-i18n` attribute, add the matching key to `ES` or that element will stay in English when the page is switched.

The page detects Spanish from the browser and also honours a URL parameter, so you can point Spanish ad groups straight at `index.html?lang=es` while keeping one file to maintain.

---

## Reviews section

The three rating cards show the figures published on your main site (Trustpilot 4.2, Google 5.0, Facebook 5.0), with the Trustpilot card linking to your live profile.

Replace them with the official widgets so the numbers update themselves — look for the comment marked `Live rating widgets` in the markup. Trustpilot's TrustBox, the Google Reviews widget and the Facebook Page plugin all drop straight in, and a self-updating widget is more persuasive than a typed number because visitors can tell it's real.

Directly below that row there is a commented-out block marked `WRITTEN TESTIMONIALS`. It holds a ready-styled three-card grid. Uncomment it and paste in real reviews — quote text, first name, and which platform it came from. Delete any card you don't fill. It ships commented out because your site currently has no written testimonials to draw from, and inventing them is both an advertising-misrepresentation problem and the kind of thing a buyer can check in ten seconds.

---

## Editing notes

Colours are CSS custom properties defined in `:root` at the top of the stylesheet — change `--b900` through `--b50` to reshade the whole page. Typography is Poppins throughout at four weights; swapping the font means changing the Google Fonts `<link>` in `<head>` and the `font-family` on `body`.

Section IDs are `#why`, `#trust`, `#faq` and `#enquiry`, and the header navigation anchors to them. The page is deliberately short: hero, figures, four proof cards, ratings, six service facts, seven FAQs, closing call to action.

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
