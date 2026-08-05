# Peptides Costa Rica — Landing Page

A single-file, bilingual (English/Spanish) lead-generation landing page. Visitors answer four short questions in a modal dialog, leave their contact details, and are handed off to WhatsApp with their answers pre-filled.

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
  whatsapp: "50684046973",                  // digits only, including country code
  email: "info@peptidescostarica.net",
  crmEndpoint: null,                        // POST target for captured leads
  redirectDelayMs: 3500,                    // pause before WhatsApp opens
  scrollTriggerPct: 0.55,                   // auto-open the modal at this scroll depth
  autoOpenEnabled: true                     // set false to disable both auto-popups
};
```

**`crmEndpoint` is the one thing you must set before going live.** While it is `null`, submitted leads are written to the browser console instead of being sent anywhere — useful for testing, useless in production. Set it to a webhook URL (Zapier, Make, GoHighLevel, HubSpot, or your own endpoint) and the page will `POST` this JSON on every submission:

```json
{
  "name": "...",
  "email": "...",
  "phone": "...",
  "category": "Weight Loss",
  "lookingFor": "Shortlist of options",
  "volume": "5–9 vials",
  "preferredChannel": "WhatsApp",
  "consent": true,
  "language": "en",
  "pageUrl": "...",
  "referrer": "..."
}
```

Consider adding server-side capture as a backup, so a failed browser request never silently loses a lead.

---

## How the lead flow works

There are seven ways to open the enquiry modal: the header button, the hero, the end of the "we do things differently" section, the end of the categories section, the final call-to-action, a sticky bar on mobile, and a floating button on desktop. On top of those the modal opens itself once per session — at 55% scroll depth, or on exit intent, whichever happens first. It never auto-opens if the visitor has already started answering, and `autoOpenEnabled: false` turns that behaviour off entirely.

Inside the modal, the four questions auto-advance on selection, answers accumulate as chips so progress stays visible, and closing partway through preserves state — reopening resumes from the same question.

On submission the page posts the lead to your CRM, fires a `generate_lead` analytics event, shows a summary, and then opens WhatsApp with a pre-filled message containing the visitor's name, category, what they're looking for and their volume. The lead is captured *before* the redirect, so someone who abandons at the WhatsApp step is still a lead you can follow up by email. Visitors who chose email or phone are not redirected at all.

---

## Analytics

The page pushes events to `window.dataLayer`, so Google Tag Manager picks them up with no code changes. If GTM isn't installed the events are logged to the console instead.

Events fired: `enquiry_open` (with the trigger source), `enquiry_start`, `enquiry_step`, `enquiry_answer`, `enquiry_validation_error`, `enquiry_close`, `generate_lead`, `cta_click` (with the button location), `faq_open`, and `language_switch`.

Fire your Google Ads conversion tag on `generate_lead`, not on page load. The two numbers worth watching are the step-by-step drop-off inside the modal, which tells you exactly which question is costing you leads, and the split between modal leads and direct WhatsApp clicks, segmented by language.

---

## Languages

English is written directly into the HTML. Spanish lives in the `ES` object inside the script block, keyed to the `data-i18n` attributes on each element.

To edit English copy, change the text in the markup. To edit Spanish, find the matching key in the `ES` object. Every one of the 189 translatable strings has a Spanish counterpart — if you add a new element with a `data-i18n` attribute, add the matching key to `ES` or that element will stay in English when the page is switched.

The page detects Spanish from the browser and also honours a URL parameter, so you can point Spanish ad groups straight at `index.html?lang=es` while keeping one file to maintain.

---

## Reviews section

The three rating cards currently show the figures published on your main site (Trustpilot 4.2, Google 5.0, Facebook 5.0), with the Trustpilot card linking to your live profile.

Replace them with the official widgets so the numbers update themselves — look for the comment marked `Live rating widgets` in the markup. Trustpilot's TrustBox, the Google Reviews widget and the Facebook Page plugin all drop straight in. Self-updating widgets are also more persuasive than typed numbers, because visitors can tell they're real.

If you collect written customer quotes, they belong directly beneath that row.

---

## Editing notes

Colours are CSS custom properties defined in `:root` at the top of the stylesheet — change `--b900` through `--b50` to reshade the whole page. Typography is Poppins throughout at four weights; swapping the font means changing the Google Fonts `<link>` in `<head>` and the `font-family` on `body`.

Section IDs are `#difference`, `#categories`, `#quality`, `#trust`, `#faq` and `#enquiry`, and the header navigation anchors to them.

The reveal-on-scroll animation is gated behind a `js` class applied by an inline script, so with JavaScript disabled the page still renders completely. Don't remove that — a page that looks blank without JavaScript is a real problem for crawlers and ad reviewers.

---

## Compliance

The research-use-only disclosure appears in three places: the categories section, the quality section, and the footer, where your existing legal notice is reproduced verbatim. The FAQ answer on medical advice restates it again. The consent checkbox on the form incorporates acceptance of the Terms of Sale including research-use-only supply.

Keep all four. They are what makes the page defensible if it's ever reviewed, and they cost essentially nothing in conversion.

The footer links to Terms of Sale and other policy pages currently point at anchors — repoint them at your real pages before launch.

---

## Browser support

Chrome, Edge, Firefox and Safari, current and previous major versions, on desktop and mobile. Verified at 390px and 1440px with no horizontal overflow. The modal is keyboard operable with focus trapping and Escape to close, tap targets meet the 44px minimum, and contrast passes WCAG AA throughout.
