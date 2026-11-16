/* ═══════════════════════════════════════════════════════════════════════════
   Pleroma — main.js
   UI binding, camera, and the frame loop. All geometry lives in engine/.
   ═════════════════════════════════════════════════════════════════════════ */

import { buildMeshes, MESH_SETS, RIB_MESH, SWEEP_SAMPLES } from './engine/meshes.js';
import { PALETTES, hex2rgb, palArray } from './engine/palette.js';
import { buildAtlasLayers, ATLAS_N } from './engine/atlas.js';
import { buildLattice, solveTunnel } from './engine/lattice.js';
import { createRenderer }         from './engine/render.js';
import { pickFormat, record, saveBlob, loopSnap } from './engine/video.js';
import { perspective, multiply, viewEuler, projectPoint,
         mat3Euler, m3apply } from './engine/mat4.js';

const g  = id => document.getElementById(id);
const gf = id => parseFloat(g(id).value);
const gi = id => parseInt(g(id).value, 10);

function fatal(msg) {
  const e = g('err');
  e.style.display = 'block';
  e.textContent = msg;
  g('boot').classList.add('done');
}
window.addEventListener('error', ev => fatal('ERROR\n\n' + (ev.error ? ev.error.stack : ev.message)));

const cv = document.getElementById('c');
const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true, alpha: false });
if (!gl) fatal('WebGL 2 is required.\nChrome, Firefox or Safari 15+.');

/* ── populate the dropdowns from the engine data ── */
MESH_SETS.forEach((s, i) => {
  const o = document.createElement('option'); o.value = i; o.textContent = s.name;
  g('mset').appendChild(o);
});
PALETTES.forEach((p, i) => {
  const o = document.createElement('option'); o.value = i; o.textContent = p.name;
  g('pal').appendChild(o);
});

const R = createRenderer(gl);
R.uploadMeshes(buildMeshes());

/* ── state ── */
let W = 0, H = 0, phase = 0, roll = 0, lastT = 0, fpsArr = [];
let drag = false, lx = 0, ly = 0;
const DEG = Math.PI / 180;
let total = 0, bucketsDrawn = 0, perSpoke = 0;
let recording = false;   /* the live loop stands down while a clip records */
let ribStart = -3, ribSpan = 33;
let cPal = null;

function rebuildPalette() {
  const p = PALETTES[gi('pal')];
  R.uploadAtlas(buildAtlasLayers(palArray(p)));
  cPal = {
    cVoid: hex2rgb(p.void), cMid: hex2rgb(p.mid), cBody: hex2rgb(p.body),
    cAccent: hex2rgb(p.accent), cGlow: hex2rgb(p.glow), cRim: hex2rgb(p.rim)
  };
}

/* The stepped ribbon path snaps each template sample to a corner, so the
   template must carry at least as many samples as there are corners or the
   polygon quietly loses some. Same spirit as lattice.js's guard invariant:
   assert the thing that would otherwise fail in silence. */
function checkCornerBudget() {
  const steps = gi('ribSteps');
  if (steps <= 0) return 0;
  const corners = (gi('rings') + 3) * steps;
  const budget = gi('ribSides') === 0 ? SWEEP_SAMPLES.tube : SWEEP_SAMPLES.prism;
  if (corners > budget) {
    console.warn('[pleroma] ribbon corners ' + corners + ' exceed template samples '
      + budget + ' — corners will be dropped. Lower HARD ANGLES or RINGS.');
  }
  return corners;
}

function rebuildLattice() {
  const res = buildLattice({
    rings: gi('rings'), spokes: gi('spokes'), shells: gi('shells'),
    shellStep: gf('shellStep'), seed: gi('seed'),
    meshSet: MESH_SETS[gi('mset')].idx,
    depth: gi('depth'), branches: gi('branches'),
    contraction: gf('contraction'), orbit: gf('orbit'),
    branchTilt: gf('branchTilt'), levelSpin: gf('levelSpin'),
    selfSim: gf('selfSim'),
    tileU: gi('tileU'), tileV: gi('tileV'),
    brick: gf('brick'), variety: gf('variety'), hueSpread: gf('hueSpread'),
    spinSpread: gf('spinSpread'), tilt: gf('tilt'),
    ribbons: gi('ribbons'), ribTurn: gf('ribTurn'),
    ribCross: gi('ribCross'), ribCrossR: gf('ribCrossR'),
    ribCrossTurn: gf('ribCrossTurn'),
    ribRadius: gf('ribRadius'), ribWobble: gf('ribWobble'),
    ribHarm: gi('ribHarm'), ribBeads: gi('ribBeads'),
    ribMesh: RIB_MESH[gi('ribSides')] ?? 16,
    ribCorners: checkCornerBudget()
  });
  R.uploadInstances(res.buckets);
  total = res.total;
  perSpoke = res.perSpoke;
  ribStart = res.ribStart;
  ribSpan = res.ribSpan;
}

/* ── draw ── */
/* ═══ COPIES ═══════════════════════════════════════════════════════════
   Each entry is a rigid placement of the ENTIRE structure. The lattice is
   built once and replayed per copy, so adding a copy costs draw calls and
   triangles but no CPU rebuild and no extra memory. */
const copies = [
  { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 },
  { pos: [0, 0, 0], rot: [0, 90, 0], scale: 1 },
  { pos: [0, 0, 0], rot: [90, 0, 0], scale: 1 },
  { pos: [0, 0, 0], rot: [0, 0, 45], scale: 1 }
];
let copyEdit = 0;

/** Resolve the active copies into GL-ready transforms. */
function copyTransforms(lightZ) {
  const n = gi('copies');
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = copies[i];
    const R = mat3Euler(c.rot[0] * DEG, c.rot[1] * DEG, c.rot[2] * DEG);
    const T = new Float32Array(c.pos);
    /* the copy's own vanishing point, carried through the same transform,
       so each tunnel is backlit down its own axis */
    const Lw = m3apply(R, [0, 0, -lightZ * c.scale]);
    out.push({ R, T, S: c.scale,
               L: new Float32Array([Lw[0] + c.pos[0], Lw[1] + c.pos[1], Lw[2] + c.pos[2]]) });
  }
  return out;
}

function scene(w, h) {
  const { lambda, mu } = solveTunnel(gf('q'), gf('funnel'));
  const aspect = w / h;
  const proj = perspective(gf('fov') * Math.PI / 180, aspect, 0.05, 4000);
  /* PIVOT = 0 rotates the view in place (camera stays on the axis).
     PIVOT > 0 orbits the camera around a point that far down the tunnel, so
     the structure tumbles in frame instead of swinging out of it. The two
     agree exactly at zero rotation, so moving the pivot alone changes
     nothing — it only changes what the angles do. */
  const rx = gf('rotX') * DEG, ry = gf('rotY') * DEG, rz = gf('rotZ') * DEG;
  const pz = gf('pivot');
  const cp = Math.cos(rx), sp = Math.sin(rx);
  const cyw = Math.cos(ry), syw = Math.sin(ry);
  /* camera-to-world "back" axis; eye = pivot + back * pz */
  const eye = [ pz * syw * cp, -pz * sp, -pz + pz * cyw * cp ];
  const view = viewEuler(eye, rx, ry, rz);
  const vp = multiply(proj, view);

  /* the glow follows the real projected tunnel axis, so it stays anchored
     when you look around instead of sitting at screen centre */
  const ndc = projectPoint(vp, [0, 0, -gf('lightZ')]) || [0, 0];
  const axis = [ndc[0] * aspect * 0.5, ndc[1] * 0.5];

  return Object.assign({
    vp, view, axis, eye,
    phase, lambda, mu,
    R0: gf('R0'), D0: 1.0, S0: gf('S0'),
    twist: gf('twist'), spin: roll, rings: gi('rings'),
    ribStart: ribStart, ribSpan: ribSpan,
    ribWobble: gf('ribWobble'), ribHarm: gi('ribHarm'),
    ribSteps: gi('ribSteps'),
    lightZ: gf('lightZ'), key: gf('key'), fill: gf('fill'), amb: gf('amb'),
    spec: gf('spec'), shine: gf('shine'), rimI: gf('rimI'), fog: gf('fog'),
    zoneSharp: gf('zoneSharp'), goldBias: gf('goldBias'),
    bandFreq: gf('bandFreq'), bandDepth: gf('bandDepth'), bandType: gi('bandType'), bandBias: gf('bandBias'),
    atlasN: ATLAS_N, texMix: gf('texMix'), debug: (window.__dbgMode|0),
    glowI: gf('glowI'), glowR: gf('glowR'), stars: gf('stars'),
    vig: gf('vig'), seed: gi('seed'),
    copies: copyTransforms(gf('lightZ'))
  }, cPal);
}

function frame(now) {
  /* While recording, the canvas is resized to the export framing and the
     phase is driven by frame index. Letting the live loop also draw would
     resize it back every tick and race the encoder for frames. */
  if (recording) { requestAnimationFrame(frame); return; }
  const dt = Math.min((now - lastT) / 1000, 0.05) || 0.016;
  lastT = now;
  fpsArr.push(1 / dt); if (fpsArr.length > 40) fpsArr.shift();

  /* decreasing phase flies INTO the tunnel; wrap keeps the loop seamless */
  phase -= dt * gf('fly');
  phase -= Math.floor(phase);
  roll  += dt * gf('roll') * 0.15;

  /* auto-tumble writes back into the sliders, wrapping to [-180,180], so the
     readouts stay live and LEVEL/RESET always reflect the real orientation */
  for (const ax of ['X', 'Y', 'Z']) {
    const rate = gf('spin' + ax);
    if (rate === 0) continue;
    const el = g('rot' + ax);
    let v = parseFloat(el.value) + rate * dt;
    v = ((v + 180) % 360 + 360) % 360 - 180;
    el.value = v.toFixed(1);
    el.dispatchEvent(new Event('input'));
  }

  const q = gf('res');
  const nW = Math.max(1, Math.floor(innerWidth * q));
  const nH = Math.max(1, Math.floor(innerHeight * q));
  if (nW !== W || nH !== H) {
    W = nW; H = nH; cv.width = W; cv.height = H;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  }

  bucketsDrawn = R.draw(W, H, scene(W, H));

  const fps = Math.round(fpsArr.reduce((a, b) => a + b, 0) / fpsArr.length);
  g('stat').textContent =
    fps + ' fps · ' + total.toLocaleString() + ' solids · ' +
    perSpoke + '/node · ' + bucketsDrawn + ' draws · ' + W + '×' + H;
  requestAnimationFrame(frame);
}

/* ── camera drag ── */
cv.addEventListener('mousedown', e => { drag = true; lx = e.clientX; ly = e.clientY; e.preventDefault(); });
window.addEventListener('mouseup', () => drag = false);
function nudgeView(dx, dy) {
  const y = g('rotY'), x = g('rotX');
  let vy = parseFloat(y.value) - dx * 0.25;
  vy = ((vy + 180) % 360 + 360) % 360 - 180;
  y.value = vy.toFixed(1); y.dispatchEvent(new Event('input'));
  x.value = Math.max(-180, Math.min(180, parseFloat(x.value) - dy * 0.25)).toFixed(1);
  x.dispatchEvent(new Event('input'));
}
window.addEventListener('mousemove', e => {
  if (!drag) return;
  nudgeView(e.clientX - lx, e.clientY - ly);
  lx = e.clientX; ly = e.clientY;
});
cv.addEventListener('touchstart', e => {
  if (e.touches.length === 1) { drag = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY; }
  e.preventDefault();
}, { passive: false });
cv.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && drag) {
    nudgeView(e.touches[0].clientX - lx, e.touches[0].clientY - ly);
    lx = e.touches[0].clientX; ly = e.touches[0].clientY;
  }
  e.preventDefault();
}, { passive: false });
cv.addEventListener('touchend', () => drag = false);

/* ── slider readouts ── */
function sl(id, dp) {
  const el = g(id), out = g(id + 'v');
  if (!el || !out) return;
  const d = dp === undefined
    ? (el.step && el.step.includes('.') ? el.step.split('.')[1].length : 0)
    : dp;
  const upd = () => out.textContent = parseFloat(el.value).toFixed(d);
  upd(); el.addEventListener('input', upd);
}
/* decimals per readout; anything unlisted infers from the input's step */
const DP = {
  rings:0, spokes:0, shells:0, shine:0, lightZ:0, fov:0, seed:0,
  depth:0, branches:0, ribbons:0, ribHarm:0, ribBeads:0, ribCross:0, saveSize:0,
  ribSteps:0,
  rotX:0, rotY:0, rotZ:0, spinX:1, spinY:1, spinZ:1, pivot:1, tileU:0, tileV:0,
  q:2, glowR:2, fly:2, shellStep:2, S0:3, ribWobble:3
};
['rings','spokes','shells','shellStep','q','funnel','twist','R0','S0','brick',
 'variety','depth','branches','contraction','orbit','branchTilt','levelSpin','selfSim',
  'tileU','tileV',
 'spinSpread','tilt','hueSpread','zoneSharp','goldBias',
 'ribbons','ribTurn','ribRadius','ribWobble','ribHarm','ribBeads',
 'ribCross','ribCrossR','ribCrossTurn','ribSteps',
 'key','fill','amb','spec','shine','rimI','fog','lightZ','glowI','glowR',
 'stars','vig','fov','fly','roll','seed','bandFreq','bandDepth','bandBias',
 'rotX','rotY','rotZ','spinX','spinY','spinZ','pivot','texMix','tileU','tileV',
 'saveSize']
  .forEach(id => sl(id, DP[id]));

/* structural params rebuild the instance buffers; the rest are uniforms */
const STRUCT = ['rings','spokes','shells','shellStep','brick','mset','variety',
  'depth','branches','contraction','orbit','branchTilt','levelSpin','selfSim','selfSim',
  'tileU','tileV',
  'spinSpread','tilt','hueSpread','seed',
  'ribbons','ribTurn','ribRadius','ribBeads','ribCross','ribCrossR','ribCrossTurn',
  'ribSides'];
STRUCT.forEach(id => {
  g(id).addEventListener('input',  rebuildLattice);
  g(id).addEventListener('change', rebuildLattice);
});
g('pal').addEventListener('change', rebuildPalette);

/* ═══ copy panel ═══════════════════════════════════════════════════════
   The sliders are a VIEW onto copies[copyEdit]: switching the selector
   loads that copy's values in, moving a slider writes back. There is no
   second hidden copy of the numbers, so the panel and the scene can never
   disagree — the same discipline the orientation sliders use. */
const CP_POS = ['cpx', 'cpy', 'cpz'];
const CP_ROT = ['crx', 'cry', 'crz'];

function copyPanelLoad() {
  const c = copies[copyEdit];
  CP_POS.forEach((id, i) => { g(id).value = String(c.pos[i]); });
  CP_ROT.forEach((id, i) => { g(id).value = String(c.rot[i]); });
  g('csc').value = String(c.scale);
  readoutCopy();
}

function copyPanelStore() {
  const c = copies[copyEdit];
  CP_POS.forEach((id, i) => { c.pos[i] = gf(id); });
  CP_ROT.forEach((id, i) => { c.rot[i] = gf(id); });
  c.scale = gf('csc');
  readoutCopy();
}

function readoutCopy() {
  CP_POS.forEach(id => { g(id + 'v').textContent = gf(id).toFixed(1); });
  CP_ROT.forEach(id => { g(id + 'v').textContent = String(Math.round(gf(id))); });
  g('cscv').textContent = gf('csc').toFixed(2);
  g('copiesv').textContent = String(gi('copies'));
}

/** Keep the EDIT COPY options in step with the copy count. */
function copySelRefresh() {
  const n = gi('copies'), sel = g('copySel');
  if (sel.options.length !== n) {
    sel.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = (i + 1) + (i === 0 ? ' (base)' : '');
      sel.appendChild(o);
    }
  }
  if (copyEdit >= n) copyEdit = n - 1;
  sel.value = String(copyEdit);
  copyPanelLoad();
}

[...CP_POS, ...CP_ROT, 'csc'].forEach(id => {
  g(id).addEventListener('input', copyPanelStore);
});
g('copySel').addEventListener('change', () => {
  copyEdit = gi('copySel'); copyPanelLoad();
});
g('copies').addEventListener('input', copySelRefresh);

/* Spread the active copies into view.
   The camera sits in the MOUTH of copy one's tunnel, not outside the scene,
   so copies fanned sideways around the origin start at the eye and shoot
   straight out of frame. Each extra copy is therefore pushed DOWN-TUNNEL,
   far enough ahead that its own mouth is in front of the camera and it
   reads as a separate object crossing the first. */
g('copyFanBtn').addEventListener('click', () => {
  const n = gi('copies');
  for (let i = 0; i < n; i++) {
    if (i === 0) { copies[0] = { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }; continue; }
    const a = (i / Math.max(n - 1, 1)) * Math.PI * 2;
    copies[i].pos = [ +(Math.cos(a) * 2.4).toFixed(1),
                      +(Math.sin(a) * 2.4).toFixed(1),
                      -(5 + i * 5) ];
    /* turned hard off-axis so the copy cuts ACROSS the view rather than
       lining up behind copy one and hiding inside it */
    copies[i].rot = [ i % 2 ? 24 : -18, i % 2 ? 90 : -90, i * 23 ];
    copies[i].scale = +(1 - i * 0.1).toFixed(2);
  }
  copyPanelLoad();
});

g('copyResetBtn').addEventListener('click', () => {
  copies[copyEdit] = { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 };
  copyPanelLoad();
});

g('levelBtn').addEventListener('click', () => {
  ['rotX','rotY','rotZ'].forEach(id => {
    g(id).value = '0'; g(id).dispatchEvent(new Event('input'));
  });
});
g('toggle').addEventListener('click', () => g('panel').classList.toggle('hidden'));
g('randBtn').addEventListener('click', () => {
  g('seed').value = Math.floor(Math.random() * 999) + 1;
  g('seed').dispatchEvent(new Event('input'));
});

const DEFAULTS = {
  rings:'30', spokes:'7', shells:'1', shellStep:'0.55', q:'0.86', funnel:'0.12',
  twist:'0.22', R0:'0.62', S0:'0.10', brick:'0.5',
  mset:'0', variety:'1.0',
  depth:'3', branches:'2', contraction:'0.58', orbit:'1.55', selfSim:'1.0',
  branchTilt:'0.70', levelSpin:'1.10', spinSpread:'0.25', tilt:'0.35',
  ribbons:'2', ribTurn:'1.1', ribRadius:'0.40',
  ribCross:'2', ribCrossR:'1.0', ribCrossTurn:'1.0',
  ribWobble:'0.12', ribHarm:'2', ribBeads:'2', ribSides:'0', ribSteps:'0',
  pal:'0', hueSpread:'0.05', zoneSharp:'2.5', goldBias:'0.0',
  texMix:'0.92', tileU:'1', tileV:'1',
  bandType:'0', bandFreq:'1.1', bandDepth:'0.0', bandBias:'0.35',
  key:'0.95', fill:'0.42', amb:'0.26', spec:'0.30', shine:'22', rimI:'0.45',
  fog:'0.22', lightZ:'60', glowI:'0.62', glowR:'0.10', stars:'0.5', vig:'0.5',
  fov:'62', fly:'0.12', roll:'0.15', res:'1.0', seed:'7',
  saveSize:'3840', saveShape:'window',
  rotX:'0', rotY:'0', rotZ:'0', spinX:'0', spinY:'0', spinZ:'0', pivot:'0.0',
  copies:'1', cpx:'0', cpy:'0', cpz:'0', crx:'0', cry:'0', crz:'0', csc:'1'
};
g('resetBtn').addEventListener('click', () => {
  Object.entries(DEFAULTS).forEach(([k, v]) => {
    const el = g(k); if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  });
  /* the sliders only ever show ONE copy, so clearing them cannot clear the
     others — reset the whole array explicitly */
  copies[0] = { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 };
  copies[1] = { pos: [0, 0, 0], rot: [0, 90, 0], scale: 1 };
  copies[2] = { pos: [0, 0, 0], rot: [90, 0, 0], scale: 1 };
  copies[3] = { pos: [0, 0, 0], rot: [0, 0, 45], scale: 1 };
  copyEdit = 0; copySelRefresh();
  phase = 0; roll = 0;
  rebuildPalette(); rebuildLattice();
});

/* ── offscreen framing, shared by the PNG and the video exporters ──────────
   The projection is built from VERTICAL fov, so exporting at an aspect
   narrower than the window silently crops the sides — which is what the
   hardcoded 2160x3840 used to do to a landscape window. Widening the
   vertical fov makes the exported frame contain AT LEAST the window's field
   in both axes: it can only ever add area, never cut it. Both exporters go
   through this, so neither can drift from the other. */
function aspectOf(shape) {
  if (shape === 'window') return cv.width / cv.height;
  if (shape === 'port')   return 9 / 16;
  if (shape === 'land')   return 16 / 9;
  return 1;
}

/* "1080p" names the SHORT edge in landscape (1920x1080) and the short edge in
   portrait too (1080x1920) — it is the frame height for wide video and the
   width for tall video, i.e. always the smaller dimension. framing() works in
   long edges, so convert. Getting this wrong silently exports 720x406 for a
   "720p" landscape clip, which is what the first build did. */
function longEdgeFor(shape, shortEdge) {
  const a = aspectOf(shape);
  return Math.round(shortEdge * Math.max(a, 1 / a));
}

function framing(shape, longEdge) {
  const aspect = aspectOf(shape);
  const winA = cv.width / cv.height;   /* what the fov widening compares to */

  /* encoders want even dimensions — H.264 rejects odd ones outright */
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  const sw = even(aspect >= 1 ? longEdge : longEdge * aspect);
  const sh = even(aspect >= 1 ? longEdge / aspect : longEdge);

  const tanV = Math.tan(gf('fov') * DEG / 2);
  const tanH = tanV * winA;
  const fov = 2 * Math.atan(Math.max(tanV, tanH / aspect)) / DEG;
  return { sw, sh, aspect, fov };
}

/** Draw one frame at an export framing, into the already-resized canvas. */
function drawFramed(f) {
  const S = scene(f.sw, f.sh);
  S.vp = multiply(perspective(f.fov * DEG, f.aspect, 0.05, 4000), S.view);
  const ndc = projectPoint(S.vp, [0, 0, -gf('lightZ')]) || [0, 0];
  S.axis = [ndc[0] * f.aspect * 0.5, ndc[1] * 0.5];
  R.draw(f.sw, f.sh, S);
}

g('snapBtn').addEventListener('click', () => {
  const f = framing(g('saveShape').value, gi('saveSize'));
  const pw = cv.width, ph = cv.height;
  cv.width = f.sw; cv.height = f.sh;
  drawFramed(f);

  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = 'pleroma_' + f.sw + 'x' + f.sh + '_' + Date.now() + '.png';
  a.click();
  cv.width = pw; cv.height = ph; W = pw; H = ph;
});

/* ── video export ─────────────────────────────────────────────────────────
   The scene is 1-periodic in phase, so a clip of N frames stepping phase
   0 -> (N-1)/N is a perfect loop by construction. PERFECT LOOP extends that
   to the camera motion, which is otherwise the thing that gives a "seamless"
   loop away: a tumble that completes 2.3 turns in the clip jumps on repeat.
   loopSnap rounds each rate to a whole number of turns over the clip. */
const vidCancel = { stop: false };

g('vidBtn').addEventListener('click', async () => {
  if (recording) { vidCancel.stop = true; return; }

  const fmt = pickFormat(g('vidFmt').value);
  if (!fmt) {
    g('vidStat').textContent = g('vidFmt').value === 'mp4'
      ? 'This browser has no WebCodecs H.264 encoder — choose WEBM or AUTO.'
      : 'This browser cannot record video.';
    return;
  }

  const fps     = gi('vidFps');
  const secs    = gi('vidSec');
  const loops   = gi('vidLoops');
  const perLoop = Math.max(1, Math.round(fps * secs));
  const frames  = perLoop * loops;
  const vshape  = g('vidShape').value;
  const f       = framing(vshape, longEdgeFor(vshape, gi('vidSize')));
  const perfect = g('vidPerfect').checked;

  /* snapshot everything the clip mutates, so a cancel leaves no trace */
  const pw = cv.width, ph = cv.height;
  const phase0 = phase, roll0 = roll;
  const rot0 = { X: gf('rotX'), Y: gf('rotY'), Z: gf('rotZ') };
  const spin = { X: gf('spinX'), Y: gf('spinY'), Z: gf('spinZ') };
  const rollRate = gf('roll') * 0.15;

  /* snap the motion rates to whole turns over ONE loop, not over the whole
     clip — a clip of 3 loops must repeat every loop, not only at the end */
  const sp = perfect
    ? { X: loopSnap(spin.X, secs), Y: loopSnap(spin.Y, secs), Z: loopSnap(spin.Z, secs) }
    : spin;
  const rr = perfect ? loopSnap(rollRate, secs, Math.PI * 2) : rollRate;

  if (!fmt.exact) {
    /* the WebM path is timed by arrival, so it only holds the chosen rate
       while the renderer keeps up; say so before a long export, not after */
    g('vidStat').textContent =
      'WebM is paced in real time — drop SIZE or FPS if frames come out late.';
  }

  recording = true;
  vidCancel.stop = false;
  g('vidBtn').textContent = '■ STOP';
  cv.width = f.sw; cv.height = f.sh;

  const wrap = v => ((v + 180) % 360 + 360) % 360 - 180;
  const t0 = performance.now();

  try {
    const blob = await record({
      canvas: cv, fmt, fps, frames,
      bitrate: gi('vidRate') * 1e6,
      cancel: vidCancel,
      onFrame(i) {
        const t = i / fps;                      /* seconds into the clip   */
        /* phase from the frame INDEX, so the wrap lands exactly on frame 0 */
        phase = perfect ? (i % perLoop) / perLoop
                        : phase0 - t * gf('fly');
        phase -= Math.floor(phase);
        roll = roll0 + rr * t;
        for (const ax of ['X', 'Y', 'Z']) {
          if (sp[ax] === 0) continue;
          g('rot' + ax).value = wrap(rot0[ax] + sp[ax] * t).toFixed(1);
        }
        drawFramed(f);
      },
      onProgress(i, n) {
        const el = performance.now() - t0;
        const eta = i ? Math.round((el / i) * (n - i) / 1000) : 0;
        g('vidStat').textContent =
          i + '/' + n + ' frames · ' + Math.round(100 * i / n) + '% · ~' + eta + 's left';
      }
    });

    if (vidCancel.stop) {
      g('vidStat').textContent = 'Cancelled.';
    } else {
      saveBlob(blob, 'pleroma_' + f.sw + 'x' + f.sh + '_' + Date.now() + '.' + fmt.ext);
      const lateNote = blob.lateFrames
        ? ' · ' + blob.lateFrames + ' frames late (clip is stretched)' : '';
      g('vidStat').textContent =
        fmt.label + ' · ' + frames + ' frames · ' + (frames / fps).toFixed(1) + 's · ' +
        (blob.size / 1048576).toFixed(1) + ' MB' + lateNote;
    }
  } catch (err) {
    g('vidStat').textContent = 'Failed: ' + (err && err.message ? err.message : err);
  } finally {
    recording = false;
    g('vidBtn').textContent = '\u25cf RECORD VIDEO';
    cv.width = pw; cv.height = ph; W = pw; H = ph;
    phase = phase0; roll = roll0;
    for (const ax of ['X', 'Y', 'Z']) {
      g('rot' + ax).value = rot0[ax].toFixed(1);
      g('rot' + ax).dispatchEvent(new Event('input'));
    }
  }
});

/* Automation hook: lets a headless harness step the phase deterministically
   to verify the loop is seamless. Harmless in normal use. */
window.__pleroma = {
  setPhase(v){ phase = v - Math.floor(v); },
  /* unwrapped, for the periodicity test: frame(p) must equal frame(p+1) */
  setPhaseRaw(v){ phase = v; },
  redraw(){ R.draw(W, H, scene(W, H)); },
  get phase(){ return phase; },
  /* resolved copy transforms, for the render harness to assert against */
  copyState(){ return copyTransforms(gf('lightZ')).map(c => ({
    R: Array.from(c.R).map(v => +v.toFixed(3)),
    T: Array.from(c.T), S: c.S,
    L: Array.from(c.L).map(v => +v.toFixed(2)) })); }
};

/* ── boot ── */
rebuildPalette();
rebuildLattice();
copySelRefresh();
g('boot').classList.add('done');
requestAnimationFrame(frame);
