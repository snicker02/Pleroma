/* ═══════════════════════════════════════════════════════════════════════════
   lattice.js — recursive placement
   ───────────────────────────────────────────────────────────────────────────
   Two generators feed one instance stream.

   1. THE TUNNEL (self-similar in depth)

      Ring e sits at physical radius R0·λ^e and physical distance D0·μ^e from
      the camera, at scale S0·λ^e. Under a perspective camera a feature of
      size s at distance d subtends s/d, so both on-screen size and on-screen
      radius shrink by the same factor q = λ/μ per ring. Finite rings,
      unbounded apparent depth.

        q = on-screen contraction per ring
        f = "funnel", splitting q between receding and narrowing:
            μ = (1/q)^(1−f),  λ = q^f
            f=0 straight cylinder (all depth) · f=1 flat spiral (no depth)

   2. THE BRANCH IFS (self-similar in space)

      Each wall position is the root of a contraction IFS. Every node spawns
      `branches` children; each child is the parent transform composed with a
      fixed rotate-tilt-offset-shrink map. Applying ONE map repeatedly is what
      makes the cluster an actual fractal rather than a two-level decoration:
      the depth-3 cloud is a scaled copy of the depth-2 cloud, which is a
      scaled copy of the depth-1 cloud.

      Node count per wall position is (b^(d+1) − 1)/(b − 1), so it climbs
      fast — depth 3 at 4 branches is 85 solids per spoke.

   3. THE RIBBON TIER

      Helices winding down the tunnel wall, swept as instanced tube segments.
      The segment's frame comes from the analytic tangent of the curve
      (computed in the vertex shader), so segments stay aligned end to end on
      any twist rate. Radial wobble uses integer harmonics of the ring
      coordinate, and beads ride an integer-per-ring lattice — both so that
      every sub-tier's period divides one ring. See the RANGE RULE below.

   GUARD INVARIANT
      Every tier's MINIMUM ringE must be <= -2, so the one-ring band that
      appears at the near end on each wrap lies entirely below -1, where the
      vertex shader's near guard is zero. That is why the brick and shell
      offsets are subtracted rather than added: a positive offset lifts a
      tier's minimum into the fading region and that tier pops into view at
      partial scale. buildLattice checks this and warns.

   SEAMLESSNESS
      Every per-instance property must be a function of the spoke index, the
      shell/ribbon index, and the CONTINUOUS ring coordinate e — never of the
      integer ring index k. That alone is not sufficient: the ring set itself
      shifts by one at the wrap, gaining a ring at the near end and losing one
      at the far end. The vertex shader scales both ends to zero so neither is
      visible when it changes. looptest.js checks this.
   ═════════════════════════════════════════════════════════════════════════ */

import { cage, quatYTo } from './polyhedra.js';
import { STRUT_MESHES } from './meshes.js';

const TAU = Math.PI * 2;

function hash(i, s) {
  const x = Math.sin(i * 127.1 + s * 311.7 + 13.7) * 43758.5453;
  return x - Math.floor(x);
}

export function solveTunnel(q, f) {
  return { lambda: Math.pow(q, f), mu: Math.pow(1 / q, 1 - f) };
}

/* ── quaternion helpers (x, y, z, w) ── */
function qAxis(ax, ay, az, ang) {
  const h = ang * 0.5, s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}
function qMul(a, b) {
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
  ];
}
function qRot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx)
  ];
}

export function buildLattice(p) {
  const {
    rings, spokes, shells, shellStep, seed, meshSet, ribMesh = 16, motifs = 16,
    depth, branches, contraction, orbit, branchTilt, levelSpin, tileU, tileV,
    selfSim,
    brick, variety, hueSpread, spinSpread, tilt,
    ribbons, ribTurn, ribRadius, ribWobble, ribHarm, ribBeads,
    ribCross, ribCrossR, ribCrossTurn,
    cageType = 0, cageR = 1.0, cageVertForm = 0, cageVertScale = 1,
    cageStrut = 0, cageStrutR = 0.5, cageStruts = true, cageMid = false
  } = p;

  const buckets = new Map();
  /* iA ringE,theta0,scale,mode | iB offX,offY,offZ,hue
     iC qx,qy,qz,qw             | iD shellR,bodyMix,tubeR,turnRate
     iE motif,tileU,tileV,spare                                    */
  const push = (mesh, A, B, C, D, E) => {
    let a = buckets.get(mesh);
    if (!a) { a = []; buckets.set(mesh, a); }
    a.push(A[0],A[1],A[2],A[3], B[0],B[1],B[2],B[3],
           C[0],C[1],C[2],C[3], D[0],D[1],D[2],D[3],
           E[0],E[1],E[2],E[3]);
  };
  /* each form gets its own ornament tile and tiling rate; deeper branch
     levels tile finer, which is what keeps detail alive as they shrink */
  const orn = (h, lvl) => [
    Math.floor(h * 16) % 16,
    Math.max(1, Math.round(tileU * (1 + lvl * 0.5))),
    Math.max(1, Math.round(tileV * (1 + lvl * 0.5))),
    0
  ];

  /* ── 1 + 2 : wall positions, each carrying a branch IFS ── */
  for (let sh = 0; sh < shells; sh++) {
    const shellR = Math.pow(shellStep, sh);
    const shellPhase = -sh * 0.37;   /* must be <= 0, see GUARD INVARIANT */

    for (let k = rings - 1; k >= -2; k--) {
      for (let j = 0; j < spokes; j++) {
        const id = j + sh * 977;
        const h3 = hash(id + 217.7, seed), h4 = hash(id + 403.1, seed);

        const ringE = k - ((j & 1) ? brick * 0.5 : 0) + shellPhase;
        const th0   = (j / spokes) * TAU + (sh * 0.5 / spokes) * TAU;
        const hue   = (h3 - 0.5) * hueSpread;

        /* Iterate the IFS breadth-first from the wall root.
           SELF-SIMILARITY is what makes the cluster read as a fractal rather
           than as a heap of assorted objects: a child inherits its parent's
           FORM and its ornament tile, so the same shape recurs at every
           scale. Give every node an independent random mesh and the
           recursion is still mathematically there but invisible. */
        const rootH = hash(id * 7.1, seed);
        const rootV = hash(id * 13.7, seed);
        let level = [{
          off: [0, 0, 0], q: [0, 0, 0, 1], scale: 1, n: 0,
          mesh: (rootV < variety) ? meshSet[(rootH * meshSet.length) | 0] : meshSet[0],
          motif: Math.floor(rootH * motifs) % motifs
        }];
        for (let L = 0; L <= depth; L++) {
          for (const node of level) {
            push(node.mesh,
              [ringE, th0, node.scale, 0],
              [node.off[0], node.off[1], node.off[2],
               hue + (node.n * 0.137 % 1 - 0.5) * hueSpread * 1.5 * L],
              node.q,
              [shellR, hash(id * 13.7 + node.n * 47.3, seed), 0, 0],
              [node.motif,
               Math.max(1, Math.round(tileU * (1 + L * 0.5))),
               Math.max(1, Math.round(tileV * (1 + L * 0.5))), 0]);
          }
          if (L === depth) break;

          const next = [];
          for (const node of level) {
            for (let i = 0; i < branches; i++) {
              const hb = hash(id * 5.9 + node.n * 101.1 + i * 7.7 + L * 53.3, seed);
              const a = (i / branches) * TAU + L * levelSpin
                      + (h4 - 0.5) * spinSpread * TAU + hb * spinSpread;
              const t = branchTilt * (1 + (hb - 0.5) * tilt);
              /* local map: yaw about the node's own axis, then tilt away */
              const local = qMul(qAxis(0, 1, 0, a), qAxis(1, 0, 0, t));
              const q = qMul(node.q, local);
              /* child sits one orbit-radius along the child's own up axis */
              const dir = qRot(q, [0, 1, 0]);
              const hs = hash(id * 17.3 + node.n * 5.1 + i * 23.9, seed);
              const inherit = hs < selfSim;
              next.push({
                off: [node.off[0] + dir[0] * orbit * node.scale,
                      node.off[1] + dir[1] * orbit * node.scale,
                      node.off[2] + dir[2] * orbit * node.scale],
                q, scale: node.scale * contraction,
                n: node.n * branches + i + 1,
                mesh:  inherit ? node.mesh  : meshSet[(hb * meshSet.length) | 0],
                motif: inherit ? node.motif : Math.floor(hb * motifs) % motifs
              });
            }
          }
          level = next;
        }
      }
    }
  }

  /* ── 3 : ribbon helices, swept as tube segments ──
     RANGE RULE (learned the hard way): the generated e-range must extend a
     full ring past each guard's zero point. On the wrap the whole lattice
     slides by one ring, so a band one ring wide appears at the near end and
     another is lost at the far end. The wall tier gets away with starting at
     k=-2 because its spacing is a whole ring, so the single element that
     appears lands exactly on the guard's zero. A finely-spaced tier does not:
     starting at -2 made ten segments appear spread across [-2,-1.1], the
     last of them at 41% scale — a clear pop. Starting at -3 puts every
     appearing segment at e <= -2.1, where the guard is already zero.

     Beads ride their own e-lattice at an integer count per ring. Spacing them
     by "every Nth segment" keyed placement to the integer segment index, so
     the one-ring slide moved every bead by (ribSegs mod N) slots. Any tier
     whose period divides one ring is safe; one keyed to an index is not. */
  const ribStart = -3;
  const ribSpan  = rings + 3;

  /* Two families of helix. The main set all wind the same way at the same
     radius, so they are parallel and can never meet. The CROSSING set winds
     the opposite way; at the same radius the two families genuinely
     intersect, and CROSS RADIUS offsets them if you want them to weave past
     each other instead of through. */
  const fam = [
    { n: ribbons,  turn:  ribTurn,                shell: 1.0,       tag: 0 },
    { n: ribCross, turn: -ribTurn * ribCrossTurn, shell: ribCrossR, tag: 977 }
  ];

  for (const F of fam) {
    for (let h = 0; h < F.n; h++) {
      const th0 = (h / Math.max(F.n, 1)) * TAU;
      const hr  = hash(h + 611.3 + F.tag, seed);
      const hue = (hr - 0.5) * hueSpread;

      /* ONE instance per ribbon: mesh 16 is a swept-tube template whose t
         the vertex shader maps onto the ring coordinate, so the surface is
         continuous along the whole curve. */
      /* ribMesh is the round tube (16) or one of the prism bars (31..34);
         both ride the same mode-1 swept path, they differ only in the
         cross-section the template carries */
      push(ribMesh,
        [ribStart, th0, 1, 1],
        [0, 0, 0, hue],
        [0, 0, 0, 1],
        [F.shell, hr, ribRadius, F.turn],
        [Math.floor(hr * 16) % 16, Math.max(1, Math.round(tileU)),
         Math.max(1, Math.round(tileV)), 0]);

      if (ribBeads > 0) {
        const beadStep = 1 / ribBeads;
        const nBead = Math.round(ribSpan * ribBeads);
        for (let i = 0; i < nBead; i++) {
          const e = ribStart + i * beadStep;
          const hb = hash(h * 31.7 + i * 3.1 + F.tag, seed);
          push(meshSet[(hb * meshSet.length) | 0],
            [e, th0, ribRadius * 2.6, 2],          /* 2 = ribbon rider */
            [0, 0, 0, hue + (hb - 0.5) * hueSpread],
            qAxis(0, 1, 0, hb * TAU),
            [F.shell, hb, ribRadius, F.turn],
            orn(hb, 0));
        }
      }
    }
  }

  /* ── 4 : the cage ──────────────────────────────────────────────────────
     A polyhedral frame centred on the tunnel axis, one per ring. The ring
     range matches every other tier, down to -2, so the GUARD INVARIANT holds
     and both ends of the set are invisible when the phase wraps.

     Thinning to "every Nth ring" happens in the SHADER as a function of e,
     not here by skipping rings: skipping would key placement to an integer
     ring index, which is the bug that moved every bead on each wrap. */
  const poly = cage(cageType);
  if (poly) {
    const strutMesh = STRUT_MESHES[Math.min(cageStrut, STRUT_MESHES.length - 1)];
    const vertMesh  = meshSet[cageVertForm % meshSet.length];

    for (let k = rings - 1; k >= -2; k--) {
      const ringE = k;

      /* vertex ornaments, standing off the sphere along the outward normal */
      for (let vi = 0; vi < poly.V.length; vi++) {
        const v = poly.V[vi];
        const h = hash(vi * 31.7 + 11.3, seed);
        push(vertMesh,
          [ringE, 0, cageVertScale, 3],
          [v[0], v[1], v[2], (h - 0.5) * hueSpread],
          quatYTo(v),
          [cageR, h, 0, 0],                 /* iD.z = 0 -> ornament scale */
          orn(h, 0));
      }

      /* struts along every edge: sit at A, +Y turned onto B - A */
      if (cageStruts) {
        for (let ei = 0; ei < poly.E.length; ei++) {
          const [a, b] = poly.E[ei];
          const A = poly.V[a], B = poly.V[b];
          const dx = B[0]-A[0], dy = B[1]-A[1], dz = B[2]-A[2];
          const len = Math.hypot(dx, dy, dz) || 1e-6;
          const h = hash(ei * 17.9 + 5.1, seed);
          push(strutMesh,
            [ringE, 0, 1, 3],
            [A[0], A[1], A[2], (h - 0.5) * hueSpread * 0.5],
            quatYTo([dx/len, dy/len, dz/len]),
            [cageR, h, len, cageStrutR],    /* iD.z = length on the cage */
            orn(h, 1));
        }
      }

      /* optional ornament at each edge midpoint, pushed back out to the
         sphere so the ring of them reads as a band rather than a dented one */
      if (cageMid) {
        for (let ei = 0; ei < poly.E.length; ei++) {
          const [a, b] = poly.E[ei];
          const A = poly.V[a], B = poly.V[b];
          let m = [(A[0]+B[0])/2, (A[1]+B[1])/2, (A[2]+B[2])/2];
          const L = Math.hypot(m[0], m[1], m[2]) || 1;
          m = [m[0]/L, m[1]/L, m[2]/L];
          const h = hash(ei * 23.3 + 71.7, seed);
          push(vertMesh,
            [ringE, 0, cageVertScale * 0.62, 3],
            [m[0], m[1], m[2], (h - 0.5) * hueSpread],
            quatYTo(m),
            [cageR, h, 0, 0],
            orn(h, 1));
        }
      }
    }
  }

  /* GUARD INVARIANT check — cheap, and it catches the whole class of bug */
  let minE = Infinity;
  for (const arr of buckets.values())
    for (let i = 0; i < arr.length; i += 20) minE = Math.min(minE, arr[i]);
  if (minE > -2 + 1e-6)
    console.warn('[pleroma] guard invariant broken: min ringE =', minE,
                 '(must be <= -2, or near-end tiers pop on the phase wrap)');

  let total = 0;
  const out = [];
  for (const [meshIdx, arr] of buckets) {
    const count = arr.length / 20;
    total += count;
    out.push({ meshIdx, count, data: new Float32Array(arr) });
  }
  out.sort((a, b) => a.meshIdx - b.meshIdx);

  /* nodes per wall position, for the UI's instance-count warning */
  const perSpoke = branches === 1
    ? depth + 1
    : (Math.pow(branches, depth + 1) - 1) / (branches - 1);

  return { buckets: out, total, perSpoke, minE, ribStart, ribSpan };
}
