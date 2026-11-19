# voice-widget v1: hosted relay with budgets + embeddable script

Status: a dated record of the original v1 design (2026-11-06), kept as written. Values here may be
out of date (for example, recordings now stop at 3 minutes, not 90 s). For current behaviour, defaults
and options added later (styling, icon-only, cancel button, state API), see package/README.md.

## Intent
A mic button that attaches to any text box on any site and fills it with transcribed speech.
Transcription runs on Groq Whisper through a relay that holds the key. One Groq key serves many
named **deployments**, each with its own budget, allowed sites and word list. When a deployment
reaches its budget, it is cut off and the others keep working.

Built for adding voice answers to research surveys (for example a `my-survey` deployment with
$2). Respondents dictate 10–60 s answers about their expertise.

## Goals / non-goals / anti-goals
- Goals: one `<script>` tag (or one Qualtrics JS call) adds a working mic button; per-deployment
  hard budget cut-off; deployments added by editing one file + one deploy; spend visible from a CLI.
- Non-goals (v1): Turnstile, user accounts, on-device models in the script package (the iframe
  widget in `static/` stays for that), storing audio or transcripts anywhere.
- Anti-goals: the Groq key reaching a browser; a deployment overspending its budget by more than
  one clip; the relay logging transcript text; the widget breaking the host page's layout or
  styles.

## Layout
```
relay/                     Cloudflare Worker "voice-widget"
  wrangler.toml            custom domain voice.aksaeri.com; static assets from relay/public; DO binding
  src/index.js             routes
  src/budget.js            pure logic: cost, reserve/settle, rate limit (unit-tested with node --test)
  src/deployment-do.js     Durable Object (SQLite-backed) "DeploymentDO", one instance per deployment
  deployments.json         the deployment list (bundled into the Worker at deploy time)
  public/                  static assets served by the Worker (demo page + built package copy)
  test/*.test.js           node --test
  deploy.sh                --dry-run default; copies package into public/v1/, runs wrangler deploy
package/
  voice-widget.js          the embeddable script (single file, no build, no deps)
  README.md                embed instructions
qualtrics/question-groq.js paste-in snippet using the package
tools/vw                   python3 CLI (stdlib): add/edit deployment, usage, push secrets, deploy
```

## deployments.json
```json
{
  "deployments": {
    "demo": {
      "budget_usd": 0.50, "active": true,
      "allowed_origins": ["https://voice.aksaeri.com"],
      "max_seconds": 90, "rate_per_ip_per_min": 4,
      "prompt": "",
      "notice": "Your voice is sent to Groq to turn it into text. Nothing is stored."
    },
    "my-survey": {
      "budget_usd": 2.00, "active": true,
      "allowed_origins": ["https://yourorg.qualtrics.com"],
      "max_seconds": 90, "rate_per_ip_per_min": 6,
      "prompt": "", "notice": "..."
    },
    "dev": { "budget_usd": 0.25, "active": true,
      "allowed_origins": ["http://localhost:8787"],
      "max_seconds": 90, "rate_per_ip_per_min": 20, "prompt": "", "notice": "" }
  }
}
```
- `allowed_origins` entries are exact origins; `"*"` allowed only if explicitly written.
- `prompt` is passed to Groq as `prompt` (max 224 tokens). `vw` warns when the estimated token count
  (ceil(chars / 3.5)) exceeds 200. Prompt is NOT sent for clips under 2 s.
- Changing budget: edit + deploy. Spend persists in the DO across deploys. Raising the budget
  re-opens a cut-off deployment; `active:false` closes it immediately.

## Cost model (Groq whisper-large-v3-turbo)
- $0.04 per audio hour = $0.04/3600 per second. Groq bills a minimum of 10 s per request.
- cost(seconds) = max(10, seconds) × 0.04 / 3600. Price constant lives in `budget.js` (`PRICE_PER_HOUR_USD`), overridable by env var `PRICE_PER_HOUR_USD`.
- Before calling Groq: **reserve** cost(max_seconds) in the DO (atomic; refuse if spent + reserved + this > budget).
  After Groq replies: **settle** with actual `duration` from Groq's `verbose_json` response (release the reservation, add the actual). On Groq failure: release the reservation, add nothing.
  Reservations older than 5 min are treated as released (crash safety).
- Overspend bound: at most one clip's actual cost (budget checks use the max-length reservation, so in practice no overspend).

## Relay HTTP API (Worker, origin https://voice.aksaeri.com)
- `POST /v1/transcribe?d=<deployment>` body = raw audio (webm/ogg/mp4/wav, ≤ 15 MB), `Content-Type` = audio MIME,
  optional header `X-Audio-Seconds` (client's measured length; used only to reject over-length early).
  - CORS: respond with `Access-Control-Allow-Origin: <origin>` only if origin ∈ allowed_origins; handle `OPTIONS` preflight
    (allow `Content-Type, X-Audio-Seconds`, methods `POST, OPTIONS`, max-age 600). `Vary: Origin`.
  - Errors (JSON `{error: code, message}`; message is plain respondent-safe English):
    `unknown_deployment` 404 · `origin_not_allowed` 403 · `inactive` 403 · `budget_exhausted` 402 ·
    `rate_limited` 429 (with `Retry-After`) · `too_long` 413 · `empty` 400 · `upstream_error` 502.
  - 200 → `{text, seconds, cost_usd, remaining_usd}`. (remaining is fine to expose; it's a cap, not a secret.)
  - Groq call: `whisper-large-v3-turbo`, `language=en`, `response_format=verbose_json`, `temperature=0`, `prompt` per deployment.
- `GET /v1/status?d=<deployment>` → `{active, available: bool}` (no money figures; for the widget to hide the button when cut off). Same CORS rule.
- `GET /admin/usage` (header `Authorization: Bearer <ADMIN_TOKEN>`) → per deployment `{budget_usd, spent_usd, reserved_usd, requests, seconds, last_used, active}`.
- `POST /admin/reset?d=<name>` (Bearer) → zero the spend (for test deployments).
- Everything else → static assets from `public/` (demo page at `/`, package at `/v1/voice-widget.js`).
- Logging: deployment, status code, seconds, cost. Never transcript text, never audio.
- Rate limit: per (deployment, client IP from `CF-Connecting-IP`), in-DO sliding window of 60 s.
- Secrets: `GROQ_API_KEY`, `ADMIN_TOKEN` (wrangler secrets). Nothing secret in git.

## Package: `voice-widget.js`
Embed:
```html
<script src="https://voice.aksaeri.com/v1/voice-widget.js" data-deployment="demo" defer></script>
<textarea data-voice></textarea>
```
- Auto-attaches to `textarea[data-voice], input[data-voice]` (and, if `data-target="<css selector>"` is on the
  script tag, to matching elements). Watches for elements added later (MutationObserver, debounced).
- Manual API: `window.VoiceWidget.attach(element, {deployment, endpoint, position, lang, onTranscript}) → handle {detach()}`.
- `endpoint` default = origin of the script's own URL (`document.currentScript.src`), so a copy served by
  a local dev server talks to its own relay. Override with `data-endpoint`.
- UI: a small mic button in a Shadow DOM host placed right after the target element (doesn't overlay the
  text). States: idle → recording (timer, level bar, stop) → sending ("Turning speech into text…") → idle.
  Auto-stop at deployment max (90 s default). One short notice line under the button
  (deployment `notice` is NOT fetched from the server in v1; pass `data-notice` or default text).
  Errors shown in plain words; the text box always stays usable for typing.
- Text insertion: insert at the caret if the element is focused, else append (with a space if needed).
  Set value through the native prototype setter (works with React/Vue), then dispatch `input` and `change` (bubbling).
- Recording: getUserMedia mono with echoCancellation/noiseSuppression; MediaRecorder `audio/webm;codecs=opus`
  else `audio/mp4` (Safari). Sends `X-Audio-Seconds`.
- On load calls `/v1/status`; if `available:false`, the button is hidden (or disabled with "Voice typing is not available right now").
- Accessibility: ≥44 px target, aria-label, aria-live status, keyboard operable, focus ring, respects
  prefers-color-scheme / prefers-reduced-motion. Styles isolated in Shadow DOM; host element `all: initial`.
- Size budget: ≤ 25 KB unminified. No dependencies.

## Qualtrics snippet (`qualtrics/question-groq.js`)
In `addOnload`: load the script once per page (guard on `window.VoiceWidget`), find the question's
textarea via `this.getQuestionContainer()`, `VoiceWidget.attach(textarea, {deployment:'my-survey', onTranscript})`;
`onTranscript` also calls `Qualtrics.SurveyEngine.setJSEmbeddedData('voice_used', '1')`. Works without jQuery (NSTE).
Here the browser's origin is the Qualtrics host, so it must be in `allowed_origins`.

## Left to the builder
Internal structure, UI details within the rules above, test design.
