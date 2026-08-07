/**
 * Peptides Costa Rica — live lead capture into Google Sheets
 * ---------------------------------------------------------------------------
 * Receives every form submission from the landing page and appends it as a row,
 * in real time. Runs entirely inside your own Google account: no third-party
 * service sees your leads, and there is nothing to pay for.
 *
 * SETUP (about five minutes)
 *
 *  1. Create a new Google Sheet. Name the first tab exactly: Leads
 *  2. In that Sheet: Extensions -> Apps Script. Delete whatever is in the editor
 *     and paste this whole file in.
 *  3. Edit the CONFIG block below (notification email, optional shared secret).
 *  4. Save, then Deploy -> New deployment.
 *       Type:              Web app
 *       Description:       landing page leads
 *       Execute as:        Me
 *       Who has access:    Anyone            <-- required; "Anyone with Google
 *                                                account" will silently reject
 *                                                visitors who are not signed in
 *  5. Authorise when prompted. Google will warn that the app is unverified —
 *     that is expected for your own script. Advanced -> Go to (project name).
 *  6. Copy the Web app URL. It ends in /exec
 *  7. In index.html set:
 *       crmEndpoint: "https://script.google.com/macros/s/AKfy.../exec",
 *       crmMode: "sheet",
 *
 * IMPORTANT: every time you edit this script you must Deploy -> Manage
 * deployments -> edit -> Version: New version -> Deploy. Saving alone does not
 * update the live URL. The /exec URL itself stays the same.
 *
 * TESTING: open the /exec URL in a browser. A GET returns a small JSON health
 * check, which confirms the deployment is live and publicly reachable.
 */

const CONFIG = {
  SHEET_NAME: 'Leads',

  // Email address to alert on every new lead. Leave '' to switch alerts off.
  NOTIFY_EMAIL: '',

  // Optional shared secret. If you set a non-empty value here you must send the
  // same string from the page, otherwise submissions are rejected. Leave '' to
  // accept any submission (fine for most landing pages; the honeypot on the
  // form already filters routine bots).
  SHARED_SECRET: '',

  // Column order. Add or reorder freely — headers are written to match.
  FIELDS: [
    'submittedAt',
    'firstName',
    'lastName',
    'email',
    'phone',
    'messagingNumber',
    'preferredLanguage',
    'category',
    'location',
    'volume',
    'marketingConsent',
    'pageLanguage',
    'pageUrl',
    'referrer'
  ]
};

const HEADERS = [
  'Received',
  'First name',
  'Last name',
  'Email',
  'Phone',
  'Messaging number',
  'Reply language',
  'Category',
  'Delivery to',
  'Volume',
  'Consent',
  'Page language',
  'Page URL',
  'Referrer'
];

/** Entry point: the landing page POSTs here. */
function doPost(e) {
  // Serialise concurrent submissions so two visitors cannot claim the same row.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: 'busy' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty body' });
    }

    const lead = JSON.parse(e.postData.contents);

    if (CONFIG.SHARED_SECRET && lead.secret !== CONFIG.SHARED_SECRET) {
      return json({ ok: false, error: 'unauthorised' });
    }

    const sheet = getSheet_();

    // Server time is authoritative; the browser clock is not trustworthy.
    const received = new Date();

    const row = CONFIG.FIELDS.map(function (key) {
      if (key === 'submittedAt') return received;
      const v = lead[key];
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return String(v);
    });

    sheet.appendRow(row);

    if (CONFIG.NOTIFY_EMAIL) {
      notify_(lead, received);
    }

    return json({ ok: true, row: sheet.getLastRow() });
  } catch (err) {
    // Never throw: a 500 would make the browser retry and could duplicate rows.
    console.error(err);
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Health check. Open the /exec URL in a browser to confirm the deployment. */
function doGet() {
  const sheet = getSheet_();
  return json({
    ok: true,
    service: 'landing page lead capture',
    sheet: CONFIG.SHEET_NAME,
    rows: Math.max(0, sheet.getLastRow() - 1)
  });
}

/** Returns the target tab, creating it and its header row when missing. */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#06213F')
      .setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  return sheet;
}

/** Emails a readable summary of a new lead. */
function notify_(lead, received) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Someone';
  const lines = [
    name + ' just submitted the form.',
    '',
    'Email:            ' + (lead.email || '—'),
    'Phone:            ' + (lead.phone || '—'),
    'Messaging number: ' + (lead.messagingNumber || 'same as phone'),
    'Reply language:   ' + (lead.preferredLanguage || '—'),
    '',
    'Category:         ' + (lead.category || '—'),
    'Delivery to:      ' + (lead.location || '—'),
    'Volume:           ' + (lead.volume || '—'),
    '',
    'Received:         ' + Utilities.formatDate(received, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    'Page:             ' + (lead.pageUrl || '—'),
    'Referrer:         ' + (lead.referrer || 'direct'),
    '',
    SpreadsheetApp.getActiveSpreadsheet().getUrl()
  ];

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: 'New lead: ' + name + (lead.category ? ' — ' + lead.category : ''),
    body: lines.join('\n')
  });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this once from the Apps Script editor (select testAppend, press Run) to
 * confirm the Sheet is writable before you touch the live page. It appends one
 * clearly-marked row that you can delete afterwards.
 */
function testAppend() {
  const sheet = getSheet_();
  sheet.appendRow(CONFIG.FIELDS.map(function (k) {
    return k === 'submittedAt' ? new Date() : 'TEST — delete me';
  }));
  Logger.log('Wrote a test row to "%s". Total rows: %s', CONFIG.SHEET_NAME, sheet.getLastRow());
}
