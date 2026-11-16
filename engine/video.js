/* ═══════════════════════════════════════════════════════════════════════════
   video.js — offline clip recording
   ───────────────────────────────────────────────────────────────────────────
   Frames are rendered one at a time and encoded only once each has finished
   drawing, so the export is decoupled from how fast the machine renders.

   WHY NOT MediaRecorder (for MP4). It stamps every frame with its ARRIVAL
   time. `captureStream(0)` + `requestFrame()` controls WHICH frames are
   recorded but not WHEN they are said to occur, so a scene rendering at 0.3
   fps produces a file that PLAYS at 0.3 fps. Feeding explicitly timestamped
   VideoFrames through a MediaStreamTrackGenerator does not help either —
   measured, not assumed: a 48-frame two-second clip given perfect
   presentation timestamps still came out 139 seconds long. MediaRecorder
   simply has no offline mode.

   So MP4 goes through WebCodecs instead. `VideoEncoder` honours each frame's
   timestamp exactly and returns encoded chunks; `mp4.js` wraps them in a
   container. Render speed then has no bearing at all on the result — a 4K
   clip that takes an hour to render still plays at the rate you asked for.

   WebM keeps the MediaRecorder path, because muxing WebM by hand is a much
   bigger job than MP4. That path IS subject to the timing problem, so it
   paces itself to the wall clock and reports when the renderer could not
   keep up rather than silently handing back a stretched clip.
   ═════════════════════════════════════════════════════════════════════════ */

import { muxMp4 } from './mp4.js';

/* Tried in order; the first the encoder accepts at this size wins. The level
   suffix caps resolution and rate, so high levels come first and 4K falls
   back gracefully on older hardware. */
const AVC_CODECS = [
  'avc1.640034', 'avc1.640033', 'avc1.640032',
  'avc1.64002A', 'avc1.640028', 'avc1.640020',
  'avc1.4D4028', 'avc1.42E01E'
];

const WEBM_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

const hasWebCodecs = () =>
  typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

function webmMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of WEBM_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return null;
}

/**
 * Pick an output format.
 * @param {'auto'|'mp4'|'webm'} prefer
 * @returns {{ext:string, label:string, exact:boolean, mime:string|null}|null}
 */
export function pickFormat(prefer = 'auto') {
  const mp4  = hasWebCodecs() ? { ext: 'mp4',  label: 'MP4',  exact: true,  mime: null } : null;
  const wm   = webmMime();
  const webm = wm ? { ext: 'webm', label: 'WEBM', exact: false, mime: wm } : null;
  if (prefer === 'mp4')  return mp4;
  if (prefer === 'webm') return webm;
  return mp4 || webm;
}

/** True when the chosen format records at exactly the requested frame rate. */
export function hasExactTiming(prefer = 'auto') {
  const f = pickFormat(prefer);
  return !!(f && f.exact);
}

/** Yield to the browser between frames. */
const tick = () => new Promise(r => setTimeout(r, 0));

/** First AVC codec string the encoder will accept at this size. */
async function pickAvc(width, height, bitrate, fps) {
  for (const codec of AVC_CODECS) {
    const config = {
      codec, width, height, bitrate, framerate: fps,
      avc: { format: 'avc' }        /* AVCC length-prefixed, what MP4 wants */
    };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s && s.supported) return config;
    } catch (_) { /* try the next */ }
  }
  return null;
}

/* ── MP4 via WebCodecs — exact timing at any render speed ───────────────── */
async function recordMp4(o) {
  const { canvas, bitrate, frames, fps, onFrame, onProgress, cancel } = o;
  const width = canvas.width, height = canvas.height;

  const config = await pickAvc(width, height, bitrate, fps);
  if (!config) throw new Error('No H.264 encoder for ' + width + 'x' + height + '.');

  const samples = [], keys = [];
  let avcC = null, failed = null;

  const enc = new VideoEncoder({
    output(chunk, meta) {
      if (!avcC && meta && meta.decoderConfig && meta.decoderConfig.description) {
        avcC = new Uint8Array(meta.decoderConfig.description);
      }
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      samples.push(b);
      keys.push(chunk.type === 'key');
    },
    error(e) { failed = e; }
  });
  enc.configure(config);

  const us = Math.round(1e6 / fps);
  const gop = Math.max(1, Math.round(fps * 2));   /* a keyframe every 2s */

  try {
    for (let i = 0; i < frames; i++) {
      if (failed) throw failed;
      if (cancel && cancel.stop) break;
      onFrame(i);
      const vf = new VideoFrame(canvas, { timestamp: i * us, duration: us });
      enc.encode(vf, { keyFrame: i % gop === 0 });
      vf.close();
      /* let the encoder drain so a long clip does not pile up in memory */
      while (enc.encodeQueueSize > 8) await tick();
      if (onProgress) onProgress(i + 1, frames);
      await tick();
    }
    await enc.flush();
  } finally {
    try { enc.close(); } catch (_) {}
  }
  if (failed) throw failed;

  return muxMp4({ samples, keys, avcC, width, height, fps });
}

/* ── WebM via MediaRecorder — paced to the wall clock ───────────────────── */
async function recordWebm(o) {
  const { canvas, mime, bitrate, frames, fps, onFrame, onProgress, cancel } = o;

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.requestFrame !== 'function') {
    stream.getTracks().forEach(t => t.stop());
    throw new Error('This browser cannot capture canvas frames on demand.');
  }

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res, rej) => {
    rec.onstop = res;
    rec.onerror = ev => rej((ev && ev.error) || new Error('Recorder failed.'));
  });

  const msPerFrame = 1000 / fps;
  const t0 = performance.now();
  let late = 0;

  rec.start();
  try {
    for (let i = 0; i < frames; i++) {
      if (cancel && cancel.stop) break;
      onFrame(i);
      track.requestFrame();
      if (onProgress) onProgress(i + 1, frames);
      /* This path is timed by arrival, so hold each frame until its slot.
         If rendering already overran it, count it — the clip stretches and
         the caller should say so rather than pretend otherwise. */
      const due = t0 + (i + 1) * msPerFrame;
      if (performance.now() > due) late++;
      while (performance.now() < due) await tick();
      await tick();
    }
  } finally {
    await tick();
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach(t => t.stop());
  }
  await done;

  if (!chunks.length) throw new Error('Recorder produced no data.');
  const blob = new Blob(chunks, { type: mime });
  blob.lateFrames = late;
  return blob;
}

/**
 * Record `frames` frames, calling `onFrame(i)` to draw each one.
 * @returns {Promise<Blob>} the blob carries `.lateFrames` on the WebM path
 */
export function record(o) {
  return o.fmt.ext === 'mp4' ? recordMp4(o) : recordWebm({ ...o, mime: o.fmt.mime });
}

/** Save a blob under `name`, cleaning the object URL up afterwards. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Round a per-second rate so it completes a whole number of turns in
 * `seconds`, which is what lets a spinning scene loop as cleanly as the
 * tunnel does. Rates slower than one turn per loop snap to zero — holding
 * still loops, a third of a turn does not.
 */
export function loopSnap(ratePerSec, seconds, turn = 360) {
  if (!seconds) return ratePerSec;
  const turns = Math.round(ratePerSec * seconds / turn);
  return turns * turn / seconds;
}
