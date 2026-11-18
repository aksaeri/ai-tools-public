// Pure budget logic for the voice-widget relay. No Cloudflare APIs here, so
// everything is unit-testable with `node --test`.
//
// State object (one per deployment, persisted by DeploymentDO):
//   { spent_usd, requests, seconds, last_used, reservations: { [id]: { amount, at } } }
// Times are epoch milliseconds.

export const PRICE_PER_HOUR_USD = 0.04;      // Groq whisper-large-v3-turbo
export const MIN_BILLED_SECONDS = 10;        // Groq bills at least 10 s per request
export const RESERVATION_TTL_MS = 5 * 60 * 1000;
export const RATE_WINDOW_MS = 60 * 1000;
const EPS = 1e-12;

/** Price per hour, honouring an env override (string or number). */
export function pricePerHour(env) {
  const v = env && env.PRICE_PER_HOUR_USD;
  if (v === undefined || v === null || v === '') return PRICE_PER_HOUR_USD;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : PRICE_PER_HOUR_USD;
}

/** cost(seconds) = max(10, seconds) × price / 3600 */
export function cost(seconds, perHour = PRICE_PER_HOUR_USD) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return (Math.max(MIN_BILLED_SECONDS, s) * perHour) / 3600;
}

export function emptyState() {
  return { spent_usd: 0, requests: 0, seconds: 0, last_used: null, reservations: {} };
}

/** Drop reservations older than the TTL (crash safety). Mutates and returns state. */
export function expireReservations(state, now, ttl = RESERVATION_TTL_MS) {
  for (const [id, r] of Object.entries(state.reservations)) {
    if (now - r.at >= ttl) delete state.reservations[id];
  }
  return state;
}

export function reservedTotal(state, now, ttl = RESERVATION_TTL_MS) {
  let sum = 0;
  for (const r of Object.values(state.reservations)) {
    if (now - r.at < ttl) sum += r.amount;
  }
  return sum;
}

export function remaining(state, budget, now) {
  return Math.max(0, budget - state.spent_usd - reservedTotal(state, now));
}

/**
 * Try to reserve `amount` against `budget`. Refuses if spent + reserved + amount > budget.
 * Mutates state on success. Returns { ok: true, remaining_usd } or { ok: false }.
 */
export function reserve(state, { id, amount, budget, now }) {
  expireReservations(state, now);
  const used = state.spent_usd + reservedTotal(state, now);
  if (used + amount > budget + EPS) return { ok: false };
  state.reservations[id] = { amount, at: now };
  return { ok: true, remaining_usd: remaining(state, budget, now) };
}

/** Release a reservation without charging anything (upstream failure). */
export function release(state, id) {
  delete state.reservations[id];
  return state;
}

/** Release the reservation and add the actual cost and usage counters. */
export function settle(state, { id, seconds, cost_usd, now }) {
  delete state.reservations[id];
  state.spent_usd += cost_usd;
  state.requests += 1;
  state.seconds += Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  state.last_used = now;
  return state;
}

/** True if a full-length clip could still be reserved. */
export function available(state, { budget, max_seconds, active, now, perHour = PRICE_PER_HOUR_USD }) {
  if (!active) return false;
  return remaining(state, budget, now) + EPS >= cost(max_seconds, perHour);
}

/**
 * Sliding-window rate limit. `hits` is an array of timestamps for one key.
 * Returns { ok, hits (pruned, with this hit added if ok), retry_after_s }.
 */
export function rateCheck(hits, { limit, now, windowMs = RATE_WINDOW_MS }) {
  const recent = (hits || []).filter((t) => now - t < windowMs);
  if (!(limit > 0)) return { ok: true, hits: recent, retry_after_s: 0 };
  if (recent.length >= limit) {
    const oldest = Math.min(...recent);
    const wait = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, hits: recent, retry_after_s: wait };
  }
  recent.push(now);
  return { ok: true, hits: recent, retry_after_s: 0 };
}
