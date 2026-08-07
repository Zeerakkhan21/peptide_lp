<?php
/**
 * Lead API proxy — PHP
 * ---------------------------------------------------------------------------
 * The landing page POSTs here, on your own domain. This file forwards the lead
 * to the Lead API server-side. The browser therefore never sees the upstream
 * URL, never sees the API key, and DevTools shows only a request to your own
 * /api/lead path.
 *
 * DEPLOY (shared hosting, cPanel, WordPress — anywhere PHP runs)
 *
 *   1. Upload this file so it answers at:  https://yourdomain.com/api/lead
 *      Easiest: put it at  /api/lead/index.php  in your web root.
 *   2. Set LEAD_API_KEY below, or better, as a real environment variable.
 *   3. Confirm index.html has:  endpoint: "/api/lead"
 *   4. Test:  curl -X POST https://yourdomain.com/api/lead \
 *               -H 'Content-Type: application/json' \
 *               -d '{"name":"Test","email":"t@example.com","phone":"88881234",
 *                    "language":"en","source":"adwords_lp","utm_source":"",
 *                    "utm_medium":"","utm_campaign":""}'
 *
 * Requires PHP 7.4+ with cURL.
 */

declare(strict_types=1);

// ── configuration ──────────────────────────────────────────────────────────
const UPSTREAM_URL   = 'https://catalog.peptidescostarica.net/api/leads/contact';
const UPSTREAM_TIMEOUT = 12;          // seconds
const RATE_LIMIT_MAX   = 8;           // submissions per IP…
const RATE_LIMIT_WINDOW = 600;        // …per this many seconds
const ALLOWED_ORIGINS = [             // add every domain the page is served from
    'https://peptidescostarica.net',
    'https://www.peptidescostarica.net',
];

// Prefer a real environment variable; the literal is a fallback for hosts
// that make env vars awkward. Never commit a real key to a public repo.
$API_KEY = getenv('LEAD_API_KEY') ?: '';

// ── helpers ────────────────────────────────────────────────────────────────
function respond(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body);
    exit;
}

function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) {
            return trim(explode(',', $_SERVER[$k])[0]);
        }
    }
    return 'unknown';
}

/** Crude but effective file-based rate limit. Swap for Redis if you have it. */
function rate_limited(string $ip): bool {
    $file = sys_get_temp_dir() . '/leadrl_' . md5($ip);
    $now  = time();
    $hits = [];
    if (is_readable($file)) {
        $hits = array_filter(
            json_decode((string)file_get_contents($file), true) ?: [],
            fn($t) => $t > $now - RATE_LIMIT_WINDOW
        );
    }
    if (count($hits) >= RATE_LIMIT_MAX) {
        return true;
    }
    $hits[] = $now;
    @file_put_contents($file, json_encode(array_values($hits)), LOCK_EX);
    return false;
}

function log_error(string $msg): void {
    error_log('[lead-proxy] ' . $msg);
}

// ── CORS: same-origin only ─────────────────────────────────────────────────
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    if (!in_array($origin, ALLOWED_ORIGINS, true)) {
        respond(403, ['ok' => false, 'error' => 'forbidden']);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type, Accept');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Max-Age: 86400');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'method not allowed']);
}

// ── read and validate ──────────────────────────────────────────────────────
$ip = client_ip();
if (rate_limited($ip)) {
    log_error("rate limited $ip");
    respond(429, ['ok' => false, 'error' => 'too many requests']);
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 8192) {
    respond(400, ['ok' => false, 'error' => 'bad request']);
}

$in = json_decode($raw, true);
if (!is_array($in)) {
    respond(400, ['ok' => false, 'error' => 'invalid json']);
}

$name  = trim((string)($in['name']  ?? ''));
$email = trim((string)($in['email'] ?? ''));
$phone = trim((string)($in['phone'] ?? ''));
$digits = preg_replace('/\D/', '', $phone);

if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
    respond(422, ['ok' => false, 'error' => 'name']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254) {
    respond(422, ['ok' => false, 'error' => 'email']);
}
if (strlen($digits) < 7 || strlen($digits) > 15) {
    respond(422, ['ok' => false, 'error' => 'phone']);
}

// Whitelist the fields we forward; anything else the client sends is dropped.
$language = in_array($in['language'] ?? '', ['en', 'es'], true) ? $in['language'] : 'en';
$clean = static fn($v) => mb_substr(preg_replace('/[^\w \-\.\/:]/u', '', (string)$v), 0, 120);

$payload = [
    'name'         => $name,
    'email'        => $email,
    'phone'        => $phone,
    'language'     => $language,
    'source'       => $clean($in['source']       ?? 'adwords_lp') ?: 'adwords_lp',
    'utm_source'   => $clean($in['utm_source']   ?? ''),
    'utm_medium'   => $clean($in['utm_medium']   ?? ''),
    'utm_campaign' => $clean($in['utm_campaign'] ?? ''),
];

// ── forward ────────────────────────────────────────────────────────────────
$headers = ['Content-Type: application/json', 'Accept: application/json'];
if ($API_KEY !== '') {
    $headers[] = 'Authorization: Bearer ' . $API_KEY;
}

$ch = curl_init(UPSTREAM_URL);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

$body   = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$cerr   = curl_error($ch);
curl_close($ch);

if ($body === false) {
    log_error("upstream unreachable: $cerr");
    respond(502, ['ok' => false, 'error' => 'upstream unavailable']);
}

if ($status < 200 || $status >= 300) {
    // Log the detail; return something generic so the upstream contract stays private.
    log_error("upstream $status: " . substr((string)$body, 0, 300));
    respond($status >= 500 ? 502 : 400, ['ok' => false, 'error' => 'upstream rejected']);
}

respond(200, ['ok' => true]);
