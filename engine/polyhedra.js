/* ═══════════════════════════════════════════════════════════════════════════
   polyhedra.js — vertex and edge sets for the cage tier
   ───────────────────────────────────────────────────────────────────────────
   Every solid is given as a vertex list only. Edges are DERIVED, by finding
   the shortest distance between any two vertices and connecting every pair at
   that distance. For a uniform polyhedron that is exactly the edge set, and
   it saves hand-typing connectivity tables that are tedious to get right and
   silently wrong when they are not — a mistyped index in a 30-edge list
   produces a strut to nowhere that is easy to miss and annoying to find.

   All vertices are projected onto the unit sphere, so the cage tier can scale
   one radius and have every solid behave the same way.
   ═════════════════════════════════════════════════════════════════════════ */

const PHI = (1 + Math.sqrt(5)) / 2;

const norm = v => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/L, v[1]/L, v[2]/L];
};

/** All sign combinations of the given magnitudes. */
function signs(x, y, z) {
  const out = [];
  for (const a of (x ? [x,-x] : [0]))
    for (const b of (y ? [y,-y] : [0]))
      for (const c of (z ? [z,-z] : [0])) out.push([a,b,c]);
  return out;
}

/** The three cyclic rotations of a coordinate triple, with all sign choices. */
function cyclic(x, y, z) {
  return [...signs(x,y,z), ...signs(z,x,y), ...signs(y,z,x)];
}

function dedupe(vs) {
  const out = [];
  for (const v of vs) {
    if (!out.some(w => Math.hypot(w[0]-v[0], w[1]-v[1], w[2]-v[2]) < 1e-6)) out.push(v);
  }
  return out;
}

/** Connect every vertex pair at the minimum pairwise distance. */
function deriveEdges(V) {
  let min = Infinity;
  for (let i = 0; i < V.length; i++)
    for (let j = i+1; j < V.length; j++) {
      const d = Math.hypot(V[i][0]-V[j][0], V[i][1]-V[j][1], V[i][2]-V[j][2]);
      if (d < min) min = d;
    }
  const lim = min * 1.02;
  const E = [];
  for (let i = 0; i < V.length; i++)
    for (let j = i+1; j < V.length; j++) {
      const d = Math.hypot(V[i][0]-V[j][0], V[i][1]-V[j][1], V[i][2]-V[j][2]);
      if (d <= lim) E.push([i, j]);
    }
  return E;
}

/** Triangular faces of a triangulated solid: mutually adjacent triples. */
function deriveTriangles(V, E) {
  const adj = V.map(() => new Set());
  E.forEach(([a,b]) => { adj[a].add(b); adj[b].add(a); });
  const F = [];
  for (let a = 0; a < V.length; a++)
    for (const b of adj[a]) { if (b <= a) continue;
      for (const c of adj[b]) { if (c <= b) continue;
        if (adj[a].has(c)) F.push([a,b,c]);
      }
    }
  return F;
}

const BASE = {
  tetra:  () => [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],
  cube:   () => signs(1,1,1),
  octa:   () => [...signs(1,0,0), ...signs(0,1,0), ...signs(0,0,1)],
  icosa:  () => cyclic(0,1,PHI),
  dodeca: () => [...signs(1,1,1), ...cyclic(0, 1/PHI, PHI)],
  cubocta:() => cyclic(1,1,0),
  icosidodeca: () => [...cyclic(0,0,PHI), ...cyclic(0.5, PHI/2, PHI*PHI/2)]
};

/** Subdivide each triangle `n` times and reproject onto the sphere.
 *  Returns edges built from the FACES, not by distance: reprojecting a
 *  subdivided triangle onto the sphere leaves two distinct edge lengths, so
 *  the min-distance rule that is exact for a uniform solid finds only the
 *  shorter class — a 2V sphere came out with 60 of its 120 struts. */
function geodesic(n) {
  let V = dedupe(BASE.icosa().map(norm));
  let F = deriveTriangles(V, deriveEdges(V));
  for (let pass = 0; pass < n; pass++) {
    const nextF = [];
    const key = (a,b) => a < b ? a+'_'+b : b+'_'+a;
    const mid = new Map();
    const midpoint = (a,b) => {
      const k = key(a,b);
      if (mid.has(k)) return mid.get(k);
      const m = norm([(V[a][0]+V[b][0])/2, (V[a][1]+V[b][1])/2, (V[a][2]+V[b][2])/2]);
      V.push(m);
      const idx = V.length - 1;
      mid.set(k, idx);
      return idx;
    };
    for (const [a,b,c] of F) {
      const ab = midpoint(a,b), bc = midpoint(b,c), ca = midpoint(c,a);
      nextF.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);
    }
    F = nextF;
  }
  const seen = new Set(), E = [];
  for (const f of F)
    for (let i = 0; i < 3; i++) {
      const a = f[i], b = f[(i+1)%3];
      const k = a < b ? a+'_'+b : b+'_'+a;
      if (!seen.has(k)) { seen.add(k); E.push([a,b]); }
    }
  return { V, E };
}

/** Names in UI order; the index is what the control stores. */
export const CAGE_NAMES = [
  'OFF', 'TETRAHEDRON', 'CUBE', 'OCTAHEDRON', 'ICOSAHEDRON', 'DODECAHEDRON',
  'CUBOCTAHEDRON', 'ICOSIDODECAHEDRON', 'GEODESIC 2V', 'GEODESIC 3V'
];

const BUILDERS = [
  null,
  () => BASE.tetra(),
  () => BASE.cube(),
  () => BASE.octa(),
  () => BASE.icosa(),
  () => BASE.dodeca(),
  () => BASE.cubocta(),
  () => BASE.icosidodeca(),
  () => geodesic(1),
  () => geodesic(2)
];

/* builders that already know their own connectivity */
const HAS_EDGES = new Set([8, 9]);

const cache = new Map();

/**
 * Vertices (unit sphere) and derived edges for cage type `i`.
 * @returns {{V:number[][], E:number[][]}|null} null when the cage is off
 */
export function cage(i) {
  if (!i || i >= BUILDERS.length) return null;
  if (cache.has(i)) return cache.get(i);
  let out;
  if (HAS_EDGES.has(i)) {
    out = BUILDERS[i]();
  } else {
    const V = dedupe(BUILDERS[i]().map(norm));
    out = { V, E: deriveEdges(V) };
  }
  cache.set(i, out);
  return out;
}

/** Shortest-arc quaternion taking +Y to `d` (assumed unit length). */
export function quatYTo(d) {
  const dot = d[1];                       /* dot((0,1,0), d) */
  if (dot > 0.999999) return [0,0,0,1];
  if (dot < -0.999999) return [0,0,1,0];  /* 180 deg about Z */
  /* axis = cross((0,1,0), d) */
  const ax = d[2], ay = 0, az = -d[0];
  const s = Math.sqrt((1 + dot) * 2);
  return [ax/s, ay/s, az/s, s/2];
}
