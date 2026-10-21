'use strict';
// Holo Room V18 — fixed-route relay. API keys are forwarded in memory only.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hostedPage = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const HOST_ORIGIN = 'https://holo-room-piapi-relay.onrender.com';

const ROUTES = [
  { match: /^\/relay\/piapi\/upload$/, method: 'POST', target: () => 'https://upload.theapi.app/api/ephemeral_resource', kind: 'piapi' },
  { match: /^\/relay\/piapi\/task$/, method: 'POST', target: () => 'https://api.piapi.ai/api/v1/task', kind: 'piapi' },
  { match: /^\/relay\/piapi\/task\/([a-zA-Z0-9-]{12,120})$/, method: 'GET', target: m => 'https://api.piapi.ai/api/v1/task/' + encodeURIComponent(m[1]), kind: 'piapi' },
  { match: /^\/relay\/openai\/responses$/, method: 'POST', target: () => 'https://api.openai.com/v1/responses', kind: 'openai' }
];
const MAX_BYTES = 13 * 1024 * 1024;
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, authorization, x-holo-relay-token',
  'access-control-max-age': '600'
};
function reply(res, status, data) {
  res.writeHead(status, headers);
  if (status === 204) return res.end();
  res.end(JSON.stringify(data));
}
function equal(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function readBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      const e = new Error('Request exceeds 13 MB');
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function handle(req, res) {
  const pathname = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    res.writeHead(200, {
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-cache',
      'x-content-type-options':'nosniff',
      'referrer-policy':'same-origin',
      'permissions-policy':'camera=(self), microphone=(self)'
    });
    return res.end(hostedPage);
  }
  if (req.method === 'GET' && pathname === '/health') {
    return reply(res, 200, { ok: true, service: 'holo-room-relay', version: '18' });
  }
  const relaySecret = process.env.HOLO_RELAY_TOKEN || '';
  if (relaySecret.length < 20) return reply(res, 503, { error: 'Relay is not configured' });
  // Hosted Holo Room uses same-origin browser requests: no relay token in the page.
  // Local/downloaded copies must continue providing the private token.
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const hostedBrowser = site === 'same-origin'
    && (!origin || origin === HOST_ORIGIN)
    && (!referer || referer === HOST_ORIGIN || referer.startsWith(HOST_ORIGIN + '/'));
  if (!hostedBrowser && !equal(req.headers['x-holo-relay-token'], relaySecret)) {
    return reply(res, 401, { error: 'Relay access denied' });
  }
  const route = ROUTES.map(r => ({...r, matchResult: pathname.match(r.match)})).find(r => r.matchResult);
  if (!route || req.method !== route.method) return reply(res, 404, { error: 'Unsupported route' });
  const key = route.kind === 'piapi' ? req.headers['x-api-key'] : req.headers.authorization;
  if (typeof key !== 'string' || !key.trim()) return reply(res, 400, { error: 'Provider key is missing' });
  if (route.kind === 'openai' && !/^Bearer\s+\S+$/i.test(key)) {
    return reply(res, 400, { error: 'Invalid OpenAI authorization' });
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    if (body?.length) {
      try { JSON.parse(body.toString('utf8')); }
      catch { return reply(res, 400, { error: 'Invalid JSON body' }); }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let upstream;
    try {
      upstream = await fetch(route.target(route.matchResult), {
        method: req.method, body,
        headers: {
          'content-type': 'application/json',
          ...(route.kind === 'piapi' ? {'x-api-key': key} : {authorization: key})
        },
        signal: controller.signal,
        redirect: 'error'
      });
    } finally { clearTimeout(timer); }
    const text = await upstream.text();
    res.writeHead(upstream.status, headers);
    res.end(text);
  } catch(e) {
    reply(res, e.status || 502, {error: e.name === 'AbortError' ? 'Provider timeout' : 'Provider request failed'});
  }
}
function createServer() {
  return http.createServer((req, res) => handle(req, res).catch(() => reply(res, 500, { error: 'Unexpected server error' })));
}
if (require.main === module) {
  createServer().listen(Number(process.env.PORT) || 10000, '0.0.0.0', () => console.log('Holo Room relay running'));
}
module.exports = { createServer };
