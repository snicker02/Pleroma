/* ═══════════════════════════════════════════════════════════════════════════
   mp4.js — a minimal MP4 (ISO BMFF) muxer for H.264
   ───────────────────────────────────────────────────────────────────────────
   Exists because MediaRecorder cannot produce a correctly-timed clip from
   slow rendering. It stamps every frame with its ARRIVAL time, and it does so
   even when the frames arrive through a track generator carrying explicit
   presentation timestamps — measured, not assumed: a 48-frame two-second clip
   fed perfect timestamps still came out 139 seconds long.

   WebCodecs `VideoEncoder` has no such problem: it honours each VideoFrame's
   timestamp and hands back encoded chunks carrying them. What it does not do
   is write a container. This is that container, and nothing more: one H.264
   video track, constant frame duration, a single chunk.

   Layout is the plain progressive one — ftyp, mdat, moov. moov goes last so
   every sample offset is known by the time the sample table is written, which
   is what lets this be a single pass with no patching.

   Not a general muxer: no audio, no edit lists, no fragmentation, no B-frame
   reordering (the encoder is configured in a mode that emits none), and the
   32-bit box size caps a clip at 4 GB.
   ═════════════════════════════════════════════════════════════════════════ */

const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));

function u32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function u16(n) { return new Uint8Array([(n >>> 8) & 255, n & 255]); }

function box(type, ...parts) {
  let len = 8;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  out.set(u32(len), 0);
  out.set(ascii(type), 4);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A box whose payload begins with a 1-byte version and 3-byte flags. */
function fbox(type, version, flags, ...parts) {
  const head = new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]);
  return box(type, head, ...parts);
}

function cat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* 3x3 unity matrix, 16.16 fixed point — the identity display transform */
const UNITY = cat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000)
]);

/**
 * Mux encoded H.264 samples into an MP4 blob.
 *
 * @param {Object} o
 * @param {Uint8Array[]} o.samples  AVCC-format access units, in display order
 * @param {boolean[]}    o.keys     whether each sample is a keyframe
 * @param {Uint8Array}   o.avcC     the encoder's decoder description (avcC box payload)
 * @param {number}       o.width
 * @param {number}       o.height
 * @param {number}       o.fps      constant frame rate
 * @returns {Blob}
 */
export function muxMp4(o) {
  const { samples, keys, avcC, width, height, fps } = o;
  const n = samples.length;
  if (!n) throw new Error('No frames to mux.');
  if (!avcC || !avcC.length) throw new Error('Encoder gave no H.264 description.');

  /* Track time runs at `fps` ticks per second with one tick per frame, so the
     sample table needs no per-frame timing at all — every frame is exactly
     one tick. Movie time is milliseconds, which is what players expect. */
  const MOVIE_TS = 1000;
  const movieDur = Math.round(n / fps * MOVIE_TS);

  const ftyp = box('ftyp',
    ascii('isom'), u32(512),
    ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));

  const mdatPayload = cat(samples);
  const mdat = box('mdat', mdatPayload);
  /* every sample sits in one chunk starting right after the mdat header */
  const dataStart = ftyp.length + 8;

  const mvhd = fbox('mvhd', 0, 0, cat([
    u32(0), u32(0),            /* creation / modification time */
    u32(MOVIE_TS), u32(movieDur),
    u32(0x00010000),           /* rate 1.0   */
    u16(0x0100),               /* volume 1.0 */
    u16(0), u32(0), u32(0),    /* reserved   */
    UNITY,
    u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),  /* predefined */
    u32(2)                     /* next track id */
  ]));

  const tkhd = fbox('tkhd', 0, 3 /* enabled | in movie */, cat([
    u32(0), u32(0),            /* times            */
    u32(1),                    /* track id         */
    u32(0),                    /* reserved         */
    u32(movieDur),
    u32(0), u32(0),            /* reserved         */
    u16(0),                    /* layer            */
    u16(0),                    /* alternate group  */
    u16(0),                    /* volume (video=0) */
    u16(0),                    /* reserved         */
    UNITY,
    u32(width << 16), u32(height << 16)   /* 16.16 fixed display size */
  ]));

  const mdhd = fbox('mdhd', 0, 0, cat([
    u32(0), u32(0),
    u32(fps), u32(n),          /* timescale = fps, duration = n ticks */
    u16(0x55c4),               /* language 'und' */
    u16(0)
  ]));

  const hdlr = fbox('hdlr', 0, 0, cat([
    u32(0), ascii('vide'),
    u32(0), u32(0), u32(0),
    ascii('VideoHandler\0')
  ]));

  const avc1 = box('avc1', cat([
    u32(0), u16(0),            /* reserved           */
    u16(1),                    /* data reference idx */
    u16(0), u16(0),            /* predefined, reserved */
    u32(0), u32(0), u32(0),
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000),   /* 72 dpi h/v */
    u32(0),
    u16(1),                    /* frame count */
    new Uint8Array(32),        /* compressor name */
    u16(0x0018),               /* depth */
    u16(0xffff),               /* predefined = -1 */
    box('avcC', avcC)
  ]));

  const stsd = fbox('stsd', 0, 0, cat([u32(1), avc1]));
  const stts = fbox('stts', 0, 0, cat([u32(1), u32(n), u32(1)]));
  const stsc = fbox('stsc', 0, 0, cat([u32(1), u32(1), u32(n), u32(1)]));

  const sizes = [u32(0) /* sample_size 0 = per-sample table follows */, u32(n)];
  for (const s of samples) sizes.push(u32(s.length));
  const stsz = fbox('stsz', 0, 0, cat(sizes));

  const stco = fbox('stco', 0, 0, cat([u32(1), u32(dataStart)]));

  /* stss lists the sync samples. If every frame is a keyframe the box is
     omitted entirely, which is how a player knows all samples are sync. */
  const keyIdx = [];
  for (let i = 0; i < n; i++) if (keys[i]) keyIdx.push(i + 1);
  const stbl = keyIdx.length === n
    ? box('stbl', stsd, stts, stsc, stsz, stco)
    : box('stbl', stsd, stts, stsc, stsz, stco,
        fbox('stss', 0, 0, cat([u32(keyIdx.length), ...keyIdx.map(u32)])));

  const dinf = box('dinf', fbox('dref', 0, 0, cat([u32(1), fbox('url ', 0, 1)])));
  const vmhd = fbox('vmhd', 0, 1, cat([u16(0), u16(0), u16(0), u16(0)]));
  const minf = box('minf', vmhd, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  const moov = box('moov', mvhd, trak);

  return new Blob([ftyp, mdat, moov], { type: 'video/mp4' });
}
