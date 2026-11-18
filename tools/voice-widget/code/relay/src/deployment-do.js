// DeploymentDO: one SQLite-backed Durable Object per deployment (idFromName(name)).
// Holds spend, usage counters and reservations. Rate-limit hits live in memory
// (losing them on eviction only resets the 60 s window).
//
// RPC methods run one at a time and use the synchronous SQL API with no awaits
// in between, so each reserve/settle is atomic.

import { DurableObject } from 'cloudflare:workers';
import * as B from './budget.js';

export class DeploymentDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.hits = new Map(); // ip -> [timestamps]
    this.sql.exec(`CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      spent_usd REAL NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      seconds REAL NOT NULL DEFAULT 0,
      last_used INTEGER
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      at INTEGER NOT NULL
    )`);
    this.sql.exec('INSERT OR IGNORE INTO usage (id) VALUES (1)');
  }

  _load() {
    const u = this.sql.exec('SELECT spent_usd, requests, seconds, last_used FROM usage WHERE id = 1').toArray()[0];
    const state = B.emptyState();
    if (u) {
      state.spent_usd = Number(u.spent_usd) || 0;
      state.requests = Number(u.requests) || 0;
      state.seconds = Number(u.seconds) || 0;
      state.last_used = u.last_used === null || u.last_used === undefined ? null : Number(u.last_used);
    }
    for (const r of this.sql.exec('SELECT id, amount, at FROM reservations').toArray()) {
      state.reservations[r.id] = { amount: Number(r.amount), at: Number(r.at) };
    }
    return state;
  }

  _save(state) {
    this.sql.exec(
      'UPDATE usage SET spent_usd = ?, requests = ?, seconds = ?, last_used = ? WHERE id = 1',
      state.spent_usd, state.requests, state.seconds, state.last_used,
    );
    this.sql.exec('DELETE FROM reservations');
    for (const [id, r] of Object.entries(state.reservations)) {
      this.sql.exec('INSERT INTO reservations (id, amount, at) VALUES (?, ?, ?)', id, r.amount, r.at);
    }
  }

  _rate(ip, limit, now) {
    const res = B.rateCheck(this.hits.get(ip), { limit, now });
    if (res.hits.length) this.hits.set(ip, res.hits);
    else this.hits.delete(ip);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (!v.some((t) => now - t < B.RATE_WINDOW_MS)) this.hits.delete(k);
      }
    }
    return res;
  }

  /**
   * Rate-limit check, then budget reservation.
   * Returns { ok: true, id, remaining_usd } | { ok: false, error: 'rate_limited', retry_after_s }
   *       | { ok: false, error: 'budget_exhausted' }
   */
  reserve({ ip, rate_per_min, amount, budget_usd, now = Date.now() }) {
    const rate = this._rate(ip || 'unknown', rate_per_min, now);
    if (!rate.ok) return { ok: false, error: 'rate_limited', retry_after_s: rate.retry_after_s };
    const state = this._load();
    const id = crypto.randomUUID();
    const res = B.reserve(state, { id, amount, budget: budget_usd, now });
    if (!res.ok) return { ok: false, error: 'budget_exhausted' };
    this._save(state);
    return { ok: true, id, remaining_usd: res.remaining_usd };
  }

  /** Release the reservation and add the actual cost. Returns { spent_usd, remaining_usd }. */
  settle({ id, seconds, cost_usd, budget_usd, now = Date.now() }) {
    const state = this._load();
    B.settle(state, { id, seconds, cost_usd, now });
    B.expireReservations(state, now);
    this._save(state);
    return { spent_usd: state.spent_usd, remaining_usd: B.remaining(state, budget_usd, now) };
  }

  /** Release the reservation, charge nothing. */
  release({ id }) {
    this.sql.exec('DELETE FROM reservations WHERE id = ?', id);
    return { ok: true };
  }

  usage({ now = Date.now() } = {}) {
    const state = B.expireReservations(this._load(), now);
    return {
      spent_usd: state.spent_usd,
      reserved_usd: B.reservedTotal(state, now),
      requests: state.requests,
      seconds: state.seconds,
      last_used: state.last_used,
    };
  }

  /** Zero spend, counters and reservations (for test deployments). */
  reset() {
    this.sql.exec('UPDATE usage SET spent_usd = 0, requests = 0, seconds = 0, last_used = NULL WHERE id = 1');
    this.sql.exec('DELETE FROM reservations');
    this.hits.clear();
    return { ok: true };
  }
}
