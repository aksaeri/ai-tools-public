// Test fakes: a SQLite-backed DO storage (node:sqlite) shaped like ctx.storage.sql,
// a DEPLOYMENTS namespace that hands out real DeploymentDO instances, and a fetch mock.
// No tests in this file.
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register('./cf-loader.js', import.meta.url);

export function fakeSql() {
  const db = new DatabaseSync(':memory:');
  return {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      const rows = /^\s*(SELECT|PRAGMA)/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
      return { toArray: () => rows.map((r) => ({ ...r })), one: () => rows[0] };
    },
  };
}

export async function fakeNamespace() {
  const { DeploymentDO } = await import('../../src/deployment-do.js');
  const instances = new Map();
  return {
    instances,
    idFromName: (name) => ({ name }),
    get(id) {
      if (!instances.has(id.name)) {
        instances.set(id.name, new DeploymentDO({ storage: { sql: fakeSql() } }, {}));
      }
      const inst = instances.get(id.name);
      // Mimic RPC: methods return promises and arguments are structured-cloned.
      return new Proxy({}, {
        get: (_, prop) => async (...args) => inst[prop](...args.map((a) => structuredClone(a))),
      });
    },
  };
}

export function fakeAssets() {
  return { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, { status: 200 }) };
}

/** Replace globalThis.fetch for Groq calls. `responder(url, init)` returns a Response or throws. */
export function mockFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
