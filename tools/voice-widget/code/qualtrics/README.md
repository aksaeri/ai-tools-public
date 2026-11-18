# Voice typing in a Qualtrics question (`question-groq.js`)

This version has no iframe and no on-device model. The button sits under the question's text box. The recording goes through our relay at voice.aksaeri.com to Groq, and the text comes back in a second or two. Each survey uses a named deployment with its own budget (for example `my-survey`, $2). When the budget runs out, respondents see "Voice typing has closed for this survey. You can still type your answer."

## Setup

1. Check you can add JavaScript to questions. If "JavaScript" is missing from the question menu, a brand admin has to turn on the JavaScript permission for your account.
2. Make a **Text Entry** question (multi-line works best).
3. Open the question's JavaScript ("Question behavior" > "JavaScript"; in the old editor, gear icon > "Add JavaScript"). Replace everything in the box with `question-groq.js`.
4. Check the config block at the top. `SCRIPT_URL` is normally left alone. Set `DEPLOYMENT` to this survey's deployment name.
5. In **Survey Flow**, add an Embedded Data element above the question's block, with a field named `__js_voice_used` and no value. It becomes `1` for respondents who used voice typing. Qualtrics adds the `__js_` prefix itself, so the snippet's `EMBEDDED_DATA_FIELD` stays `voice_used`.
6. Add the survey's web address to the deployment's `allowed_origins` in `relay/deployments.json`, then deploy the relay. Use only the `https://host` part, for example `https://yourorg.qualtrics.com`. Open both Preview and the live link and check the address bar on each; if the hosts differ, add both. If a host is missing, the button doesn't appear and the browser console shows a `[voice-widget]` warning naming the address to add.

## Test before launch

1. **Preview:** speak, check the text lands in the box, then edit it.
2. **Live link:** do the same through the anonymous link, then download the test response and check the answer column and `voice_used`.
3. **Required questions:** check that an answer made only by voice counts as answered.
4. **Microphone refused:** click "Block" when the browser asks. The widget should explain how to allow it, and the box should still take typing.
5. **Phones:** try Safari on an iPhone and Chrome on Android.
6. **Back button:** speak, go forward, come back, and speak again. The new text should be added after the old.

Several voice questions on one page are fine: the script loads once and each question gets its own button.
