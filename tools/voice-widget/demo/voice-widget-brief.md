# Voice widget: a brief for rebuilding it

This describes a microphone button for text boxes on web pages, built for open-ended survey answers. It covers the behaviour and the decisions behind it, so you can rebuild it for your own setup. The original is one browser script (about 550 lines, no dependencies), a Cloudflare Worker relay (about 450 lines including its budget store), a Qualtrics paste-in snippet and a small command-line tool. The code is published beside this brief.

## The problem

Open-ended survey questions get short answers, because typing a long answer is tiring, especially on a phone. People will often say far more than they'd type. Voice typing built into phones and browsers varies by device, sends audio to whichever company makes the keyboard or browser, and can't be described in a consent form. A survey team needs one tool that behaves the same for every respondent, whose data handling they can state exactly, and whose cost has a hard ceiling.

## What it does

1. A "Speak your answer" button sits under (or beside) a text box.
2. The respondent presses it, talks for up to 3 minutes, and presses Stop. In the last 20 seconds a countdown shows, so they can finish their sentence. They can cancel instead, and then nothing is sent.
3. The clip goes to a relay, which checks the page is allowed to use it and the survey has budget left, then sends the clip to Groq's Whisper model (`whisper-large-v3-turbo`).
4. The text comes back in a second or two and is added to the box at the cursor. The respondent can edit it like anything they typed, speak again to add more, or just type.
5. When a survey's budget is used up, every button for that survey switches off and says so. Typing still works.

## Components

1. **Page script** (`voice-widget.js`). One script tag adds a button to each `textarea[data-voice]` or `input[data-voice]`, including boxes added later. Or call `VoiceWidget.attach(element, options)`. It records with MediaRecorder (Opus in WebM, or MP4 on Safari), shows a timer and a level bar, posts the clip to the relay, and inserts the text. The button lives in its own Shadow DOM, so the host page's styles can't break it and its styles can't leak out.
2. **Relay** (a Cloudflare Worker). `POST /v1/transcribe?d=<deployment>` with the raw audio as the body returns `{text, seconds, cost_usd, remaining_usd}`. `GET /v1/status?d=<deployment>` says whether the button should show. `GET /admin/usage` (behind a bearer token) reports spend. It holds the Groq key, and serves the page script and a demo page as static files.
3. **Budget store**: a Durable Object per deployment, with SQLite storage. It keeps spend, reservations, request counts and a per-visitor rate limit.
4. **Deployment list** (`deployments.json`, bundled at deploy time). Each deployment has a budget in US dollars, an on/off switch, the exact sites allowed to use it, a maximum clip length, a per-visitor rate limit, an optional word list for Whisper, and a notice shown under the button.
5. **Qualtrics snippet.** Paste-in question JavaScript that loads the script once per page and attaches it to the question's text box. It also records `voice_used = 1` in embedded data when voice was used.
6. **`vw` command.** List, add and edit deployments, check spend, and deploy (dry run by default).

## Decisions worth keeping

1. **The API key never reaches the browser.** Anything in a page can be read by anyone. A relay holds the key and decides who may spend it.
2. **One key, many budgets.** Each survey or site is a named deployment with its own dollar cap. One survey's traffic can't spend another's money, and closing one deployment doesn't affect the rest.
3. **Reserve before you spend, settle after.** Before calling Whisper, the relay reserves the cost of a maximum-length clip, and refuses if spend plus reservations plus this one would pass the budget. After Whisper replies, it swaps the reservation for the real cost, using the audio length Groq reports (`verbose_json` gives `duration`). Groq bills at least 10 seconds per request, so the cost model does too. A failed call releases its reservation. Reservations older than 5 minutes count as released, in case a request dies halfway. This needs a store that is strongly consistent and handles one request at a time per deployment (a Durable Object). An eventually consistent key-value store lets two simultaneous requests both pass the check and overspend.
4. **Allowed sites per deployment.** The relay answers only pages whose origin (`https://host`, no path) is on that deployment's list, and sends cross-origin headers for those sites only. Browsers always send `Origin` on a POST. On a same-site GET they leave it out, so `Sec-Fetch-Site: same-origin` stands in for it. This stops other websites using your budget. It doesn't stop a determined script, which can fake headers. The per-visitor rate limit, the clip-length cap and the budget ceiling bound the damage. Add a bot check (such as Cloudflare Turnstile) if a deployment sits on a busy public page.
5. **Store nothing.** The relay holds audio in memory for one request and logs only the deployment, size, length, cost and status, never the text. Turn on Zero Data Retention with the speech provider, so the whole chain can be described in one sentence of a consent form.
6. **Speech is a draft.** Text is inserted at the cursor (or appended with a space), never replaces what's there, and the person edits before submitting. Typing always works. Every error says in plain words what to do next.
7. **Write the value the way frameworks expect.** Set it through the input's native value setter, then fire bubbling `input` and `change` events. A plain `el.value = …` is undone by React-style controlled inputs. Survey platforms may not register it either.
8. **One recording at a time per page.** Starting a second button stops the first. Its text still lands in its own box.
9. **Styling from the page, not inside it.** Colours come from CSS custom properties (`--vw-accent`, `--vw-radius`, …), which pass into the Shadow DOM. `::part()` names (`button`, `message`, `notice`, `cancel`, …) allow finer changes. Options cover an outline style, icon only, a cancel button, a fixed light or dark scheme, and quieter messages. The font follows the page.
10. **Qualtrics specifics.** Inject from the question's JavaScript rather than pasting HTML: the rich-content editor strips attributes. Use `this.getQuestionContainer()` and plain JavaScript, because the newer survey layout has no jQuery. Preview and the live link run on different hosts. Allow both.
11. **A word list is optional and short.** Whisper's `prompt` (224 tokens at most) nudges the spelling of jargon. Skip it for clips under 2 seconds, where Whisper tends to repeat it back.

## What you need

- A Cloudflare account. Workers and SQLite-backed Durable Objects run on the free plan. Deploy with Wrangler 4. The tests run on Node 22.
- A Groq API key, stored as the Worker secret `GROQ_API_KEY`, with Zero Data Retention turned on. Plus a random `ADMIN_TOKEN` for the usage endpoint.
- Cost: Groq charges about US$0.04 per hour of audio, so a one-minute answer costs well under a tenth of a cent. A hundred people giving five one-minute answers each costs about US$0.35.
- An HTTPS page, because browsers only allow the microphone on secure pages. For Qualtrics, an account that's allowed to add JavaScript to questions.
- Tested mainly in desktop Chrome, plus simulated microphones in automated tests. Check Safari, iPhones and Android with your own audience before relying on it.

## Reference code

The published code is the reference implementation: [voice-widget on GitHub](https://github.com/aksaeri/ai-tools-public/tree/main/tools/voice-widget/code). The page script and the relay source are byte for byte what runs at voice.aksaeri.com. Start from them and change what your setup needs. Where to look:

- `relay/src/budget.js` and `relay/src/deployment-do.js`: the budget store. These hold the cost model (10-second minimum), reserving a maximum-length clip before the call and settling with Groq's reported duration, the 5-minute expiry for stale reservations, and the per-visitor rate limit, all in one Durable Object per deployment.
- `relay/src/index.js`, `corsFor()` and the route handler: the allowed-sites check. It covers the exact-origin match, cross-origin headers only for listed sites, and `Sec-Fetch-Site: same-origin` standing in for the missing `Origin` on same-site GETs.
- `relay/src/index.js`, the transcribe route: how audio reaches Groq. The raw body is checked for size and length, sent as one multipart request to `whisper-large-v3-turbo` (`language=en`, `verbose_json`, the deployment's word list only for clips of 2 seconds or more), and held only in memory. Logs carry no text.
- `package/voice-widget.js`: the page script. It covers the Shadow DOM button, recording, insertion through the native value setter, plain-language errors, and the options described in `package/README.md`.
- `qualtrics/question-groq.js`: the Qualtrics snippet. It loads the script once per page, attaches to the question's text box through `this.getQuestionContainer()` with no jQuery, and sets embedded data `voice_used`.
- `tools/vw`: the command-line tool. Each deployment is a block in `relay/deployments.json`, and `vw` edits them, warns when a word list is too long for Whisper's prompt, reads spend from `/admin/usage`, and deploys (dry run by default).
