/* ═══════════════════════════════════════════════════════════════════════════
   palette.js — material palettes
   ───────────────────────────────────────────────────────────────────────────
   Each palette supplies six colours. body/accent are the two ornament
   materials mixed by the per-vertex zone value; void/mid light the background;
   glow is the colour of the light at the vanishing point.
   ═════════════════════════════════════════════════════════════════════════ */

export const PALETTES = [
  { name:'GOLD / NAVY / IVORY', void:'#070d22', mid:'#152a5e', body:'#1b2f63',
    accent:'#d3a233', glow:'#ffe6a8', rim:'#6f9ad6' },
  { name:'LAPIS & PEARL',       void:'#04122c', mid:'#0f3a74', body:'#123f82',
    accent:'#e3eaf6', glow:'#cfe4ff', rim:'#7fb2ec' },
  { name:'CORAL REEF',          void:'#200712', mid:'#6a1f30', body:'#8a2d3c',
    accent:'#f0a24a', glow:'#ffd9a6', rim:'#f07a5a' },
  { name:'VERDIGRIS',           void:'#041a17', mid:'#0f423c', body:'#17524a',
    accent:'#cdae3c', glow:'#dff3dc', rim:'#5fc2a4' },
  { name:'ROSE QUARTZ',         void:'#200d1e', mid:'#5d2a4b', body:'#75355c',
    accent:'#edc87a', glow:'#ffe3ef', rim:'#d98fb6' },
  { name:'OBSIDIAN & BRASS',    void:'#060608', mid:'#1b1b1f', body:'#232329',
    accent:'#bd8a37', glow:'#ffd9a0', rim:'#8e7a5c' },
  { name:'MALACHITE & BONE',    void:'#05140f', mid:'#123a2b', body:'#174733',
    accent:'#e8e0cc', glow:'#f2ffe8', rim:'#6fcf9f' },
  { name:'IMPERIAL VIOLET',     void:'#120725', mid:'#331a5e', body:'#3a2070',
    accent:'#e0b64a', glow:'#f0dcff', rim:'#9a74e0' }
];

/** The six colours the ornament atlas paints with, in tile order. */
export function palArray(p) {
  return [p.void, p.mid, p.accent, p.glow, p.rim, p.body];
}

export function hex2rgb(h) {
  return [parseInt(h.slice(1,3),16)/255,
          parseInt(h.slice(3,5),16)/255,
          parseInt(h.slice(5,7),16)/255];
}
