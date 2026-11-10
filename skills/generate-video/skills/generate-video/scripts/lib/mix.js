// The sound mix for a composed video. Nobody making the video can listen to
// it, so levels are set by measurement, not by ear:
//
//   voice lines   as given (narrate.js brings each to about -20 LUFS)
//   music         levelled to 12 LU under the voice, and lowered a further
//                 8 dB while someone is speaking (a volume envelope built from
//                 the known line times: down over 0.2 s before a line, back up
//                 over 0.5 s after it)
//   effects, clip sound   at the volume given
//   master        the whole mix brought to -14 LUFS, limited below -1 dB peak
//
// Numbers: -14 LUFS is YouTube's reference level; the 12 LU and 8 dB figures
// and the envelope timings are explainroo's calibration; Torcoli et al. (AES
// 2019) recommend at least 10 LU between commentary and music.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const MUSIC_UNDER_VOICE_LU = 12;
export const DUCK_DB = -8;
export const DUCK_ATTACK = 0.2;
export const DUCK_RELEASE = 0.5;
export const MASTER_LUFS = -14;
export const LIMIT_DB = -1.5;
const DEFAULT_VOICE_LUFS = -20;

function ffmpeg(args, what) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed (${what}): ${(r.stderr || r.error?.message || "").slice(-500)}`);
  return r.stderr || "";
}

// Integrated loudness (LUFS) and peak (dB) of a file, or of part of it with a
// filter in front. lufs is null when there is too little sound to measure.
export function measure(file, before = "") {
  const out = ffmpeg(["-i", file, "-af", `${before ? before + "," : ""}ebur128=peak=true`, "-f", "null", "-"], "measuring loudness");
  const summary = out.slice(out.lastIndexOf("Summary:"));
  const i = summary.match(/I:\s+(-?[0-9.]+|-inf) LUFS/);
  const p = summary.match(/Peak:\s+(-?[0-9.]+|-inf) dBFS/);
  const lufs = i && i[1] !== "-inf" ? Number(i[1]) : null;
  return { lufs: lufs !== null && lufs > -69 ? lufs : null, peak: p && p[1] !== "-inf" ? Number(p[1]) : null };
}

export function seconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" });
  const n = Number((r.stdout || "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Join spans that are closer together than `gap`, so the music doesn't bob
// up between two lines.
export function mergeSpans(spans, gap = DUCK_ATTACK + DUCK_RELEASE + 0.1) {
  const sorted = spans.filter((s) => s[1] > s[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s - last[1] < gap) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// A volume expression: 1 between spans, 10^(depth/20) inside them, sloping
// down before each span and back up after it.
export function duckExpr(spans, depthDb = DUCK_DB, attack = DUCK_ATTACK, release = DUCK_RELEASE) {
  if (!spans.length) return "1";
  const f = (n) => Number(n.toFixed(3));
  const ramps = spans.map(([s, e]) => `clip(min((t-${f(s - attack)})/${attack},(${f(e + release)}-t)/${release}),0,1)`);
  const deepest = ramps.reduce((acc, r) => (acc ? `max(${acc},${r})` : r), "");
  return `1-${f(1 - 10 ** (depthDb / 20))}*${deepest}`;
}

const db = (linear) => 20 * Math.log10(Math.max(linear, 1e-6));

// The filter graph for the first pass: every track placed and levelled, then
// summed. Returns the graph and the labels of the outputs to write.
export function mixGraph(tracks, { duration, spans, musicGainDb }) {
  const lines = [];
  const groups = { voice: [], music: [], other: [] };
  tracks.forEach((t, i) => {
    const role = t.role === "voice" || t.role === "music" ? t.role : "other";
    const chain = ["aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"];
    if (role === "voice") chain.push("highpass=f=80");
    chain.push(`adelay=${Math.round(t.start * 1000)}:all=1`);
    const gain = db(t.volume) + (role === "music" ? musicGainDb(t) : 0);
    chain.push(`volume=${gain.toFixed(2)}dB`);
    if (role === "music" && t.duck !== false && spans.length) {
      chain.push("asetnsamples=n=480", `volume=eval=frame:volume='${duckExpr(spans)}'`);
    }
    if (t.fadeOut > 0) chain.push(`afade=t=out:st=${Math.max(0, duration - t.fadeOut)}:d=${t.fadeOut}`);
    chain.push("apad", `atrim=0:${duration}`);
    lines.push(`[${i}:a]${chain.join(",")}[t${i}]`);
    groups[role].push(`[t${i}]`);
  });
  const sum = (labels, out) => {
    if (labels.length === 1) lines.push(`${labels[0]}anull[${out}]`);
    else lines.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${out}]`);
  };
  const parts = [];
  for (const role of ["voice", "music", "other"]) {
    if (!groups[role].length) continue;
    sum(groups[role], `${role}0`);
    // Voice and music are also written on their own, to measure one against the other.
    if (role === "other") parts.push("[other0]");
    else {
      lines.push(`[${role}0]asplit=2[${role}1][${role}stem]`);
      parts.push(`[${role}1]`);
    }
  }
  sum(parts, "mix");
  return { graph: lines.join(";\n"), hasVoice: groups.voice.length > 0, hasMusic: groups.music.length > 0 };
}

// First pass. Writes the full-length mix (and the voice and music on their
// own) as WAV files in tmp, and measures them.
export function buildMix(tracks, meta, tmp) {
  const voices = tracks.filter((t) => t.role === "voice");
  const spans = mergeSpans(voices.map((t) => [t.start, t.start + seconds(t.file)]));
  const levels = voices.slice(0, 40).map((t) => measure(t.file).lufs).filter((x) => x !== null).sort((a, b) => a - b);
  const voiceLufs = levels.length ? levels[Math.floor(levels.length / 2)] : DEFAULT_VOICE_LUFS;
  const musicTarget = voiceLufs - MUSIC_UNDER_VOICE_LU;
  const musicLoudness = new Map();
  const musicGainDb = (t) => {
    if (!musicLoudness.has(t.file)) musicLoudness.set(t.file, measure(t.file).lufs);
    const l = musicLoudness.get(t.file);
    return l === null ? 0 : musicTarget - l;
  };
  const { graph, hasVoice, hasMusic } = mixGraph(tracks, { duration: meta.duration, spans, musicGainDb });
  const script = path.join(tmp, "mix.filter");
  fs.writeFileSync(script, graph, "utf-8");
  const args = ["-y", "-v", "error"];
  for (const t of tracks) args.push(...(t.loop ? ["-stream_loop", "-1"] : []), "-i", t.file);
  args.push("-filter_complex_script", script);
  const wav = (name) => path.join(tmp, `${name}.wav`);
  args.push("-map", "[mix]", "-c:a", "pcm_f32le", wav("mix"));
  if (hasVoice) args.push("-map", "[voicestem]", "-c:a", "pcm_f32le", wav("voice"));
  if (hasMusic) args.push("-map", "[musicstem]", "-c:a", "pcm_f32le", wav("music"));
  ffmpeg(args, "mixing the sound");

  const mix = measure(wav("mix"));
  const report = { voice_lines: voices.length, music_tracks: tracks.filter((t) => t.role === "music").length, mix_lufs_before_master: mix.lufs };
  if (hasVoice && hasMusic && spans.length) {
    // How far the music sits under the voice while someone is speaking.
    const during = `aselect='${spans.map(([s, e]) => `between(t,${s.toFixed(3)},${e.toFixed(3)})`).join("+")}',asetpts=N/SR/TB`;
    const v = measure(wav("voice"), during).lufs;
    const m = measure(wav("music"), during).lufs;
    if (v !== null && m !== null) report.voice_over_music_lu = Math.round((v - m) * 10) / 10;
  }
  return { mixWav: wav("mix"), mixLufs: mix.lufs, report };
}

// Second pass, applied while encoding: cut to the part being rendered, bring
// to the target loudness with one fixed gain, and limit the peaks. The limiter
// works on a 4x oversampled copy so peaks between samples are caught too.
export function masterFilter({ mixLufs, target, from, seconds: len }) {
  const chain = [`atrim=start=${from}:end=${from + len}`, "asetpts=PTS-STARTPTS"];
  if (target !== null && mixLufs !== null) {
    const gain = Math.max(-30, Math.min(30, target - mixLufs));
    chain.push(
      `volume=${gain.toFixed(2)}dB`, "aresample=192000",
      `alimiter=limit=${(10 ** (LIMIT_DB / 20)).toFixed(6)}:attack=5:release=50:level=false:latency=true`,
      "aresample=48000"
    );
  }
  return chain.join(",");
}

// Things to tell the agent, since it can't hear the result.
export function mixWarnings(report, target) {
  const w = [];
  if (report.voice_over_music_lu !== undefined && report.voice_over_music_lu < 10) {
    w.push(`The music is only ${report.voice_over_music_lu} LU under the voice while it speaks; under 10 makes speech hard to follow. Lower the music's data-volume.`);
  }
  if (target !== null && report.loudness_lufs !== undefined && Math.abs(report.loudness_lufs - target) > 1.5) {
    w.push(`The finished sound measures ${report.loudness_lufs} LUFS, not the ${target} asked for.`);
  }
  if (report.true_peak_db !== undefined && report.true_peak_db > -0.5) {
    w.push(`The loudest peak is ${report.true_peak_db} dB, close enough to full scale to distort on some players.`);
  }
  return w;
}
