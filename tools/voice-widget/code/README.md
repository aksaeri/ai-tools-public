# voice-widget: the code

A microphone button for any text box on a web page. People talk, the recording goes through a
small relay to Groq's Whisper model, and the text lands in the box for them to check and edit.
It was built for open-ended survey questions in Qualtrics. This is the code behind
https://tools.aksaeri.com/tools/voice-widget/, published so you can see exactly what it does with
people's audio, and build your own.

## What's here

| Folder | What it is |
|---|---|
| `package/voice-widget.js` | The script that runs on the page. It adds the button, records with the browser's microphone, sends the clip to the relay, and puts the text in the box. One file, no dependencies. Options and styling: `package/README.md`. |
| `qualtrics/` | `question-groq.js`, the code you paste into a Qualtrics question, and setup steps. |
| `relay/` | A Cloudflare Worker. It holds the Groq key, checks each request comes from an allowed site, keeps a budget per deployment in a Durable Object, and returns the text. `deployments.json` lists the deployments (this copy has placeholder sites). Tests: `node --test relay/test/`. |
| `tools/vw` | A small command-line tool: list and edit deployments, check spending, deploy. |
| `docs/specs/` | The original design spec: the relay's API, the budget rules, and the script's behaviour. Later options are in `package/README.md`. |

## What's running at voice.aksaeri.com

- `package/voice-widget.js` is byte for byte the script served at
  https://voice.aksaeri.com/v1/voice-widget.js. Its SHA-256 is `6c04889117c6f2a38352e6f906dc8a19fa5b07308707bbe7934aaf5c26242ea8`.
  Check it yourself: `curl -s https://voice.aksaeri.com/v1/voice-widget.js | sha256sum`.
- `relay/src/` is the source of the Cloudflare Worker behind it, which transcribes with Groq's
  `whisper-large-v3-turbo` model. Nobody outside can download a Worker's deployed code, so this
  part can't be checked the same way. If you need certainty, deploy your own copy.
- The Groq account the relay uses has Zero Data Retention turned on.
- Only the live list of deployments (`relay/deployments.json`: each survey's budget and allowed
  sites) is replaced here by an example.

## What happens to the audio

1. The browser records only between the person pressing the button and pressing Stop (90 seconds at most).
2. The clip is sent to the relay. The relay checks the page's site is on the deployment's list, the deployment has budget left, and the person isn't sending too often.
3. The relay forwards the clip to Groq (`whisper-large-v3-turbo`) and returns the text. It keeps the audio in memory only for that request and never writes it or the text anywhere. Its logs hold only the deployment name, size, length, cost and status.
4. Turn on Zero Data Retention in your Groq account so Groq doesn't keep it either.

## Set up your own

1. A Cloudflare account and a Groq API key. Copy `.env.example` to `.env` and fill it in.
2. Edit `relay/deployments.json`: one entry per survey or site, each with a budget in US dollars and the exact sites (`https://host`) allowed to use it.
3. Change the route in `relay/wrangler.toml` (`voice.aksaeri.com`) to your own domain.
4. `relay/deploy.sh --yes` to deploy, then `relay/deploy.sh secrets --yes` to store the keys.
5. Put the script tag on your page, or paste `qualtrics/question-groq.js` into a Qualtrics question, pointing `SCRIPT_URL` at your relay instead of voice.aksaeri.com.

Cost: Groq charges about US$0.04 per hour of audio, with a 10-second minimum per request, so a
one-minute answer costs well under a tenth of a cent.

MIT licence (see the repository root).
