import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeNamespace, fakeAssets, mockFetch } from './helpers/fakes.js';
import { cost } from '../src/budget.js';

const { createHandler, handle: realHandle, corsFor } = await import('../src/index.js');

const ORIGIN = 'https://site.example';
const DEPS = {
  t: { budget_usd: 1, active: true, allowed_origins: [ORIGIN], max_seconds: 90, rate_per_ip_per_min: 100, prompt: 'Bayesian, Qualtrics', notice: '' },
  tiny: { budget_usd: cost(90) * 1.5, active: true, allowed_origins: [ORIGIN], max_seconds: 90, rate_per_ip_per_min: 100, prompt: '', notice: '' },
  off: { budget_usd: 1, active: false, allowed_origins: [ORIGIN], max_seconds: 90, rate_per_ip_per_min: 100, prompt: '', notice: '' },
  slow: { budget_usd: 1, active: true, allowed_origins: [ORIGIN], max_seconds: 90, rate_per_ip_per_min: 2, prompt: '', notice: '' },
  any: { budget_usd: 1, active: true, allowed_origins: ['*'], max_seconds: 90, rate_per_ip_per_min: 100, prompt: '', notice: '' },
};

async function setup(deps = DEPS) {
  const env = { DEPLOYMENTS: await fakeNamespace(), ASSETS: fakeAssets(), GROQ_API_KEY: 'gk-test', ADMIN_TOKEN: 'admin-secret' };
  return { env, handle: createHandler(deps) };
}

function groqOk(duration = 12.5, text = '  hello world ') {
  return mockFetch(async () => new Response(JSON.stringify({ text, duration, segments: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function post(d, { origin = ORIGIN, body = new Uint8Array(1000), seconds, type = 'audio/webm;codecs=opus', ip = '9.9.9.9' } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  if (seconds !== undefined) headers['X-Audio-Seconds'] = String(seconds);
  return new Request(`https://voice.aksaeri.com/v1/transcribe?d=${encodeURIComponent(d)}`, { method: 'POST', headers, body });
}

async function body(resp) { return JSON.parse(await resp.text()); }

test('transcribe 200: Groq form fields, CORS, settle with Groq duration', async () => {
  const { env, handle } = await setup();
  const m = groqOk(12.5);
  try {
    const resp = await handle(post('t', { seconds: 12 }), env);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(resp.headers.get('Vary'), 'Origin');
    const b = await body(resp);
    assert.equal(b.text, 'hello world');
    assert.equal(b.seconds, 12.5);
    assert.equal(b.cost_usd, Math.round(cost(12.5) * 1e6) / 1e6);
    assert.ok(Math.abs(b.remaining_usd - (1 - cost(12.5))) < 1e-6);

    assert.equal(m.calls.length, 1);
    const { url, init } = m.calls[0];
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(init.headers.Authorization, 'Bearer gk-test');
    const f = init.body;
    assert.equal(f.get('model'), 'whisper-large-v3-turbo');
    assert.equal(f.get('language'), 'en');
    assert.equal(f.get('response_format'), 'verbose_json');
    assert.equal(f.get('temperature'), '0');
    assert.equal(f.get('prompt'), 'Bayesian, Qualtrics');
    assert.equal(f.get('file').name, 'audio.webm');
    assert.equal(f.get('file').size, 1000);

    const u = await env.DEPLOYMENTS.get({ name: 't' }).usage();
    assert.ok(Math.abs(u.spent_usd - cost(12.5)) < 1e-12);
    assert.equal(u.reserved_usd, 0);
    assert.equal(u.requests, 1);
  } finally { m.restore(); }
});

test('prompt omitted for clips under 2 s; sent when length unknown', async () => {
  const { env, handle } = await setup();
  const m = groqOk(1.5);
  try {
    await handle(post('t', { seconds: 1.5 }), env);
    assert.equal(m.calls[0].init.body.get('prompt'), null);
    await handle(post('t', { seconds: 2 }), env);
    assert.equal(m.calls[1].init.body.get('prompt'), 'Bayesian, Qualtrics');
    await handle(post('t', {}), env);
    assert.equal(m.calls[2].init.body.get('prompt'), 'Bayesian, Qualtrics');
  } finally { m.restore(); }
});

test('prompt omitted when the deployment prompt is empty', async () => {
  const { env, handle } = await setup();
  const m = groqOk();
  try {
    await handle(post('any', { seconds: 30 }), env);
    assert.equal(m.calls[0].init.body.get('prompt'), null);
  } finally { m.restore(); }
});

test('Safari audio/mp4 is sent with an .mp4 filename', async () => {
  const { env, handle } = await setup();
  const m = groqOk();
  try {
    await handle(post('t', { type: 'audio/mp4' }), env);
    assert.equal(m.calls[0].init.body.get('file').name, 'audio.mp4');
  } finally { m.restore(); }
});

test('CORS preflight: allowed origin gets the spec headers', async () => {
  const { env, handle } = await setup();
  const resp = await handle(new Request('https://voice.aksaeri.com/v1/transcribe?d=t', {
    method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-audio-seconds' },
  }), env);
  assert.equal(resp.status, 204);
  assert.equal(resp.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(resp.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(resp.headers.get('Access-Control-Allow-Headers'), 'Content-Type, X-Audio-Seconds');
  assert.equal(resp.headers.get('Access-Control-Max-Age'), '600');
  assert.equal(resp.headers.get('Vary'), 'Origin');
});

test('CORS deny: other origin gets 403 origin_not_allowed and no ACAO (POST and preflight)', async () => {
  const { env, handle } = await setup();
  const m = groqOk();
  try {
    const r1 = await handle(post('t', { origin: 'https://evil.example' }), env);
    assert.equal(r1.status, 403);
    assert.equal((await body(r1)).error, 'origin_not_allowed');
    assert.equal(r1.headers.get('Access-Control-Allow-Origin'), null);
    const r2 = await handle(new Request('https://voice.aksaeri.com/v1/transcribe?d=t', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
    assert.equal(r2.status, 403);
    assert.equal(r2.headers.get('Access-Control-Allow-Origin'), null);
    const r3 = await handle(post('t', { origin: null }), env); // no Origin header at all
    assert.equal(r3.status, 403);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test('CORS "*" only when written; echoes the caller origin', () => {
  assert.deepEqual(corsFor(DEPS.any, 'https://x.example'), { 'Access-Control-Allow-Origin': 'https://x.example', Vary: 'Origin' });
  assert.equal(corsFor(DEPS.t, 'https://x.example'), null);
  assert.equal(corsFor(DEPS.t, 'https://site.example/'), null); // exact match only
});

test('unknown_deployment 404 (unknown name and missing d)', async () => {
  const { env, handle } = await setup();
  for (const d of ['nope', '__proto__', 'constructor']) {
    const r = await handle(post(d), env);
    assert.equal(r.status, 404);
    assert.equal((await body(r)).error, 'unknown_deployment');
  }
  const r = await handle(new Request('https://voice.aksaeri.com/v1/status', { headers: { Origin: ORIGIN } }), env);
  assert.equal(r.status, 404);
});

test('inactive 403', async () => {
  const { env, handle } = await setup();
  const r = await handle(post('off'), env);
  assert.equal(r.status, 403);
  const b = await body(r);
  assert.equal(b.error, 'inactive');
  assert.equal(typeof b.message, 'string');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('budget_exhausted 402 once a full clip no longer fits', async () => {
  const { env, handle } = await setup();
  const m = groqOk(90);
  try {
    assert.equal((await handle(post('tiny'), env)).status, 200);
    const r = await handle(post('tiny'), env);
    assert.equal(r.status, 402);
    assert.equal((await body(r)).error, 'budget_exhausted');
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

test('rate_limited 429 with Retry-After, per IP', async () => {
  const { env, handle } = await setup();
  const m = groqOk();
  try {
    assert.equal((await handle(post('slow'), env)).status, 200);
    assert.equal((await handle(post('slow'), env)).status, 200);
    const r = await handle(post('slow'), env);
    assert.equal(r.status, 429);
    assert.equal((await body(r)).error, 'rate_limited');
    assert.ok(Number(r.headers.get('Retry-After')) >= 1);
    assert.match(r.headers.get('Access-Control-Expose-Headers'), /Retry-After/);
    assert.equal((await handle(post('slow', { ip: '8.8.8.8' }), env)).status, 200);
  } finally { m.restore(); }
});

test('too_long 413: client length over max, or body over 15 MB', async () => {
  const { env, handle } = await setup();
  const m = groqOk();
  try {
    const r = await handle(post('t', { seconds: 120 }), env);
    assert.equal(r.status, 413);
    assert.equal((await body(r)).error, 'too_long');
    assert.equal((await handle(post('t', { seconds: 91 }), env)).status, 200); // small timer overshoot is fine
    const big = await handle(post('t', { body: new Uint8Array(15 * 1024 * 1024 + 1) }), env);
    assert.equal(big.status, 413);
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

test('empty 400: no bytes, or zero seconds', async () => {
  const { env, handle } = await setup();
  const r = await handle(post('t', { body: new Uint8Array(0) }), env);
  assert.equal(r.status, 400);
  assert.equal((await body(r)).error, 'empty');
  assert.equal((await handle(post('t', { seconds: 0 }), env)).status, 400);
});

test('upstream_error 502 releases the reservation and charges nothing', async () => {
  for (const responder of [
    async () => new Response('{"error":"boom"}', { status: 500 }),
    async () => { throw new Error('network down'); },
    async () => new Response('not json', { status: 200 }),
  ]) {
    const { env, handle } = await setup();
    const m = mockFetch(responder);
    try {
      const r = await handle(post('t'), env);
      assert.equal(r.status, 502);
      assert.equal((await body(r)).error, 'upstream_error');
      const u = await env.DEPLOYMENTS.get({ name: 't' }).usage();
      assert.equal(u.spent_usd, 0);
      assert.equal(u.reserved_usd, 0);
      assert.equal(u.requests, 0);
    } finally { m.restore(); }
  }
});

test('never logs transcript text', async () => {
  const { env, handle } = await setup();
  const m = groqOk(5, 'SECRET-TRANSCRIPT');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await handle(post('t'), env);
  } finally { console.log = orig; m.restore(); }
  assert.ok(lines.length >= 1);
  assert.ok(!lines.join('\n').includes('SECRET-TRANSCRIPT'));
  assert.deepEqual(Object.keys(JSON.parse(lines.at(-1))), ['d', 'status', 'seconds', 'cost']);
});

test('status: available flips when budget is used up; inactive reports false', async () => {
  const { env, handle } = await setup();
  const get = (d, origin = ORIGIN) => handle(new Request(`https://voice.aksaeri.com/v1/status?d=${d}`, { headers: { Origin: origin } }), env);
  let r = await get('tiny');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await body(r), { active: true, available: true });
  const m = groqOk(90);
  try { await handle(post('tiny'), env); } finally { m.restore(); }
  assert.deepEqual(await body(await get('tiny')), { active: true, available: false });
  assert.deepEqual(await body(await get('off')), { active: false, available: false });
  assert.equal((await get('t', 'https://evil.example')).status, 403);
});

test('method not allowed on API routes', async () => {
  const { env, handle } = await setup();
  const r = await handle(new Request('https://voice.aksaeri.com/v1/transcribe?d=t', { headers: { Origin: ORIGIN } }), env);
  assert.equal(r.status, 405);
});

test('admin: wrong, missing or unset token -> 401', async () => {
  const { env, handle } = await setup();
  const req = (auth) => new Request('https://voice.aksaeri.com/admin/usage', { headers: auth ? { Authorization: auth } : {} });
  assert.equal((await handle(req(), env)).status, 401);
  assert.equal((await handle(req('Bearer nope'), env)).status, 401);
  assert.equal((await handle(req('admin-secret'), env)).status, 401);
  assert.equal((await handle(req('Bearer admin-secret'), { ...env, ADMIN_TOKEN: '' })).status, 401);
  assert.equal((await handle(req('Bearer '), { ...env, ADMIN_TOKEN: '' })).status, 401);
  assert.equal((await handle(new Request('https://voice.aksaeri.com/admin/reset?d=t', { method: 'POST' }), env)).status, 401);
});

test('admin usage and reset', async () => {
  const { env, handle } = await setup();
  const m = groqOk(30);
  try { await handle(post('t'), env); } finally { m.restore(); }
  const auth = { Authorization: 'Bearer admin-secret' };
  const r = await handle(new Request('https://voice.aksaeri.com/admin/usage', { headers: auth }), env);
  assert.equal(r.status, 200);
  const b = await body(r);
  assert.deepEqual(Object.keys(b.deployments), Object.keys(DEPS));
  const t = b.deployments.t;
  assert.deepEqual(Object.keys(t).sort(), ['active', 'budget_usd', 'last_used', 'requests', 'reserved_usd', 'seconds', 'spent_usd']);
  assert.equal(t.requests, 1);
  assert.equal(t.seconds, 30);
  assert.equal(t.budget_usd, 1);
  assert.match(t.last_used, /^\d{4}-\d\d-\d\dT/);
  assert.equal(b.deployments.off.active, false);

  const bad = await handle(new Request('https://voice.aksaeri.com/admin/reset?d=nope', { method: 'POST', headers: auth }), env);
  assert.equal(bad.status, 404);
  const rr = await handle(new Request('https://voice.aksaeri.com/admin/reset?d=t', { method: 'POST', headers: auth }), env);
  assert.equal(rr.status, 200);
  const after = await body(await handle(new Request('https://voice.aksaeri.com/admin/usage', { headers: auth }), env));
  assert.equal(after.deployments.t.spent_usd, 0);
  assert.equal(after.deployments.t.requests, 0);
});

test('everything else falls through to static assets', async () => {
  const { env, handle } = await setup();
  for (const p of ['/', '/v1/voice-widget.js', '/index.html']) {
    const r = await handle(new Request(`https://voice.aksaeri.com${p}`), env);
    assert.equal(await r.text(), `asset:${p}`);
  }
  assert.equal((await handle(new Request('https://voice.aksaeri.com/admin/other'), env)).status, 404);
});

test('bundled deployments.json is valid and wired into the default handler', async () => {
  const cfg = JSON.parse(readFileSync(new URL('../deployments.json', import.meta.url)));
  for (const name of ['demo', 'my-survey', 'dev']) assert.ok(cfg.deployments[name], name);
  for (const [name, d] of Object.entries(cfg.deployments)) {
    assert.equal(typeof d.budget_usd, 'number', name);
    assert.equal(typeof d.active, 'boolean', name);
    assert.ok(Array.isArray(d.allowed_origins), name);
    for (const o of d.allowed_origins) assert.ok(o === '*' || new URL(o).origin === o, `${name}: ${o}`);
    assert.ok(d.max_seconds > 0 && d.rate_per_ip_per_min >= 0, name);
    assert.equal(typeof d.prompt, 'string');
    assert.equal(typeof d.notice, 'string');
  }
  const env = { DEPLOYMENTS: await fakeNamespace(), ASSETS: fakeAssets() };
  const r = await realHandle(new Request('https://voice.aksaeri.com/v1/status?d=demo', { headers: { Origin: 'https://voice.aksaeri.com' } }), env);
  assert.deepEqual(await body(r), { active: true, available: true });
});
