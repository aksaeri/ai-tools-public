// voice-widget relay (Cloudflare Worker). Routes per
// docs/specs/2026-11-06-v1-relay-and-package.md.
//
// Logs only: deployment, status code, seconds, cost. Never transcript text, never audio.

import config from '../deployments.json' with { type: 'json' };
import { cost, pricePerHour } from './budget.js';
export { DeploymentDO } from './deployment-do.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';
const MAX_BYTES = 15 * 1024 * 1024;
const PROMPT_MIN_SECONDS = 2;
const LENGTH_GRACE_SECONDS = 2; // client timers overshoot the auto-stop slightly

const MESSAGES = {
  unknown_deployment: 'Voice typing is not set up for this page.',
  origin_not_allowed: 'Voice typing is not enabled on this website.',
  inactive: 'Voice typing is turned off right now. Please type your answer.',
  budget_exhausted: 'Voice typing is not available right now. Please type your answer.',
  rate_limited: 'Too many recordings in a short time. Please wait a minute and try again.',
  too_long: 'That recording is too long. Please record a shorter answer.',
  empty: 'No sound was received. Please try recording again.',
  upstream_error: 'Your speech could not be turned into text. Please try again, or type your answer.',
  method_not_allowed: 'This address does not accept that kind of request.',
  unauthorized: 'Missing or wrong admin token.',
  not_found: 'Not found.',
};

const EXT_FOR_MIME = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4',
  'video/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac',
};

const round6 = (n) => Math.round(n * 1e6) / 1e6;

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function err(code, status, headers = {}) {
  return json(status, { error: code, message: MESSAGES[code] }, headers);
}

function log(fields) {
  console.log(JSON.stringify(fields));
}

/** CORS headers for an allowed origin, or null if the origin is not allowed. */
export function corsFor(dep, origin) {
  const list = dep.allowed_origins || [];
  if (origin && list.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  if (list.includes('*')) return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
  return null;
}

/** Constant-time comparison of two strings (hash both, then compare every byte). */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function isAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return safeEqual(m ? m[1].trim() : '', token);
}

function stubFor(env, name) {
  return env.DEPLOYMENTS.get(env.DEPLOYMENTS.idFromName(name));
}

/** Build the request handler for a given deployments map (tests pass their own). */
export function createHandler(deployments) {
  const lookup = (name) => (name && Object.prototype.hasOwnProperty.call(deployments, name) ? deployments[name] : null);

  async function transcribe(request, env, name, dep, cors) {
    const done = (resp, seconds = 0, costUsd = 0) => {
      log({ d: name, status: resp.status, seconds: round6(seconds), cost: round6(costUsd) });
      return resp;
    };
    const H = { ...cors, 'Access-Control-Expose-Headers': 'Retry-After' };

    if (!dep.active) return done(err('inactive', 403, H));

    const maxSeconds = Number(dep.max_seconds) || 180;
    const hdrSeconds = parseFloat(request.headers.get('X-Audio-Seconds') || '');
    const clientSeconds = Number.isFinite(hdrSeconds) && hdrSeconds >= 0 ? hdrSeconds : null;
    if (clientSeconds !== null && clientSeconds > maxSeconds + LENGTH_GRACE_SECONDS) return done(err('too_long', 413, H));
    const declared = Number(request.headers.get('Content-Length') || '0');
    if (declared > MAX_BYTES) return done(err('too_long', 413, H));

    const audio = await request.arrayBuffer();
    if (audio.byteLength > MAX_BYTES) return done(err('too_long', 413, H));
    if (audio.byteLength === 0 || clientSeconds === 0) return done(err('empty', 400, H));

    const perHour = pricePerHour(env);
    const budget = Number(dep.budget_usd) || 0;
    const stub = stubFor(env, name);
    const r = await stub.reserve({
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      rate_per_min: Number(dep.rate_per_ip_per_min) || 0,
      amount: cost(maxSeconds, perHour),
      budget_usd: budget,
    });
    if (!r.ok && r.error === 'rate_limited') {
      return done(err('rate_limited', 429, { ...H, 'Retry-After': String(r.retry_after_s) }));
    }
    if (!r.ok) return done(err('budget_exhausted', 402, H));

    const mime = (request.headers.get('Content-Type') || 'audio/webm').split(';')[0].trim().toLowerCase();
    const ext = EXT_FOR_MIME[mime] || 'webm';
    const form = new FormData();
    form.append('file', new File([audio], `audio.${ext}`, { type: mime }));
    form.append('model', GROQ_MODEL);
    form.append('language', 'en');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    const prompt = (dep.prompt || '').trim();
    if (prompt && (clientSeconds === null || clientSeconds >= PROMPT_MIN_SECONDS)) form.append('prompt', prompt);

    let data;
    try {
      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: form,
      });
      if (!resp.ok) throw new Error(`groq ${resp.status}`);
      data = await resp.json();
      if (!data || typeof data.text !== 'string') throw new Error('groq bad body');
    } catch (e) {
      // Log our own status tag or the error class only: a parser message could quote the body.
      const why = e && typeof e.message === 'string' && e.message.startsWith('groq ') ? e.message : (e && e.name) || 'error';
      log({ d: name, upstream: why });
      await stub.release({ id: r.id });
      return done(err('upstream_error', 502, H));
    }

    const dur = Number(data.duration);
    const seconds = Number.isFinite(dur) && dur >= 0 ? dur : (clientSeconds ?? maxSeconds);
    const costUsd = cost(seconds, perHour);
    const s = await stub.settle({ id: r.id, seconds, cost_usd: costUsd, budget_usd: budget });
    return done(
      json(200, {
        text: data.text.trim(),
        seconds: round6(seconds),
        cost_usd: round6(costUsd),
        remaining_usd: round6(s.remaining_usd),
      }, H),
      seconds,
      costUsd,
    );
  }

  async function status(env, name, dep, cors) {
    if (!dep.active) return json(200, { active: false, available: false }, cors);
    const u = await stubFor(env, name).usage();
    const budget = Number(dep.budget_usd) || 0;
    const left = Math.max(0, budget - u.spent_usd - u.reserved_usd);
    const need = cost(Number(dep.max_seconds) || 180, pricePerHour(env));
    return json(200, { active: true, available: left + 1e-12 >= need }, cors);
  }

  async function adminUsage(env) {
    const out = {};
    for (const [name, dep] of Object.entries(deployments)) {
      const u = await stubFor(env, name).usage();
      out[name] = {
        budget_usd: Number(dep.budget_usd) || 0,
        spent_usd: round6(u.spent_usd),
        reserved_usd: round6(u.reserved_usd),
        requests: u.requests,
        seconds: round6(u.seconds),
        last_used: u.last_used ? new Date(u.last_used).toISOString() : null,
        active: !!dep.active,
      };
    }
    return json(200, { deployments: out, price_per_hour_usd: pricePerHour(env) });
  }

  return async function handle(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/v1/transcribe' || path === '/v1/status') {
      const name = url.searchParams.get('d');
      const dep = lookup(name);
      if (!dep) return err('unknown_deployment', 404);
      // Browsers omit Origin on same-origin GETs (e.g. the demo page's status check);
      // Sec-Fetch-Site tells us it really came from a page on this host. curl sends neither.
      let origin = request.headers.get('Origin');
      if (!origin && request.headers.get('Sec-Fetch-Site') === 'same-origin') origin = url.origin;
      const cors = corsFor(dep, origin);
      if (!cors) return err('origin_not_allowed', 403, { Vary: 'Origin' });
      const isTranscribe = path === '/v1/transcribe';

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': isTranscribe ? 'POST, OPTIONS' : 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Audio-Seconds',
            'Access-Control-Max-Age': '600',
          },
        });
      }
      if (isTranscribe && request.method === 'POST') return transcribe(request, env, name, dep, cors);
      if (!isTranscribe && request.method === 'GET') return status(env, name, dep, cors);
      return err('method_not_allowed', 405, { ...cors, Allow: isTranscribe ? 'POST, OPTIONS' : 'GET, OPTIONS' });
    }

    if (path === '/admin/usage' || path === '/admin/reset') {
      if (!(await isAdmin(request, env))) return err('unauthorized', 401, { 'WWW-Authenticate': 'Bearer' });
      if (path === '/admin/usage') {
        if (request.method !== 'GET') return err('method_not_allowed', 405, { Allow: 'GET' });
        return adminUsage(env);
      }
      if (request.method !== 'POST') return err('method_not_allowed', 405, { Allow: 'POST' });
      const name = url.searchParams.get('d');
      if (!lookup(name)) return err('unknown_deployment', 404);
      await stubFor(env, name).reset();
      log({ d: name, admin: 'reset' });
      return json(200, { ok: true, deployment: name });
    }
    if (path.startsWith('/admin/')) return err('not_found', 404);

    return env.ASSETS.fetch(request);
  };
}

export const handle = createHandler(config.deployments);

export default { fetch: handle };
