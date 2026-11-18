/* ═══════════════════════════════════════════════════════════════════════════
   meshes.js — procedural ornament geometry
   ───────────────────────────────────────────────────────────────────────────
   Every wall form is a lathe (surface of revolution) with optional angular
   lobing. One generator covers domes, beads, finials, torii, rosettes, gears,
   starbursts and spires: the profile gives the silhouette, the lobe terms give
   petals / ribs / teeth.

   FLAT forms use the same generator with `flat: true`, which un-indexes the
   mesh and gives every triangle its own facet normal. That is the whole
   difference between a 4-segment lathe reading as a soft-shaded barrel and
   reading as a hard-edged box: the geometry is identical, only the normals
   differ. Combined with a low `segs` and `raw` (un-smoothed) profiles it
   yields genuine polyhedra — cubes, gems, obelisks, ziggurats.

   Each vertex carries a ZONE scalar in 0..1. Zone 0 takes the body material,
   zone 1 takes the accent, and the fragment shader mixes — which is what lets
   a single mesh read as two-tone inlay rather than a monochrome blob.

   Mesh 16 is the smooth swept TUBE used by the ribbon tier. Meshes 31..34 are
   swept PRISMS — the same sweep with a faceted cross-section and hard normals,
   for angular ribbons.
   ═════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* Catmull-Rom resample of [r, y, zone] control points -> smooth profile. */
function smoothProfile(ctrl, n) {
  const m = ctrl.length;
  const at = i => ctrl[Math.max(0, Math.min(m - 1, i))];
  const out = [];
  for (let s = 0; s < n; s++) {
    const t = (s / (n - 1)) * (m - 1);
    const i = Math.min(m - 2, Math.floor(t));
    const f = t - i;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const v = [];
    for (let c = 0; c < 3; c++) {
      const a = 2 * p1[c];
      const b = p2[c] - p0[c];
      const d = 2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c];
      const e = -p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c];
      v.push(0.5 * (a + b * f + d * f * f + e * f * f * f));
    }
    v[0] = Math.max(0, v[0]);
    v[2] = Math.max(0, Math.min(1, v[2]));
    out.push(v);
  }
  return out;
}

/* Circle profile for torus-like forms (closed loop, no poles). */
function ringProfile(R, t, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push([R + t * Math.cos(a), t * Math.sin(a), 0.5 + 0.5 * Math.cos(a)]);
  }
  return out;
}

/* Lobe shaping: p<1 squares the lobe off (gear teeth), p>1 sharpens it
   to a point (starburst). p=1 is a plain cosine (petals, ribs). */
function lobeTerm(theta, lobes, amp, p) {
  if (lobes <= 0 || amp === 0) return 1;
  const m = Math.cos(theta * lobes);
  const s = m < 0 ? -1 : 1;
  return 1 + amp * s * Math.pow(Math.abs(m), p);
}

/**
 * Revolve a profile into a triangle mesh.
 *
 * Duplicated consecutive profile points produce a zero-area quad band, which
 * contributes no normal — that is how a tube gets hard cap edges.
 *
 * `flat` un-indexes the result and assigns each triangle its own facet
 * normal, turning a coarse lathe into a true polyhedron. It costs ~6x the
 * vertices of the indexed form, which is why it is opt-in per form rather
 * than a global switch.
 */
export function lathe({ profile, closed = false, segs = 30,
                        lobes = 0, lobeAmp = 0, lobePow = 1, flat = false,
                        twist = 0 }) {
  const rows = profile.length, cols = segs;
  const vCount = rows * cols;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const zon = new Float32Array(vCount);
  const uv  = new Float32Array(vCount * 2);   /* u around, v along profile */

  for (let i = 0; i < rows; i++) {
    const [r, y, z] = profile[i];
    /* a per-row angular offset shears the lathe into a twisted prism */
    const off = twist * (rows > 1 ? i / (rows - 1) : 0);
    for (let j = 0; j < cols; j++) {
      const th = (j / cols) * TAU + off;
      const rr = r * lobeTerm(th - off, lobes, lobeAmp, lobePow);
      const k = (i * cols + j) * 3;
      pos[k] = rr * Math.cos(th);
      pos[k + 1] = y;
      pos[k + 2] = rr * Math.sin(th);
      zon[i * cols + j] = z;
      uv[(i * cols + j) * 2]     = j / cols;
      uv[(i * cols + j) * 2 + 1] = rows > 1 ? i / (rows - 1) : 0;
    }
  }

  const idx = [];
  const rowMax = closed ? rows : rows - 1;
  for (let i = 0; i < rowMax; i++) {
    const i1 = (i + 1) % rows;
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % cols;
      idx.push(i * cols + j, i * cols + j1, i1 * cols + j1,
               i * cols + j, i1 * cols + j1, i1 * cols + j);
    }
  }

  if (flat) return unindexFlat(pos, zon, uv, idx);

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (let v = 0; v < vCount; v++) {
    const k = v * 3;
    const L = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]);
    if (L > 1e-9) { nrm[k] /= L; nrm[k + 1] /= L; nrm[k + 2] /= L; }
    else { nrm[k] = 0; nrm[k + 1] = 1; nrm[k + 2] = 0; }
  }
  return { pos, nrm, zon, uv, idx: new Uint32Array(idx) };
}

/** Split every triangle into its own 3 vertices carrying the facet normal. */
function unindexFlat(pos, zon, uv, idx) {
  const n = idx.length;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const Z = new Float32Array(n);
  const U = new Float32Array(n * 2);
  const I = new Uint32Array(n);
  for (let t = 0; t < n; t += 3) {
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L > 1e-12) { nx /= L; ny /= L; nz /= L; } else { nx = 0; ny = 1; nz = 0; }
    const src = [ia, ib, ic];
    for (let s = 0; s < 3; s++) {
      const o = t + s, so = src[s];
      P[o * 3] = pos[so * 3]; P[o * 3 + 1] = pos[so * 3 + 1]; P[o * 3 + 2] = pos[so * 3 + 2];
      N[o * 3] = nx; N[o * 3 + 1] = ny; N[o * 3 + 2] = nz;
      Z[o] = zon[so];
      U[o * 2] = uv[so * 2]; U[o * 2 + 1] = uv[so * 2 + 1];
      I[o] = o;
    }
  }
  return { pos: P, nrm: N, zon: Z, uv: U, idx: I };
}

/* ── the ornament vocabulary ─────────────────────────────────────────────── */
const P = {
  dome:   [[0,1,1],[.55,.92,1],[.92,.55,.55],[1,.08,.28],[1.02,-.06,0],[.6,-.1,0],[0,-.1,0]],
  bead:   [[0,.8,.2],[.5,.72,.8],[.88,.3,1],[.92,0,1],[.88,-.3,1],[.5,-.72,.8],[0,-.8,.2]],
  onion:  [[0,1.35,1],[.18,1.1,1],[.52,.78,.65],[.78,.42,.35],[.72,.1,.2],[.5,-.05,.6],[.56,-.18,.95],[0,-.2,0]],
  disc:   [[0,.14,1],[.7,.14,1],[.95,.1,.5],[1,0,.15],[.95,-.1,.5],[.7,-.14,1],[0,-.14,1]],
  bell:   [[0,.9,1],[.22,.85,1],[.45,.55,.6],[.72,.12,.3],[1,-.25,.1],[1.05,-.32,.85],[.95,-.35,.85],[0,-.35,0]],
  spindle:[[0,1.1,1],[.3,.7,.5],[.45,.2,.18],[.45,-.2,.18],[.3,-.7,.5],[0,-1.1,1]],
  cup:    [[0,-.55,0],[.35,-.52,.4],[.25,-.25,.7],[.5,.1,.9],[.85,.5,1],[.9,.6,.45],[0,.6,.2]],
  tower:  [[0,1.25,1],[.16,1.05,1],[.16,.85,.35],[.38,.8,.85],[.34,.45,.3],[.56,.4,.9],
           [.5,0,.3],[.74,-.05,.9],[.68,-.45,.28],[.9,-.5,.9],[0,-.55,.2]],
  vase:   [[0,-.7,0],[.4,-.68,.3],[.3,-.4,.5],[.62,0,.9],[.5,.45,.6],[.3,.62,.3],[.42,.75,1],[0,.78,.5]],
  spire:  [[0,1.5,1],[.12,1,.8],[.3,.4,.4],[.5,-.1,.2],[.62,-.4,.85],[0,-.45,.2]],
  boss:   [[0,.5,1],[.35,.46,1],[.5,.25,.6],[.52,.05,.3],[.9,0,.95],[.95,-.12,.95],[.5,-.15,.2],[0,-.16,0]],
  pad:    [[0,.08,.9],[.55,.08,.9],[.8,.04,.4],[.84,0,.15],[.8,-.04,.4],[.55,-.08,.9],[0,-.08,.9]],

  /* curved additions */
  acorn:  [[0,.95,1],[.3,.82,.9],[.55,.5,.45],[.6,.12,.3],[.52,-.2,.85],[.34,-.5,.95],[0,-.62,.4]],
  urn:    [[0,-.62,0],[.46,-.6,.35],[.34,-.42,.6],[.5,-.1,.95],[.62,.26,.7],[.4,.52,.35],
           [.3,.6,.9],[.46,.68,1],[.38,.74,.4],[0,.76,.2]],
  ogee:   [[0,1.1,1],[.26,.98,.9],[.4,.72,.35],[.3,.44,.5],[.46,.2,.9],[.7,-.08,.45],
           [.78,-.3,.9],[.5,-.4,.3],[0,-.44,0]],
  lotus:  [[0,.3,.2],[.4,.34,.7],[.78,.3,1],[1.0,.12,.5],[1.04,-.02,.15],[.72,-.12,.6],[0,-.16,.2]],
  crownP: [[0,.62,.3],[.5,.6,.9],[.62,.36,.4],[.56,.08,.25],[.78,-.04,.9],[.8,-.2,.95],[.44,-.26,.25],[0,-.28,0]],
  taper:  [[0,1.0,1],[.42,.56,.55],[.6,.02,.3],[.66,-.42,.8],[0,-.5,.25]],

  /* raw (un-smoothed) profiles for the polyhedral forms — Catmull-Rom would
     round the corners straight back off these */
  box:    [[0,.8,.15],[.78,.8,.15],[.78,.8,.9],[.78,-.8,.9],[.78,-.8,.15],[0,-.8,.15]],
  gem:    [[0,1.15,1],[.62,.34,.75],[.78,.06,.25],[.6,-.3,.75],[0,-1.0,1]],
  obelisk:[[0,1.5,1],[.2,1.12,.85],[.34,1.02,.3],[.34,-.8,.55],[.44,-.86,.95],[.44,-.95,.2],[0,-.95,0]],
  zigg:   [[0,.72,.2],[.34,.72,.9],[.34,.42,.25],[.6,.42,.9],[.6,.12,.25],
           [.84,.12,.9],[.84,-.2,.25],[1.0,-.2,.9],[1.0,-.36,.2],[0,-.36,0]],
  lantern:[[0,.86,.25],[.4,.78,.9],[.64,.62,.3],[.64,-.42,.55],[.4,-.6,.9],[.52,-.7,.3],[0,-.74,0]],
  wedge:  [[0,.92,1],[.52,.5,.4],[.52,-.5,.4],[0,-.92,1]],
  bolt:   [[0,.5,.2],[.92,.5,.95],[.92,-.5,.95],[0,-.5,.2]],

  /* ── second wave ── */
  trumpet:[[0,-.72,.2],[.22,-.68,.6],[.2,-.2,.3],[.34,.3,.6],[.72,.72,.95],[.86,.8,.35],[0,.82,.15]],
  teardrop:[[0,1.2,1],[.28,.62,.6],[.46,.14,.3],[.5,-.3,.7],[.3,-.62,.95],[0,-.72,.4]],
  bobbin: [[0,.78,.5],[.52,.74,.95],[.44,.56,.3],[.22,.2,.2],[.22,-.2,.2],[.44,-.56,.3],[.52,-.74,.95],[0,-.78,.5]],
  cushion:[[0,.46,.3],[.42,.42,.8],[.74,.26,.5],[.84,0,.2],[.74,-.26,.5],[.42,-.42,.8],[0,-.46,.3]],
  thistle:[[0,1.1,1],[.24,.78,.8],[.5,.46,.45],[.56,.06,.25],[.42,-.26,.7],[.5,-.5,.95],[.3,-.66,.5],[0,-.72,.2]],
  stupa:  [[0,1.3,1],[.1,1.05,.9],[.26,.92,.3],[.2,.74,.6],[.46,.6,.9],[.4,.3,.3],[.68,.1,.85],[.76,-.3,.4],[.86,-.42,.9],[0,-.46,.2]],
  chalice:[[0,-.8,0],[.3,-.78,.4],[.18,-.56,.6],[.16,-.1,.25],[.34,.1,.7],[.66,.5,.95],[.7,.66,.4],[0,.68,.2]],
  knop:   [[0,.6,.4],[.3,.56,.9],[.26,.34,.3],[.5,.14,.85],[.5,-.14,.85],[.26,-.34,.3],[.3,-.56,.9],[0,-.6,.4]],

  /* raw, for the faceted forms */
  prismP: [[0,.9,.2],[.62,.9,.9],[.62,-.9,.9],[0,-.9,.2]],
  spike:  [[0,1.4,1],[.46,.1,.5],[.46,-.3,.5],[0,-.52,.9]],
  anvil:  [[0,.5,.2],[.5,.5,.9],[.5,.18,.3],[.86,.02,.9],[.86,-.18,.3],[.5,-.34,.9],[.5,-.5,.2],[0,-.5,.2]],
  step3:  [[0,.84,.2],[.4,.84,.9],[.4,.5,.25],[.72,.5,.9],[.72,.1,.25],[1.0,.1,.9],[1.0,-.3,.2],[0,-.3,0]],
  octa:   [[0,1.05,1],[.72,0,.6],[0,-1.05,1]],
  rhomb:  [[0,.95,1],[.5,.34,.5],[.5,-.34,.5],[0,-.95,1]]
};

export const TUBE_MESH = 16;

/* Cage struts run from vertex A to vertex B, so unlike every other form they
   are modelled from 0 to 1 along +Y rather than centred on the origin: the
   instance sits AT A, a quaternion turns +Y onto the edge direction, and the
   length scale stretches it to reach B. A centred bar would need its
   midpoint computed and would still have to be stretched, so this is one
   fewer thing to get wrong. */
export let STRUT_MESHES = [];   /* filled from MESH_DEFS below */

/* ── swept-tube template ──────────────────────────────────────────────────
   Mesh 16 is not a cylinder. It is a parametric grid: aPos carries
   (cos(theta), t, sin(theta)) with t in 0..1 running the length of the tube.
   The vertex shader maps t onto the ring coordinate and evaluates the curve
   there, so the surface sits exactly on the helix at every sample.

   The old approach instanced short straight cylinders along the curve. That
   can only ever be a chain of tubes: straight between samples, kinked at each
   joint, with flat caps showing wherever the curve bends. A single swept
   surface bends continuously, which is what a snake does.

   aNrm carries the CROSS-SECTION normal, which the shader rotates into the
   curve frame. For the round tube that equals the corner direction, so the
   shading is unchanged; for a prism it is the facet normal, which is what
   makes the bar read as flat-sided rather than soft.
───────────────────────────────────────────────────────────────────────────*/
const TUBE_ALONG = 800;   /* samples down the length — smoothness           */
const TUBE_AROUND = 14;   /* samples around the circumference               */

function sweptTubeTemplate() {
  const R = TUBE_ALONG, C = TUBE_AROUND;
  const n = R * C;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const zon = new Float32Array(n);
  const uv  = new Float32Array(n * 2);
  for (let i = 0; i < R; i++) {
    const t = i / (R - 1);
    for (let j = 0; j < C; j++) {
      const th = (j / C) * TAU;
      const k = (i * C + j);
      pos[k*3] = Math.cos(th); pos[k*3+1] = t; pos[k*3+2] = Math.sin(th);
      nrm[k*3] = Math.cos(th); nrm[k*3+1] = 0; nrm[k*3+2] = Math.sin(th);
      zon[k] = 0.5 + 0.5 * Math.cos(th * 3.0);
      uv[k*2] = j / C;          /* around */
      uv[k*2+1] = t;            /* along, scaled in the shader */
    }
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < C; j++) {
      const j1 = (j + 1) % C;
      const a = i*C + j, b = i*C + j1, c = (i+1)*C + j1, d = (i+1)*C + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  return { pos, nrm, zon, uv, idx: new Uint32Array(idx) };
}

/* ── swept-prism template ─────────────────────────────────────────────────
   A bar with `sides` flat faces instead of a round tube. Each facet gets its
   OWN pair of corner vertices carrying that facet's normal, so neighbouring
   faces never share a normal and the edge between them stays hard. That
   duplication is the entire point: a prism built from a shared corner ring
   would be smooth-shaded and read as a lumpy tube.

   Fewer samples along than the round tube: an angular ribbon is normally
   driven by the stepped path, where the visible geometry is a short polyline
   and extra samples collapse into degenerate quads.
───────────────────────────────────────────────────────────────────────────*/
/* Sized for the WORST CASE corner count, not the default one. The stepped
   path snaps each sample to a corner, so if the template carries fewer
   samples than there are corners the polygon silently loses corners and
   stops matching the HARD ANGLES setting. Worst case is
   (max rings + 3) * max steps = (44 + 3) * 16 = 752. */
const PRISM_ALONG = 768;

/* A bar from y=0 to y=1, waisted toward the middle by `taper` so a strut
   reads as a spar rather than a pipe, with collars at both ends where it
   meets a vertex ornament. */
function strutMesh({ sides, taper, flat }) {
  const prof = [
    [0,          0.0,  0.15],
    [0.50,       0.0,  0.95],
    [0.40,       0.05, 0.35],
    [0.32*taper, 0.26, 0.6 ],
    [0.32*taper, 0.74, 0.6 ],
    [0.40,       0.95, 0.35],
    [0.50,       1.0,  0.95],
    [0,          1.0,  0.15]
  ];
  return lathe({ profile: prof, segs: sides, flat });
}

function sweptPrismTemplate(sides) {
  const R = PRISM_ALONG, C = sides * 2;   /* two corner verts per facet */
  const n = R * C;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const zon = new Float32Array(n);
  const uv  = new Float32Array(n * 2);
  for (let i = 0; i < R; i++) {
    const t = i / (R - 1);
    for (let f = 0; f < sides; f++) {
      const a0 = (f / sides) * TAU, a1 = ((f + 1) / sides) * TAU;
      const am = (a0 + a1) * 0.5;                 /* facet outward normal */
      const nx = Math.cos(am), nz = Math.sin(am);
      for (let s = 0; s < 2; s++) {
        const a = s ? a1 : a0;
        const k = i * C + f * 2 + s;
        pos[k*3] = Math.cos(a); pos[k*3+1] = t; pos[k*3+2] = Math.sin(a);
        nrm[k*3] = nx;          nrm[k*3+1] = 0; nrm[k*3+2] = nz;
        zon[k] = 0.5 + 0.5 * Math.cos(am * 3.0);
        uv[k*2] = (f + s) / sides;
        uv[k*2+1] = t;
      }
    }
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let f = 0; f < sides; f++) {
      const a = i * C + f * 2, b = a + 1;
      const c = (i + 1) * C + f * 2 + 1, d = (i + 1) * C + f * 2;
      idx.push(a, b, c, a, c, d);
    }
  }
  return { pos, nrm, zon, uv, idx: new Uint32Array(idx) };
}

/* Mesh table. 0..15 wall forms, 16 the round tube, 17..30 further wall
   forms, 31..34 the prism bars. Indices below 17 are frozen: lattice.js
   and the saved FORM SET lists refer to them by number. */
export const MESH_DEFS = [
  { name:'dome',      profile:P.dome,    rows:11, segs:18 },
  { name:'bead',      profile:P.bead,    rows:10, segs:14 },
  { name:'onion',     profile:P.onion,   rows:13, segs:16 },
  { name:'torus',     ring:[.72,.3,12],  segs:18 },
  { name:'disc',      profile:P.disc,    rows:9,  segs:20 },
  { name:'bell',      profile:P.bell,    rows:12, segs:16 },
  { name:'spindle',   profile:P.spindle, rows:10, segs:14 },
  { name:'cup',       profile:P.cup,     rows:11, segs:16 },
  { name:'tower',     profile:P.tower,   rows:15, segs:14 },
  { name:'vase',      profile:P.vase,    rows:12, segs:16 },
  { name:'rosette',   profile:P.pad,     rows:8,  segs:40, lobes:8,  lobeAmp:.34, lobePow:1 },
  { name:'ribbedDome',profile:P.dome,    rows:11, segs:42, lobes:14, lobeAmp:.07, lobePow:1 },
  { name:'gear',      profile:P.disc,    rows:8,  segs:54, lobes:18, lobeAmp:.14, lobePow:.30 },
  { name:'starburst', profile:P.pad,     rows:7,  segs:48, lobes:6,  lobeAmp:.62, lobePow:2.2 },
  { name:'spire',     profile:P.spire,   rows:10, segs:14 },
  { name:'boss',      profile:P.boss,    rows:9,  segs:16 },

  { name:'tube',      swept:true },                                  /* 16 */

  /* curved additions */
  { name:'acorn',     profile:P.acorn,   rows:11, segs:16 },         /* 17 */
  { name:'urn',       profile:P.urn,     rows:13, segs:16 },         /* 18 */
  { name:'ogee',      profile:P.ogee,    rows:12, segs:16 },         /* 19 */
  { name:'lotusPad',  profile:P.lotus,   rows:9,  segs:44, lobes:12, lobeAmp:.26, lobePow:1.4 },
  { name:'crown',     profile:P.crownP,  rows:10, segs:48, lobes:9,  lobeAmp:.3,  lobePow:.35 },
  { name:'fluted',    profile:P.taper,   rows:10, segs:46, lobes:20, lobeAmp:.06, lobePow:1 },
  { name:'quatrefoil',profile:P.pad,     rows:8,  segs:44, lobes:4,  lobeAmp:.46, lobePow:1.5 },

  /* polyhedral — raw profiles, low segment counts, facet normals */
  { name:'cube',      profile:P.box,     raw:true, segs:4,  flat:true },   /* 24 */
  { name:'gem',       profile:P.gem,     raw:true, segs:6,  flat:true },   /* 25 */
  { name:'obelisk',   profile:P.obelisk, raw:true, segs:4,  flat:true },   /* 26 */
  { name:'ziggurat',  profile:P.zigg,    raw:true, segs:4,  flat:true },   /* 27 */
  { name:'lantern',   profile:P.lantern, raw:true, segs:6,  flat:true },   /* 28 */
  { name:'wedge',     profile:P.wedge,   raw:true, segs:3,  flat:true },   /* 29 */
  { name:'hexNut',    profile:P.bolt,    raw:true, segs:6,  flat:true },   /* 30 */

  /* swept prism bars for angular ribbons */
  { name:'bar3',      prism:3 },                                     /* 31 */
  { name:'bar4',      prism:4 },                                     /* 32 */
  { name:'bar6',      prism:6 },                                     /* 33 */
  { name:'bar8',      prism:8 },                                     /* 34 */

  /* ── second wave: 35-49 ── */
  { name:'trumpet',   profile:P.trumpet,  rows:12, segs:16 },
  { name:'teardrop',  profile:P.teardrop, rows:11, segs:16 },
  { name:'bobbin',    profile:P.bobbin,   rows:12, segs:14 },
  { name:'cushion',   profile:P.cushion,  rows:10, segs:18 },
  { name:'thistle',   profile:P.thistle,  rows:12, segs:16 },
  { name:'stupa',     profile:P.stupa,    rows:15, segs:14 },
  { name:'chalice',   profile:P.chalice,  rows:13, segs:16 },
  { name:'knop',      profile:P.knop,     rows:12, segs:16 },
  /* lobed variants — the lobe terms are what turn a plain silhouette into
     ornament, and they were only ever applied to four of the original forms */
  { name:'thistleRib',profile:P.thistle,  rows:12, segs:48, lobes:16, lobeAmp:.08, lobePow:1 },
  { name:'cushionStar',profile:P.cushion, rows:10, segs:50, lobes:10, lobeAmp:.3,  lobePow:1.8 },
  { name:'cogWheel',  profile:P.bolt,     raw:true, segs:60, lobes:20, lobeAmp:.12, lobePow:.25 },
  { name:'twistBar',  profile:P.prismP,   raw:true, segs:6,  flat:true, twist:0.7 },
  { name:'spikeBall', profile:P.spike,    raw:true, segs:5,  flat:true },
  { name:'anvil',     profile:P.anvil,    raw:true, segs:4,  flat:true },
  { name:'step3',     profile:P.step3,    raw:true, segs:6,  flat:true },
  { name:'octa',      profile:P.octa,     raw:true, segs:4,  flat:true },
  { name:'rhomb',     profile:P.rhomb,    raw:true, segs:6,  flat:true },

  /* ── cage struts: modelled 0..1 along +Y ── */
  { name:'strutRound', strut:{ sides:12, taper:0.62, flat:false } },   /* 51 */
  { name:'strutFacet', strut:{ sides:6,  taper:0.62, flat:true  } },   /* 52 */
  { name:'strutBox',   strut:{ sides:4,  taper:1.0,  flat:true  } }    /* 53 */
];

/** Mesh index of each prism bar, by side count. 0 = the round tube. */
export const RIB_MESH = { 0: TUBE_MESH, 3: 31, 4: 32, 6: 33, 8: 34 };

/** Samples along each swept template — the corner budget for a stepped path. */
export const SWEEP_SAMPLES = { tube: TUBE_ALONG, prism: PRISM_ALONG };

/* Index lookups are DERIVED from the table, never written down twice. The
   first version of this listed the strut indices by hand and was wrong the
   moment a form was added above them, pointing the cage at an ornament. */
STRUT_MESHES = MESH_DEFS.map((d, i) => d.strut ? i : -1).filter(i => i >= 0);

export function buildMeshes() {
  return MESH_DEFS.map(d => {
    if (d.swept) return { name: d.name, ...sweptTubeTemplate() };
    if (d.prism) return { name: d.name, ...sweptPrismTemplate(d.prism) };
    if (d.strut) return { name: d.name, ...strutMesh(d.strut) };
    const profile = d.ring  ? ringProfile(d.ring[0], d.ring[1], d.ring[2])
                  : d.raw   ? d.profile
                            : smoothProfile(d.profile, d.rows);
    return {
      name: d.name,
      ...lathe({
        profile,
        closed: !!d.ring,
        segs: d.segs,
        lobes: d.lobes || 0,
        lobeAmp: d.lobeAmp || 0,
        lobePow: d.lobePow || 1,
        flat: !!d.flat,
        twist: d.twist || 0
      })
    };
  });
}

/* groupings offered in the UI — the tube and the bars are never wall forms */
export const MESH_SETS = [
  { name: 'ALL CURVED',      idx: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
  { name: 'ALL ANGULAR',     idx: [24,25,26,27,28,29,30] },
  { name: 'MIXED',           idx: [0,1,3,24,25,17,27,13] },
  { name: 'DOMES & FINIALS', idx: [0,2,5,11,14,15] },
  { name: 'BEADS & RINGS',   idx: [1,3,4,12,15,10] },
  { name: 'TOWERS & VESSELS',idx: [8,9,6,2,14,5] },
  { name: 'ROSETTES & STARS',idx: [10,13,12,4,11,3] },
  { name: 'BLOOMS',          idx: [20,21,22,23,10,13] },
  { name: 'VESSELS II',      idx: [17,18,19,9,7,6] },
  { name: 'CRYSTALLINE',     idx: [25,29,26,24,14,2] },
  { name: 'MACHINED',        idx: [30,24,27,12,4,22] },
  { name: 'MINIMAL',         idx: [0,1,3] },
  { name: 'EVERYTHING',      idx: [0,2,5,10,13,17,20,24,26,35,39,44,47,50] },
  { name: 'RELIQUARY',       idx: [40,41,35,39,18,2] },
  { name: 'SPINDLES',        idx: [36,37,42,6,1,38] },
  { name: 'SHARDS',          idx: [47,49,50,46,25,29] },
  { name: 'GEARWORKS',       idx: [45,30,12,48,24,37] },
  { name: 'LOBED',           idx: [43,44,21,20,13,10] }
];
