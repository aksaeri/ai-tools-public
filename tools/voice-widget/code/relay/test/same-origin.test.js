import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corsFor } from '../src/index.js';
import { handle } from '../src/index.js';

test('same-origin GET without Origin header is treated as the relay origin', async () => {
  const env = { DEPLOYMENTS: { idFromName: () => 'x', get: () => ({ usage: async () => ({}), status: async () => ({ active: true, available: true }) }) }, GROQ_API_KEY: 'k', ADMIN_TOKEN: 't' };
  const req = new Request('https://voice.aksaeri.com/v1/status?d=demo', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  const res = await handle(req, env);
  assert.notEqual(res.status, 403);
});

test('no Origin and no Sec-Fetch-Site is still refused', async () => {
  const env = { DEPLOYMENTS: { idFromName: () => 'x', get: () => ({}) }, GROQ_API_KEY: 'k', ADMIN_TOKEN: 't' };
  const res = await handle(new Request('https://voice.aksaeri.com/v1/status?d=demo'), env);
  assert.equal(res.status, 403);
});
