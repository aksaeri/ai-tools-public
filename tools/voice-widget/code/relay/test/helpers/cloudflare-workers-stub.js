// Stand-in for `cloudflare:workers` under Node. No tests in this file.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
