// Node module hook: resolve the `cloudflare:workers` specifier to a local stub
// so src/ can be imported under `node --test`. No tests in this file.
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') {
    return { url: new URL('./cloudflare-workers-stub.js', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
