// Entry point so `node --test relay/test/` works on Node 22, which treats a
// directory argument as a module path (it runs this file). Loads every *.test.js here.
import { readdirSync } from 'node:fs';

const here = new URL('./', import.meta.url);
for (const f of readdirSync(here).filter((n) => n.endsWith('.test.js')).sort()) {
  await import(new URL(f, here).href);
}
