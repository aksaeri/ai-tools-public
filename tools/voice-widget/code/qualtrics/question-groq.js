/*
 * voice-widget (relay version): voice typing for ONE Qualtrics text-entry question.
 *
 * Where to paste: open the question in the survey editor, then
 * "Question behavior" > "JavaScript" (Classic editor: gear icon > "Add JavaScript").
 * Replace everything in the box with this whole file. Setup steps: qualtrics/README.md.
 *
 * What it does:
 *   1. Loads the voice-widget script (once per page, however many questions use it).
 *   2. Puts a "Speak your answer" button under this question's text box.
 *   3. When the respondent stops talking, their recording goes to our relay, which
 *      sends it to Groq for transcription. The text is added to the box, where they
 *      can edit it like anything they typed. Nothing is stored by us.
 *   4. Sets embedded data __js_voice_used = 1 when voice typing has been used.
 *
 * This page's web address (e.g. https://yourorg.qualtrics.com) must be in the
 * deployment's allowed_origins, or the button stays hidden.
 *
 * Written in plain ES5 (var, function) because the Qualtrics JS editor's checker
 * complains about newer syntax. No jQuery or Prototype.js, so it also works in the
 * New Survey Taking Experience.
 */
Qualtrics.SurveyEngine.addOnload(function () {
  /* ======================= CONFIG: edit these ======================= */
  var CONFIG = {
    // Where the voice-widget script lives.
    SCRIPT_URL: 'https://voice.aksaeri.com/v1/voice-widget.js',

    // Which deployment pays for this survey's transcription (set up in relay/deployments.json).
    DEPLOYMENT: 'my-survey',

    // Embedded data name set to '1' once voice typing has been used on this question.
    // Qualtrics stores it as __js_voice_used; declare that in Survey Flow. '' = don't record.
    EMBEDDED_DATA_FIELD: 'voice_used',

    // Small print under the button. '' hides it; null keeps the default
    // ("Your voice is sent to Groq to turn it into text. Nothing is stored.").
    NOTICE: null,

    // Look and wording (all optional). Example: an outline button in a red accent, light
    // colours even on dark-mode devices, and no instruction line (say it once on the page):
    //   OPTIONS: { buttonStyle: 'outline', colorScheme: 'light', hint: '', size: 'small' }
    // Icon-only with a Cancel button and no success message (handy when a page has many text boxes):
    //   OPTIONS: { buttonStyle: 'outline', colorScheme: 'light', size: 'small', position: 'inline',
    //              hint: '', iconOnly: true, cancelButton: true, usedLabel: '', doneMessage: '' }
    // Colours: set CSS variables on the page instead, e.g. in the survey's Look & Feel CSS:
    //   :root { --vw-accent: #A32035; --vw-radius: 4px; }
    // Fine-tuning: voice-widget::part(button) { font-size: 15px; }
    // Full list: package/README.md.
    OPTIONS: {}
  };
  /* ==================== end of CONFIG ==================== */

  var container = this.getQuestionContainer();
  var box = container && container.querySelector('textarea, input[type="text"]');
  if (!box) {
    if (window.console) console.warn('[voice-widget] no text box found in question ' + this.questionId);
    return;
  }

  var handle = null;
  var unloaded = false;

  function attach() {
    if (unloaded || !window.VoiceWidget) return;
    var options = {
      deployment: CONFIG.DEPLOYMENT,
      onTranscript: function () {
        if (!CONFIG.EMBEDDED_DATA_FIELD) return;
        try { Qualtrics.SurveyEngine.setJSEmbeddedData(CONFIG.EMBEDDED_DATA_FIELD, '1'); }
        catch (e) { if (window.console) console.warn('[voice-widget] could not set embedded data', e); }
      }
    };
    if (CONFIG.NOTICE !== null) options.notice = CONFIG.NOTICE;
    for (var k in (CONFIG.OPTIONS || {})) if (CONFIG.OPTIONS.hasOwnProperty(k)) options[k] = CONFIG.OPTIONS[k];
    handle = window.VoiceWidget.attach(box, options);
  }

  // Load the script once per page. Several questions on one page share one load:
  // the first starts it, the others queue a callback until it finishes.
  if (window.VoiceWidget) {
    attach();
  } else if (window.__voiceWidgetQueue) {
    window.__voiceWidgetQueue.push(attach);
  } else {
    window.__voiceWidgetQueue = [attach];
    var s = document.createElement('script');
    s.src = CONFIG.SCRIPT_URL;
    s.async = true;
    s.onload = function () {
      var queue = window.__voiceWidgetQueue || [];
      window.__voiceWidgetQueue = null;
      for (var i = 0; i < queue.length; i++) queue[i]();
    };
    s.onerror = function () {
      // Voice typing is extra: if the script can't load, the box still works for typing.
      window.__voiceWidgetQueue = null;
      if (window.console) console.warn('[voice-widget] could not load ' + CONFIG.SCRIPT_URL);
    };
    document.head.appendChild(s);
  }

  // Remove the button (and release the microphone) when Qualtrics leaves the page.
  // Matters in the New Survey Taking Experience, which swaps pages without reloading.
  Qualtrics.SurveyEngine.addOnUnload(function () {
    unloaded = true;
    if (handle) handle.detach();
    handle = null;
  });
});
