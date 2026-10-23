// The shared scripts for the clips: when each event happens, and what is
// said and shown. Times in seconds. mic-phone.js and the clip scenes read
// these, so clip 1 and the left half of clip 3 can never drift apart.
//
// Clip 3 plays the same story with the sending phase stretched, so the data
// flow on the right has time to be read. Its caption says so.

window.Story = {
  said: "Sounds good, see you at the gate at five.",
  // What Whisper returns (no punctuation yet) and what cleanup returns.
  raw: "sounds good see you at the gate at five",
  cleaned: "Sounds good, see you at the gate at five.",
  incoming: "Are you around later?",
  clipName: "clip-1759900423118.m4a",
  serverAudio: "recordings/2026-10-08T05-13-43_k3x9qa.m4a",
  serverJson: "recordings/2026-10-08T05-13-43_k3x9qa.json",

  // Clip 1: the floating mic, 15 s.
  mic: {
    duration: 12.8,     // trimmed from 15: the tail was a frozen hold
    fingerIn: 1.0,      // finger appears and moves toward the disc
    tap1: 1.6,          // tap: start recording
    growEnd: 1.95,      // disc has grown into the pill
    speechStart: 2.3,   // speech bubble words start appearing
    speechEnd: 5.8,     // all words shown
    tap2: 6.4,          // tap the stop disc
    collapseEnd: 6.75,  // pill back to a disc, spinner running
    textLands: 8.4,     // cleaned text committed into the field; outline back to green
    tapSend: 9.6,       // finger taps the app's send button
    messageSent: 9.8,   // message bubble appears in the chat, field clears
    kbdHide: 11.0,      // keyboard slides away (0.4 s); the disc goes with it
    end: 12.8,
  },

  // Clip 3: the same story, sending stretched for the data flow, then the
  // stop tap replayed at real speed, 22.5 s.
  flow: {
    duration: 22.5,
    fingerIn: 0.8,
    tap1: 1.4,
    growEnd: 1.75,
    speechStart: 2.0,
    speechEnd: 5.4,
    tap2: 6.0,
    collapseEnd: 6.35,
    // Right-hand panel, after tap2:
    fileDone: 6.2,      // clip file on the device is complete
    toServer: [6.5, 7.6],     // blue pulse device -> server
    serverSaved: [7.6, 8.2],  // recordings/...m4a appears on the server
    toWhisper: [8.4, 9.4],    // blue pulse server -> Whisper
    rawBack: [9.6, 10.8],     // violet pulse Whisper -> server, raw text card
    echoCheck: [10.8, 11.4],  // tick: the hint was not recited
    toCleanup: [11.6, 12.6],  // violet pulse server -> cleanup model
    cleanBack: [12.8, 14.0],  // violet pulse back, cleaned text card
    jsonSaved: [14.1, 14.7],  // recordings/...json appears
    toDevice: [14.9, 16.0],   // violet pulse server -> device
    textLands: 16.0,          // left: text lands in the field, outline green
    realTime: [17.4, 22.5],   // the real-speed ending, all of the below
    // Real-speed ending: "Now at real speed", a dip through blank back to just
    // before the stop tap (panel empty), then stop tap to text in 0.5 s
    // (a visualisation: the caption says the measured part, a median 0.46 s
    // of server time over 66 floating-mic dictations).
    reset: [18.4, 18.9],      // dip through blank to the replay's starting state
    replayTap: 19.5,          // the stop tap again
    replayLands: 20.0,        // text lands, 0.5 s after the tap
    resultCaption: 20.3,      // "The server's part: about half a second" to the end
    tapSend: null,            // clip 3 stops at the text landing
    kbdHide: null,
    end: 22.5,
  },

  // Clip 2: the Windows tray app, 15 s.
  win: {
    duration: 13.5,     // trimmed from 15: the last 3 s were caret only
    keys1: 1.2,         // Ctrl+Shift+; overlay appears (pressed ~0.5 s)
    recStart: 1.5,      // tray icon red; start sound cue
    speechStart: 1.9,
    speechEnd: 5.6,
    keys2: 6.2,         // hotkey again
    sending: 6.5,       // icon amber; stop sound cue
    rawReady: 7.6,      // raw written to clipboard (silently since 2026-10-16)
    cleanReady: 8.4,    // cleaned written; the one ready chime; notification slides in; icon grey
    toastOut: 11.6,     // notification leaves
    pasteKeys: 9.6,     // Ctrl+V overlay
    pasted: 9.9,        // text appears in the window at the cursor
    end: 13.5,
  },
};
