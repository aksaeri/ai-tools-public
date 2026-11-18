import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/budget.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('cost: 10 s minimum, then linear at $0.04/hour', () => {
  near(B.cost(0), (10 * 0.04) / 3600);
  near(B.cost(3), (10 * 0.04) / 3600);
  near(B.cost(10), (10 * 0.04) / 3600);
  near(B.cost(60), (60 * 0.04) / 3600);
  near(B.cost(90), 0.001);
  near(B.cost(3600), 0.04);
  near(B.cost(NaN), B.cost(10));
});

test('pricePerHour honours env override and ignores junk', () => {
  assert.equal(B.pricePerHour({}), 0.04);
  assert.equal(B.pricePerHour({ PRICE_PER_HOUR_USD: '0.111' }), 0.111);
  assert.equal(B.pricePerHour({ PRICE_PER_HOUR_USD: 'abc' }), 0.04);
  near(B.cost(3600, B.pricePerHour({ PRICE_PER_HOUR_USD: '1' })), 1);
});

test('reserve refuses when spent + reserved + amount > budget', () => {
  const s = B.emptyState();
  const amt = B.cost(90); // 0.001
  assert.ok(B.reserve(s, { id: 'a', amount: amt, budget: 0.0025, now: 0 }).ok);
  assert.ok(B.reserve(s, { id: 'b', amount: amt, budget: 0.0025, now: 0 }).ok);
  assert.equal(B.reserve(s, { id: 'c', amount: amt, budget: 0.0025, now: 0 }).ok, false);
  near(B.reservedTotal(s, 0), 0.002);
  s.spent_usd = 0.0024;
  B.release(s, 'a'); B.release(s, 'b');
  assert.equal(B.reserve(s, { id: 'd', amount: amt, budget: 0.0025, now: 0 }).ok, false);
});

test('reserve allows exactly reaching the budget', () => {
  const s = B.emptyState();
  assert.ok(B.reserve(s, { id: 'a', amount: 0.001, budget: 0.001, now: 0 }).ok);
});

test('settle releases the reservation and adds the actual cost', () => {
  const s = B.emptyState();
  B.reserve(s, { id: 'a', amount: B.cost(90), budget: 1, now: 1000 });
  B.settle(s, { id: 'a', seconds: 30, cost_usd: B.cost(30), now: 2000 });
  assert.deepEqual(s.reservations, {});
  near(s.spent_usd, B.cost(30));
  assert.equal(s.requests, 1);
  assert.equal(s.seconds, 30);
  assert.equal(s.last_used, 2000);
  near(B.remaining(s, 1, 2000), 1 - B.cost(30));
});

test('release adds nothing', () => {
  const s = B.emptyState();
  B.reserve(s, { id: 'a', amount: 0.5, budget: 1, now: 0 });
  B.release(s, 'a');
  assert.equal(s.spent_usd, 0);
  assert.equal(s.requests, 0);
  near(B.remaining(s, 1, 0), 1);
});

test('stale reservations (>= 5 min) expire and stop counting', () => {
  const s = B.emptyState();
  B.reserve(s, { id: 'a', amount: 1, budget: 1, now: 0 });
  assert.equal(B.reserve(s, { id: 'b', amount: 0.5, budget: 1, now: 60_000 }).ok, false);
  assert.equal(B.reservedTotal(s, B.RESERVATION_TTL_MS - 1), 1);
  assert.equal(B.reservedTotal(s, B.RESERVATION_TTL_MS), 0);
  assert.ok(B.reserve(s, { id: 'c', amount: 1, budget: 1, now: B.RESERVATION_TTL_MS }).ok);
  assert.deepEqual(Object.keys(s.reservations), ['c']);
});

test('available: needs a full max-length clip of headroom, and active', () => {
  const s = B.emptyState();
  assert.ok(B.available(s, { budget: 0.001, max_seconds: 90, active: true, now: 0 }));
  assert.equal(B.available(s, { budget: 0.001, max_seconds: 90, active: false, now: 0 }), false);
  s.spent_usd = 0.0005;
  assert.equal(B.available(s, { budget: 0.001, max_seconds: 90, active: true, now: 0 }), false);
});

test('rateCheck: sliding 60 s window with Retry-After', () => {
  let hits = [];
  for (let i = 0; i < 3; i++) {
    const r = B.rateCheck(hits, { limit: 3, now: i * 1000 });
    assert.ok(r.ok);
    hits = r.hits;
  }
  const blocked = B.rateCheck(hits, { limit: 3, now: 10_000 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retry_after_s, 50);
  assert.equal(blocked.hits.length, 3); // refused hits are not recorded
  const later = B.rateCheck(blocked.hits, { limit: 3, now: 60_000 }); // first hit (t=0) has left the window
  assert.ok(later.ok);
  assert.deepEqual(later.hits, [1000, 2000, 60_000]);
});

test('rateCheck: limit 0 means unlimited', () => {
  assert.ok(B.rateCheck(new Array(100).fill(0), { limit: 0, now: 1 }).ok);
});
