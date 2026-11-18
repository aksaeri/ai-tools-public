import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers/fakes.js';
import { cost, RESERVATION_TTL_MS } from '../src/budget.js';

const { DeploymentDO } = await import('../src/deployment-do.js');

function make(sql = fakeSql()) {
  return { sql, d: new DeploymentDO({ storage: { sql } }, {}) };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('DO: reserve, settle and usage persist in SQL across instances', () => {
  const { sql, d } = make();
  const r = d.reserve({ ip: '1.1.1.1', rate_per_min: 10, amount: cost(90), budget_usd: 1, now: 1000 });
  assert.ok(r.ok);
  near(d.usage({ now: 1000 }).reserved_usd, cost(90));
  d.settle({ id: r.id, seconds: 20, cost_usd: cost(20), budget_usd: 1, now: 2000 });
  const again = new DeploymentDO({ storage: { sql } }, {}); // simulates eviction / redeploy
  const u = again.usage({ now: 2000 });
  near(u.spent_usd, cost(20));
  assert.equal(u.reserved_usd, 0);
  assert.equal(u.requests, 1);
  assert.equal(u.seconds, 20);
  assert.equal(u.last_used, 2000);
});

test('DO: budget_exhausted when a full clip no longer fits', () => {
  const { d } = make();
  const amt = cost(90);
  assert.ok(d.reserve({ ip: 'a', rate_per_min: 0, amount: amt, budget_usd: amt * 1.5, now: 0 }).ok);
  assert.deepEqual(d.reserve({ ip: 'b', rate_per_min: 0, amount: amt, budget_usd: amt * 1.5, now: 0 }), { ok: false, error: 'budget_exhausted' });
});

test('DO: release charges nothing; stale reservations expire', () => {
  const { d } = make();
  const r = d.reserve({ ip: 'a', rate_per_min: 0, amount: 1, budget_usd: 1, now: 0 });
  d.release({ id: r.id });
  assert.equal(d.usage({ now: 0 }).reserved_usd, 0);
  assert.equal(d.usage({ now: 0 }).spent_usd, 0);
  d.reserve({ ip: 'a', rate_per_min: 0, amount: 1, budget_usd: 1, now: 0 });
  assert.equal(d.reserve({ ip: 'a', rate_per_min: 0, amount: 1, budget_usd: 1, now: 1000 }).ok, false);
  assert.ok(d.reserve({ ip: 'a', rate_per_min: 0, amount: 1, budget_usd: 1, now: RESERVATION_TTL_MS }).ok);
});

test('DO: rate limit is per IP', () => {
  const { d } = make();
  const args = (ip, now) => ({ ip, rate_per_min: 2, amount: 0, budget_usd: 1, now });
  assert.ok(d.reserve(args('x', 0)).ok);
  assert.ok(d.reserve(args('x', 1)).ok);
  const r = d.reserve(args('x', 2));
  assert.equal(r.error, 'rate_limited');
  assert.equal(r.retry_after_s, 60);
  assert.ok(d.reserve(args('y', 2)).ok);
});

test('DO: reset zeroes spend and reservations', () => {
  const { d } = make();
  const r = d.reserve({ ip: 'a', rate_per_min: 0, amount: 0.5, budget_usd: 1, now: 0 });
  d.settle({ id: r.id, seconds: 10, cost_usd: 0.4, budget_usd: 1, now: 0 });
  d.reserve({ ip: 'a', rate_per_min: 0, amount: 0.5, budget_usd: 1, now: 0 });
  d.reset();
  assert.deepEqual(d.usage({ now: 0 }), { spent_usd: 0, reserved_usd: 0, requests: 0, seconds: 0, last_used: null });
});
