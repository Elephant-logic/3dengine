'use strict';
// Holo Room V18 — fixed-route relay. API keys are forwarded in memory only.
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const hostedPage = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const HOST_ORIGIN = process.env.HOLO_HOST_ORIGIN || 'https://holo-room-piapi-relay.onrender.com';


const GLB_MAX = 60 * 1024 * 1024;
function safeModelURL(value) {
  if (typeof value !== 'string') throw new Error('No model URL supplied by PiAPI');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || net.isIP(u.hostname) ||
      !u.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test)$/.test(u.hostname)) {
    throw new Error('Invalid model host');
  }
  return u;
}
async function fetchModelURL(initialUrl, signal) {
  let current = safeModelURL(initialUrl);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(current.href, { signal, redirect: 'manual', headers: {accept:'model/gltf-binary,application/octet-stream,*/*'} });
    if ([301,302,303,307,308].includes(response.status)) {
      const next = response.headers.get('location');
      if (!next) throw new Error('Model host redirected without location');
      current = safeModelURL(new URL(next,current).href);
      continue;
    }
    if (!response.ok) throw new Error('GLB download returned HTTP '+response.status);
    const length = Number(response.headers.get('content-length')||0);
    if (length > GLB_MAX) throw new Error('Model exceeds 60 MB limit');
    if (!response.body) throw new Error('Empty model response');
    let received = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > GLB_MAX) throw new Error('Model exceeds 60 MB limit');
      chunks.push(chunk);
    }
    const model = Buffer.concat(chunks);
    if (model.length < 20 || model.toString('ascii',0,4) !== 'glTF' || model.readUInt32LE(4) !== 2) {
      throw new Error('Downloaded content is not a valid GLB v2 model');
    }
    return model;
  }
  throw new Error('Too many GLB redirects');
}
async function serveModel(res, key, body) {
  let task;
  try { task = JSON.parse(body?.toString('utf8')||'{}').task_id; }
  catch { return reply(res,400,{error:'Invalid model request'}); }
  if (typeof task !== 'string' || !/^[a-zA-Z0-9-]{12,120}$/.test(task)) return reply(res,400,{error:'Valid PiAPI task ID required'});
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),90000);
  try {
    const status=await fetch('https://api.piapi.ai/api/v1/task/'+encodeURIComponent(task), {
      headers: {'x-api-key':key,'accept':'application/json'},signal:ac.signal,redirect:'error'
    });
    if (!status.ok) return reply(res,status.status,{error:'PiAPI task lookup failed: HTTP '+status.status});
    const raw=await status.json();
    const data=raw.data||raw;
    if (!['completed','success'].includes(String(data.status||'').toLowerCase())) {
      return reply(res,409,{error:'Task is not yet completed',status:data.status||'unknown'});
    }
    const url=data.output?.model_file||data.output?.model_url||data.output?.glb;
    if (!url) return reply(res,404,{error:'PiAPI task contains no model_file URL'});
    const model=await fetchModelURL(url,ac.signal);
    res.writeHead(200,{
      ...headers,
      'content-type':'model/gltf-binary',
      'content-length':model.length,
      'content-disposition':'inline; filename="holo-frame.glb"',
      'x-holo-model-valid':'glb-v2'
    });
    res.end(model);
  } catch(e) {
    reply(res,e.name==='AbortError'?504:502,{error:'GLB retrieval failed: '+(e.name==='AbortError'?'timeout':e.message)});
  } finally {clearTimeout(timer);}
}

const ROUTES = [
  { match: /^\/relay\/piapi\/model$/, method: 'POST', target: () => null, kind: 'model' },
  { match: /^\/relay\/piapi\/upload$/, method: 'POST', target: () => 'https://upload.theapi.app/api/ephemeral_resource', kind: 'piapi' },
  { match: /^\/relay\/piapi\/task$/, method: 'POST', target: () => 'https://api.piapi.ai/api/v1/task', kind: 'piapi' },
  { match: /^\/relay\/piapi\/glb$/, method: 'POST', target: () => '', kind: 'piapi-glb' },
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
  const key = route.kind.startsWith('piapi') ? req.headers['x-api-key'] : req.headers.authorization;
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
    if (route.kind === 'piapi-glb') {
      // Resolve the GLB URL from the authenticated PiAPI task. No arbitrary URLs.
      const taskId = JSON.parse(body.toString('utf8')).task_id;
      if (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{12,120}$/.test(taskId)) {
        return reply(res, 400, { error: 'A valid PiAPI task ID is required' });
      }
      const check = await fetch('https://api.piapi.ai/api/v1/task/' + encodeURIComponent(taskId), {
        headers: { 'x-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(20000)
      });
      if (!check.ok) return reply(res, check.status, { error: 'Cannot read that PiAPI task' });
      const taskResult = await check.json();
      const task = taskResult.data || taskResult;
      const modelFile = task.output?.model_file || task.output?.model_url || task.output?.glb;
      if (task.status !== 'completed' || typeof modelFile !== 'string') {
        return reply(res, 409, { error: 'Task is not completed or has no GLB file' });
      }
      let modelURL;
      try { modelURL = new URL(modelFile); }
      catch { return reply(res, 502, { error: 'Invalid PiAPI GLB URL' }); }
      if (modelURL.protocol !== 'https:' || modelURL.hostname !== 'img.theapi.app' ||
          modelURL.port || modelURL.username || modelURL.password ||
          !modelURL.pathname.toLowerCase().endsWith('.glb')) {
        return reply(res, 502, { error: 'GLB URL host or format not allowed' });
      }
      const upstreamGLB = await fetch(modelURL.href, { redirect: 'error', signal: AbortSignal.timeout(90000) });
      if (!upstreamGLB.ok || !upstreamGLB.body) {
        return reply(res, 502, { error: 'PiAPI GLB could not be downloaded' });
      }
      const maxGLB = 64 * 1024 * 1024;
      const declared = Number(upstreamGLB.headers.get('content-length') || 0);
      if (declared > maxGLB) {
        await upstreamGLB.body.cancel();
        return reply(res, 413, { error: 'GLB exceeds 64 MB phone preview limit. Use model link.' });
      }
      res.writeHead(200, {
        'content-type': 'model/gltf-binary',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*'
      });
      let received = 0;
      try {
        for await (const chunk of upstreamGLB.body) {
          received += chunk.length;
          if (received > maxGLB) throw Error('GLB exceeds 64 MB limit');
          if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
        }
        res.end();
      } catch {
        res.destroy();
      }
      return;
    }
    if (route.kind === 'model') return serveModel(res,key,body);
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
