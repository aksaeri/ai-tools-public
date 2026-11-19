# voice-widget.js

Adds a "Speak your answer" button under any text box. People talk, the recording goes to Groq Whisper through our relay at voice.aksaeri.com, and the text lands in the box at the cursor, or at the end if the box wasn't focused. One file with no dependencies and no build step. The relay API it talks to is in `docs/specs/2026-11-06-v1-relay-and-package.md`.

## Add it to a page

```html
<script src="https://voice.aksaeri.com/v1/voice-widget.js" data-deployment="demo" defer></script>
<textarea data-voice></textarea>
```

Every `textarea[data-voice]` and `input[data-voice]` gets a button, including boxes added to the page later. The page's origin (for example `https://example.org`) must be in the deployment's `allowed_origins` in `relay/deployments.json`. If it isn't, or the deployment is closed or out of budget, no button appears and the browser console says why.

Options on the script tag:

| Attribute | Default | What it does |
|---|---|---|
| `data-deployment` | none (required) | Which deployment's budget and allowed sites apply |
| `data-target` | none | Extra CSS selector to attach to, e.g. `#q1 textarea` |
| `data-notice` | "Your voice is sent to Groq to turn it into text. Nothing is stored." | Small print under the button; `""` hides it |
| `data-label` | "Speak your answer" | Button text |
| `data-max-seconds` | 180 | Recording stops by itself at this length (3 minutes by default); match the deployment's `max_seconds`. In the last 20 seconds the timer counts down ("stops in 12 s") and a line says when it will stop |
| `data-accent` | built-in green | Button colour (hex, rgb or hsl), e.g. `#17879B` |
| `data-accent-dark` | same as `data-accent` | Button colour when the visitor's system is in dark mode |
| `data-size` | normal | `small` gives a quieter, more compact button (34 px tall instead of 44 px) |
| `data-button-style` | filled | `outline`: transparent fill, accent border and text |
| `data-color-scheme` | auto | `light` or `dark` fixes the colours; `auto` follows the visitor's device |
| `data-hint` | "Press the button and talk…" | The instruction shown before first use; `""` hides it |
| `data-icon-only` | off | Show only the microphone icon. The button keeps its spoken label (aria-label) and gets a matching tooltip |
| `data-cancel-button` | off | While recording, show a quieter Cancel button (×) beside Stop. Cancelling throws the recording away: nothing is sent or charged. Escape does the same |
| `data-used-label` | "Add more by voice" | Button label after the first transcript; `""` keeps the original label |
| `data-done-message` | "Added to your answer. You can edit it." | Message after a successful transcript; `""` shows nothing. Errors and "Listening…" still show |
| `data-position` | `below` | `inline` puts the button beside the box instead of under it |
| `data-endpoint` | the folder above `/v1/` in the script's URL | Relay to use, if not the one that served the script |
| `data-debug` | off | `"1"` exposes `VoiceWidget._debugSend(handle, blob, seconds)` for tests without a microphone |

## From JavaScript

```js
const handle = VoiceWidget.attach(document.querySelector('#answer'), {
  deployment: 'demo',
  onTranscript: (text, detail) => console.log(text, detail.seconds),
});
handle.detach();                 // removes the button and frees the microphone
VoiceWidget.get(element);        // the handle for an element, or null
```

`attach()` takes the same options as the script tag (`deployment`, `endpoint`, `notice`, `label`, `maxSeconds`, `position`, `lang`) plus `onTranscript`. `lang` is accepted but does nothing yet: v1 is English only. The box also fires a bubbling `voicewidget:transcript` event with `{text, seconds}`.

Text is written through the browser's native value setter, followed by `input` and `change` events, so React and Vue forms pick it up.

## Qualtrics

Use `qualtrics/question-groq.js`; the steps are in `qualtrics/README.md`.

## Limits in v1

- Only `<textarea>` and `<input type="text">` (or `type="search"`) are supported. Rich-text editors and `contenteditable` boxes get no button.
- The page must be https, because browsers only allow the microphone on secure pages.
- One recording at a time per page. Starting a second one stops the first, and its text still lands in its own box.


## Styling from the page

Colours come from CSS custom properties, which pass into the widget's sealed-off styles. Set them on `:root` or any ancestor of the text box. Each falls back to the built-in value.

| Property | Default | |
|---|---|---|
| `--vw-accent` / `--vw-accent-text` | `#2f5d50` / `#fff` | Button colour and its text |
| `--vw-record` / `--vw-record-text` | `#b3261e` / `#fff` | Button while recording |
| `--vw-focus` | `#1a73e8` | Keyboard focus ring |
| `--vw-button-bg`, `--vw-button-text`, `--vw-button-border` | from the accent | Override the button directly |
| `--vw-radius` | `999px` | Button corner radius |
| `--vw-accent-dark`, `--vw-accent-text-dark`, `--vw-record-dark`, `--vw-record-text-dark`, `--vw-focus-dark` | built-in dark values | Used in dark mode when `data-color-scheme` is `auto` (or `dark`) |

`data-accent` (if set) wins over `--vw-accent`.

Parts for `::part()`: `root`, `button`, `message`, `timer`, `notice`. For example:

```css
voice-widget::part(button) { border-radius: 4px; font-size: 15px; }
voice-widget::part(notice) { font-style: italic; }
```

The font follows the page, so the widget uses whatever font the text around it uses.


## Manual API and events

`VoiceWidget.attach(el, options)` takes the same options in camelCase (`iconOnly`, `cancelButton`, `usedLabel`, `doneMessage`, `buttonStyle`, `colorScheme`, `hint`, `notice`, `size`, `position`, …) and returns a handle:

- `handle.state`: `idle`, `start` (asking for the microphone), `rec`, `send`, `err` or `off` (closed: budget used up or not allowed).
- `handle.cancel()`: throws away a recording in progress (no-op otherwise).
- `handle.detach()`: removes the button.

Events, dispatched on the text box and bubbling:

- `voicewidget:state` with `detail = {state, previous, element}` on every state change.
- `voicewidget:transcript` with `detail = {text, seconds, element}` after text is inserted.

Parts for `::part()` also include `label` (the button text) and `cancel` (the Cancel button).
