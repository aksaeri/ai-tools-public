// Find a Chrome, start it headless, and talk to it over the DevTools protocol.
// No dependencies: Node 22's built-in WebSocket is the client.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Google Chrome first: unlike plain Chromium it can decode H.264, which the
// video models return. CHROME_PATH overrides.
export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [];
  if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
      for (const n of names) candidates.push(path.join(dir, n));
    }
  }
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new Error(
    "No Chrome found. Install Google Chrome, or set CHROME_PATH to a Chrome or Chromium binary."
  );
}

class Session {
  constructor(browser, sessionId) {
    this.browser = browser;
    this.sessionId = sessionId;
  }
  send(method, params = {}) {
    return this.browser.send(method, params, this.sessionId);
  }
  // Evaluate an expression in the page; awaits promises; returns the value.
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`Page error: ${d.exception?.description || d.text}`);
    }
    return r.result.value;
  }
  once(method) {
    return new Promise((resolve) => {
      const key = `${this.sessionId}:${method}`;
      (this.browser.waiters.get(key) || this.browser.waiters.set(key, []).get(key)).push(resolve);
    });
  }
}

export class Browser {
  static async launch({ width, height }) {
    const b = new Browser();
    b.userDir = fs.mkdtempSync(path.join(os.tmpdir(), "genvideo-chrome-"));
    const args = [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${b.userDir}`,
      `--window-size=${width},${height}`, "--force-device-scale-factor=1", "--hide-scrollbars",
      "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--font-render-hinting=none",
      "--force-color-profile=srgb", "about:blank",
    ];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    b.proc = spawn(findChrome(), args, { stdio: ["ignore", "ignore", "pipe"] });
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("Chrome did not start within 30 s")), 30_000);
      b.proc.stderr.on("data", (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      b.proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (code ${code}): ${buf.slice(-400)}`)); });
    });
    b.ws = new WebSocket(wsUrl);
    b.nextId = 0;
    b.pending = new Map();
    b.waiters = new Map();
    b.consoleErrors = [];
    await new Promise((resolve, reject) => { b.ws.onopen = resolve; b.ws.onerror = () => reject(new Error("Could not connect to Chrome")); });
    b.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = b.pending.get(msg.id);
        if (!p) return;
        b.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        b.consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
      }
      const list = b.waiters.get(`${msg.sessionId}:${msg.method}`);
      if (list?.length) for (const resolve of list.splice(0)) resolve(msg.params);
    };
    return b;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async newPage({ width, height }) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Session(this, sessionId);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  async close() {
    const exited = new Promise((r) => {
      if (this.proc.exitCode !== null) return r();
      this.proc.once("exit", r);
    });
    const wait = (ms) => { let t; return Promise.race([exited, new Promise((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t)); };
    // Ask Chrome to quit, so its helper processes stop writing to the profile.
    try { this.send("Browser.close").catch(() => {}); } catch { /* socket already gone */ }
    await wait(5000);
    if (this.proc.exitCode === null) { this.proc.kill("SIGKILL"); await wait(2000); }
    try { this.ws.close(); } catch { /* already closed */ }
    for (const p of this.pending.values()) p.reject(new Error("Chrome closed"));
    this.pending.clear();
    try {
      fs.rmSync(this.userDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch { /* a leftover temp profile is harmless */ }
  }
}
