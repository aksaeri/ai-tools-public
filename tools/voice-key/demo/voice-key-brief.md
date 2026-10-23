# Voice Key: a brief for rebuilding it

This describes a personal voice-dictation system so it can be rebuilt from scratch to suit a different setup. It describes behaviour and decisions, not code. Where a number is given (timeouts, clip counts, sample rates), it is the value the original uses; treat it as a sensible default, not a requirement.

## What it does

You tap a mic (Android) or press a hotkey (Windows), speak, and stop. The audio is transcribed by Whisper, cleaned up by a small language model (punctuation, paragraphs and filler removal, never rewording), and the text lands where you were typing: typed into the focused field on Android, or put on the clipboard on Windows.

## What you need

- **A server** that is always on and that your phone and computer can reach privately (a VPN or a mesh network), running Node 20 or later.
- **A Groq API key.** Groq runs both models. Only the server holds the key.
- **Android 13 or later** for the floating mic, installed from outside the Play Store. Android asks you to "Allow restricted settings" before an accessibility service can be turned on, and Play Protect's app scanning may need to be off while you install.
- **Windows 10 or 11 with Python 3.10 or later** for the tray app.
- **Any modern browser** for the optional web page, served over HTTPS so the browser allows the microphone.

## Components

1. **Transcription server** (the original is about 370 lines of Node/Express, listening on 127.0.0.1). Endpoints: `POST /transcribe`, `GET /healthz` (server liveness only; Groq is not checked). It holds the Groq API key, saves the audio and a JSON record per dictation, and calls Groq at least twice. **It has no authentication**: it is reachable only over a private network, behind a reverse proxy that maps a path prefix to it and strips the prefix. Clients are configured with a base URL and call `<base>/transcribe`. Add authentication before exposing anything like this publicly.
2. **Android floating mic** (an AccessibilityService, Android 13+). A small disc beside any other keyboard (Gboard, say). It types into the focused field through the accessibility input connection (`FLAG_INPUT_METHOD_EDITOR`, `InputMethod.AccessibilityInputConnection.commitText`). An earlier version replaced the keyboard entirely; that was retired because a mic beside the user's own keyboard does the job better.
3. **Windows tray app** (Python: sounddevice, soundfile, pystray, pywin32, tkinter).
   - **Hotkey and icon.** A global hotkey `Ctrl+Shift+;` (RegisterHotKey) toggles start and stop. The tray icon shows the state: grey ready, red recording, amber sending, a slash when the server is unreachable, a red badge when clips are queued.
   - **Recording window.** A small strip at the bottom centre of the screen, shown only while recording or sending: a calm five-segment level meter, the time so far, and in the last 30 seconds the time left in amber, then "Sending…". It must never take keyboard focus, because you paste into the app you were dictating into, so it is shown and hidden through Win32 with no-activate flags rather than through the GUI toolkit.
   - **Sounds.** Recording started, recording stopped, one chime when the final text is on the clipboard, and short beeps at 15, 10 and 5 seconds before the safety stop. A notification previews the text.
   - **Settings** live in `%APPDATA%\voice-key-win\config.json`: endpoint, hotkey, device name (stored by name, since device indices renumber), sounds, notifications, recording window, max recording seconds (600), health poll seconds (30), request timeout seconds (120), queue max attempts (10), and the clipboard gap (0.3 s). When a default changes in a new version, a saved value equal to the old default moves to the new one, because the file holds every key and would otherwise pin the old value forever.
   - **Tray menu:** the status line, Microphone, Retry N queued, Open log, Open config, the Sounds, Notifications and Recording window toggles, and Quit.
4. **Browser page** (optional). Records with MediaRecorder, shows the cleaned text with the raw text expandable, and copies it.

Android Settings (shared preferences): server base URL, cleanup on/off (off sends `raw=1`), microphone choice (applied with `setPreferredDevice`), floating mic on/off, and the floating mic's docked edge and height. Settings also shows the recent-dictations list, stored in `filesDir/dictations.tsv` (last 10, survives restarts), and a status log in `filesDir/status-log.tsv` (last 50, with full error detail). Held text lives only in memory and is lost if the app process restarts.

## The request

```
POST /transcribe[?raw=1]
Content-Type: audio/mp4 | audio/flac | audio/webm | audio/ogg
X-Device-Info: <URL-encoded JSON, e.g. {"label":"phone mic"}>
body: raw audio bytes (limit 50 MB)

200 → { "id", "raw", "cleaned", "fmt", "bytes", "stt_s", "cleanup_s", "cleanup_warning" }
error → { "error": "<message>" } with the upstream HTTP status (400 for an empty body)
GET /healthz → { "ok": true }
```

- `raw=1` skips cleanup; `cleaned` then equals `raw`.
- The client uses `cleaned`, falling back to `raw`.
- `fmt=1` asks for spoken formatting ("comma", "new paragraph" said aloud). The original has it switched off on the server, and ignores the flag, because its user never dictated punctuation and the feature cost more than it gave (see "Spoken formatting, and why it's off").

## Audio flow

1. **Record.**
   - Android: MediaRecorder, MPEG-4/AAC, 16 kHz, mono, 48 kbps, to `cacheDir/clip-<epoch ms>.m4a`. The accessibility service must use the `VOICE_RECOGNITION` source, the only one Android lets an accessibility service capture. Statuses shown: "Nothing recorded" (under 1000 bytes), "Recording too short" (MediaRecorder stop failed), and a retry prompt for any failed send.
   - Windows: 16 kHz mono int16 in memory, encoded to FLAC in memory (lossless, and faster end to end than WAV).
   - Safety stop: 5 minutes on Android, where the timer turns amber in the last 30 seconds; 10 minutes on Windows, with the warning beeps and the countdown in the recording window.
2. **Send.** One POST with the audio as the body. Android timeouts: 10 s to connect, 120 s to read.
3. **Server saves first.** It mints an id (`<ISO timestamp to the second>_<6 random chars>`) and writes `recordings/<id>.<ext>` before calling anything that can fail.
4. **Speech to text.** Groq `/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo`, `language=en`, no prompt.
5. **Tidy up later, never on success.**
   - Android prunes when the next recording starts. It keeps the newest 2 clips, any clip armed for retry, and the newest 5 failed clips in the history.
   - Windows writes a clip to disk only if the send fails (`%APPDATA%\voice-key-win\queue\<stamp>.flac` plus a `.json` with attempts and the last error). It deletes the clip only after the cleaned text reaches the clipboard.
   - The server keeps audio and JSON for N days (the original keeps everything, as a test set for prompt changes).

## Text flow

1. **Whisper returns raw text.**
2. **Near-silence check.** If the whole transcript, ignoring case and punctuation, is empty punctuation, "you", "thank you", "thanks for watching" or "thank you for watching", return empty raw and cleaned, so the client takes its "nothing heard" path. These are what Whisper writes for an accidental tap or a silent clip: 15 of 656 clips in the original, none of them real speech. Match the whole transcript only ("Thank you, Sam." is dictation). Groq's `no_speech_prob` was 0 for all of them, and loudness overlapped real one-word dictations, so the text is the only usable signal. Keep what Whisper said in the JSON record.
3. **Cleanup.** Groq `/openai/v1/chat/completions`, model `openai/gpt-oss-20b`, `reasoning_effort: "low"`, temperature 0.2, `max_completion_tokens: 8192`, with the prompt below as a single user message.
   - **Effort.** At the model's default effort it rewrote instead of cleaning.
   - **Room to think.** gpt-oss reasons before it answers, and on Groq's default cap of 2,048 tokens the reasoning sometimes used up the whole allowance. The answer then came back empty, or cut off mid-sentence after about 1,700 words. A typical dictation uses about 400 tokens.
   - **Paragraphs are decided by length, not by the model.** Under 150 words (about a minute of speech) the prompt asks for one paragraph. At 150 or more it asks for breaks where the topic changes, in paragraphs of about 80–150 words. An earlier rule ("paragraph breaks where the speaker clearly paused") produced three different layouts for similar dictations, because the model sees text, not audio.
4. **Judge the answer, retry once, then fall back.**
   - **Unusable answers.** An answer is unusable if the model ran out of room (`finish_reason: "length"`), if it came back empty, or if it kept fewer than 60% of the words Whisper heard (on 40 or more words). The filler rule never took a test clip below 88%.
   - **Text inside the tags.** Take the text between `<cleaned>` tags. With no closing tag, strip any stray tag and use the rest.
   - **Retry, then raw.** If the answer is unusable, call once more. If that fails too, return Whisper's raw text as `cleaned`, with a warning. The user never gets nothing, or half of what they said.
5. **Tidy the layout in code.** Remove trailing spaces at line ends (the model sometimes uses Markdown's two-space line break). A dictation under 150 words becomes one paragraph. In a longer one, a lone line break becomes a space, and a paragraph under 40 words joins the next, so a paragraph per sentence cannot survive. Replace Unicode hyphens (U+2010, U+2011) with plain ones.
6. **Server records** `recordings/<id>.json` with: id, timestamp, content type, bytes, user agent, device label, raw, cleaned, fmt and whether the client asked for it, both model names, both timings, and any cleanup warning or near-silence drop. A failure records `error` and `http_status` instead.
7. **Deliver.**
   - Android: if the focused field is the same one that was focused when recording stopped, commit the text at the cursor. First add a space if the character before the cursor isn't whitespace. Track "same field" with an epoch counter that increments on every non-restarting `onStartInput` and on `onFinishInput`.
   - Windows: put raw on the clipboard, wait 300 ms, then put cleaned, and play the one "ready" chime. Skip raw if it's identical. The user pastes cleaned with Ctrl+V. Raw is meant to sit one step back in clipboard history (Win+V), which reads the clipboard a moment after each change, so a copy replaced too soon is never recorded. 150 ms was too short. Even at 300 ms the history doesn't always keep both, and the original's user decided that was fine. Never type into a window, and never touch the clipboard for an empty transcript.

## States and recovery

States: `IDLE → RECORDING` (tap) `→ TRANSCRIBING` (tap, or the safety stop) `→ IDLE` (reply, error or cancel). Taps during TRANSCRIBING are ignored; one dictation is in flight at a time.

Exits from TRANSCRIBING:
- **Delivered.** The text is typed in or on the clipboard.
- **Held.** The field changed, or no field is focused. Keep the text in a one-slot recovery and insert it on request into whatever field is focused then. The password check applies both at delivery (a password field drops the text) and at insert time (it won't insert into one).
- **Failed.** Keep the clip on disk and arm a retry. Retry reuses the same file.

Recovery handles:
- Floating mic: an amber outline. A tap always starts a new recording (so a tap never changes meaning). A long-press opens a menu: Insert held text / Retry failed send / Settings.
- Settings: a list of the last 10 dictations (sent, held, failed) with Copy, and Retry for failed clips.

Windows queue:
- Every failed send is queued.
- The queue drains oldest first: when the server becomes reachable again, every 5 minutes while entries exist, or from the tray menu.
- A drain stops on the first retryable failure (no status, ≥500, 408, 429).
- Other 4xx responses move the clip to `queue/failed/`.
- A clip waits for a manual retry after 10 attempts.

## Speed

Median server time per dictation in the original, from its own records (upload time is extra and not recorded):
- **Phone:** 0.55 s, made up of 0.20 s for Whisper and 0.33 s for cleanup. The typical phone dictation is about 40 words.
- **Windows:** 0.99 s. Windows dictations run longer, about 125 words; under 60 words it's 0.63 s.

Cleanup time grows with length, because the model reasons in proportion to how much there is to judge. The filler rule roughly doubled it on long clips, to about 2 s for 300 or more words. Groq is what makes this fast; a slower provider changes how the whole thing feels.

## Connection status

- `GET /healthz` with a 3 s timeout.
- Android checks on demand, not on a timer: when the mic appears and after a failed send. It caches a good result for 30 s and a failure for 5 s. A successful dictation counts as a good result.
- Windows does a 1 s preflight at recording start (it plays an error sound but keeps recording) and polls every 30 s.
- Display:
  - Floating mic outline: solid green when OK, red with a 60° gap at the bottom when unreachable, thin grey while checking.
  - Windows tray icon: a slash through it when unreachable.

## The floating mic (Android)

- **Visibility.** Show it only when all of these hold:
  - the floating mic is enabled;
  - a field is focused (the accessibility `InputMethod`'s `onStartInput`/`onFinishInput`);
  - it's not a password field;
  - a keyboard window is on screen (`getWindows()` contains `AccessibilityWindowInfo.TYPE_INPUT_METHOD`, which needs `canRetrieveWindowContent` plus `flagRetrieveInteractiveWindows`; re-check on `TYPE_WINDOWS_CHANGED`).

  Exception: keep it showing while recording or sending, so the user can always stop.
- **Look.**
  - A 46 dp dark disc with a white mic, docked to a screen edge and draggable (it snaps to the nearer edge).
  - While recording it grows inward into a 132 dp pill with an elapsed timer, a 2.25 s level waveform, and a red stop disc under the thumb.
  - While sending, the outline spins.
  - An overlay window of `TYPE_ACCESSIBILITY_OVERLAY`, never focusable (focus would dismiss the keyboard).
- **Statuses** show as toasts, since the disc has no text slot.

## Spoken formatting, and why it's off

The original once let you say "comma", "full stop" or "new paragraph" and get the mark. That needed two things: a prompt sent to Whisper telling it to write those words out rather than convert them, and a longer cleanup prompt that turned them into punctuation. Whisper treats its prompt as the transcript so far, not as instructions. In quiet audio it sometimes recited the prompt, and in noisy audio (dictating on a train) it filled hard-to-hear stretches with the prompt's own words, such as "you can also convert them into punctuation…". The server caught most recitals by looking for six of the prompt's words in a row and re-transcribing without the prompt, but shorter fragments got through. The user never dictated punctuation, so the feature was switched off. Whisper now gets no prompt, and the problem cannot occur. If you want spoken formatting, expect to build the recital check too.

## Rules worth keeping

1. Write the audio somewhere durable before any network call, and name each clip uniquely.
2. Return raw as well as cleaned; if cleanup fails, return raw alone.
3. Never lose a finished transcript: hold it if the field changed, keep or queue the clip if the send failed.
4. Never put dictated text into a password field.
5. Cleanup punctuates and removes filler; it never rewords, summarises or completes.
6. Don't send Whisper a prompt unless you need to: it can recite it into your text. Return nothing when the whole transcript is a stock near-silence phrase.
7. Give a reasoning model room to think, judge its answer, retry once, then fall back to the raw text.
8. Decide layout in code where you can: the model can't hear pauses.
9. Keep model names configurable: Groq has withdrawn models with a day's notice.
10. On Android, show the floating mic only while a keyboard is on screen. On Windows, never let the recording window take focus.

## Server or no server

The original routes every client through one server. That keeps one copy of the prompts and models, one recordings archive, and the key off the devices. A simpler build for one person calls Groq directly from each app, with a key held in that app's settings: the same two calls and the same prompt. The trade-off is that a prompt or model change means updating every app. The save-the-audio-first rule then applies on the device.

## The cleanup prompt

`{{input}}` is replaced by the raw transcript, and `{{paragraphs}}` by one of the two paragraph rules below, chosen by the transcript's word count.

```
You are cleaning up a raw speech-to-text transcript so the speaker can paste it directly into a chat thread. The output will be auto-copied to the clipboard, so the speaker may not re-read carefully.

Make ONLY these changes:
1. Add punctuation (commas, periods, question marks). {{paragraphs}}
2. Capitalize sentence starts and proper nouns.
3. Remove pure filler, and nothing else: "um", "uh", false-start stutters ("the the", "I I"), and these verbal tics:
   - "like" used as a pause or hedge: "it's like a big problem" → "it's a big problem"; "we could like move it" → "we could move it". Keep "like" when it means similar to, such as, enjoy or want: "feels like", "looks like", "something like", "things like taxes", "I'd like".
   - "sort of" and "kind of" used as hedges before a verb, adjective or phrase: "we can kind of talk about it" → "we can talk about it"; "it's sort of too bouncy" → "it's too bouncy". Keep them when they mean a type of: "some kind of widget", "a sort of homebrew version", "this kind of thing".
   - "you know" and "I mean" when meaningless.
   Delete only the tic itself and fix the punctuation around it; never rephrase the sentence to absorb it. Every other word stays, including "maybe", "just", "so", "and", "actually", "I guess", "I think" and sentence-opening "And" or "So": they are how the speaker talks, not filler. If deleting a tic would leave the sentence ungrammatical, keep the tic.
4. Fix obvious Whisper transcription slips where the correction is unambiguous from immediate context (e.g. "rank is the just a list" → "rank is just a list", duplicated words, mis-split words, a contraction missing its ending such as "they don control" → "they don't control" or "that true" → "that's true"). Only fix if you are highly confident.

Do NOT:
- Swap any word for a synonym, even if the synonym seems more natural.
- Paraphrase, summarize, condense, or smooth out the speaker's phrasing.
- Complete a sentence the speaker did not finish. If the transcript ends mid-thought, leave it mid-thought — even by a single word. Example: raw ends "I will leave it as your final" → output ends "I will leave it as your final" (NOT "your final decision" or "your final call"). The truncation is the speaker's actual state and must be preserved.
- Reinterpret a phrase even if it sounds odd. If unsure, leave it as-is.
- Add information, examples, or clarifications the speaker did not say.

If you are uncertain whether a change is safe, do not make it. The speaker prefers verbatim with punctuation over a polished rewrite.

<transcript>
{{input}}
</transcript>

Return your result in this exact format:
<cleaned>
[cleaned transcript here]
</cleaned>
```

Under 150 words, `{{paragraphs}}` is:

```
Return a single paragraph: no line breaks at all.
```

At 150 words or more:

```
Split the text into paragraphs where the topic changes, with one blank line between paragraphs. Paragraphs run to about 80-150 words each, so a 300-word transcript usually has 2 or 3 and an 800-word one about 6. Never put each sentence on its own line, and never end a line with spaces.
```
