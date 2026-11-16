/* ═══════════════════════════════════════════════════════════════════════════
   atlas.js — procedural ornament texture
   ───────────────────────────────────────────────────────────────────────────
   THE THING THAT WAS MISSING.

   In the reference imagery the richness lives on the SURFACES: every form is
   printed with flat ornament — mandalas, dot rings, spirals, eyes, scales,
   filigree. The solids themselves are few and simple. An earlier version of
   this engine put the complexity in geometry instead (thousands of smooth
   lathes with sine-wave banding) and read as a pile of ceramic.

   So: 16 ornament tiles drawn once to a 4x4 texture atlas at load, then
   UV-mapped onto the solids and tiled across them.

   Every tile is SEAMLESS. Each motif is stamped nine times — centre plus all
   eight neighbours — and clipped to the cell, so whatever crosses one edge
   reappears on the opposite one. Without that the tiling shows a hard grid.
   ═════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

export const ATLAS_N = 4;                       /* 4x4 grid of tiles        */
export const ATLAS_CELL = 512;
export const ATLAS_PX = ATLAS_N * ATLAS_CELL;
export const MOTIF_COUNT = 16;

export const MOTIF_NAMES = [
  'rosette','dot rings','sunburst','eye','paisley','star mesh','mandala',
  'gear ring','scales','spiral','lotus','checker','filigree','beads',
  'crescents','compass'
];

/* stamp a drawing at the centre and all eight neighbour offsets, so the tile
   wraps seamlessly in both directions */
function wrap(x, C, draw) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      x.save(); x.translate(dx * C, dy * C); draw(x); x.restore();
    }
  }
}

/* Secondary ornament on the half-offset lattice, so the gaps between the
   main motifs carry pattern too. Drawn at the four tile corners, which the
   centre motif never reaches. Two scales of ornament instead of one. */
function interstitial(x, idx, C, P) {
  const [deep, mid, gold, ivory, a1, a2] = P;
  const r = C * 0.17;
  for (const [dx, dy] of [[-0.5,-0.5],[0.5,-0.5],[-0.5,0.5],[0.5,0.5]]) {
    x.save(); x.translate(dx*C, dy*C);
    const k = idx % 4;
    if (k === 0) {
      x.beginPath(); x.arc(0,0,r,0,TAU); x.fillStyle = deep; x.fill();
      x.beginPath(); x.arc(0,0,r*0.62,0,TAU); x.lineWidth=r*0.18; x.strokeStyle=gold; x.stroke();
      x.beginPath(); x.arc(0,0,r*0.22,0,TAU); x.fillStyle=a1; x.fill();
    } else if (k === 1) {
      for (let i = 0; i < 8; i++) {
        const a = i/8*TAU;
        x.beginPath(); x.arc(Math.cos(a)*r*0.66, Math.sin(a)*r*0.66, r*0.20, 0, TAU);
        x.fillStyle = i%2 ? gold : ivory; x.fill();
      }
      x.beginPath(); x.arc(0,0,r*0.26,0,TAU); x.fillStyle=deep; x.fill();
    } else if (k === 2) {
      x.save(); x.rotate(Math.PI/4);
      x.fillStyle = deep; x.fillRect(-r*0.62,-r*0.62,r*1.24,r*1.24);
      x.lineWidth = r*0.16; x.strokeStyle = gold;
      x.strokeRect(-r*0.62,-r*0.62,r*1.24,r*1.24);
      x.restore();
      x.beginPath(); x.arc(0,0,r*0.24,0,TAU); x.fillStyle=a2; x.fill();
    } else {
      for (let i = 0; i < 6; i++) {
        x.save(); x.rotate(i/6*TAU);
        x.beginPath(); x.ellipse(r*0.52,0,r*0.34,r*0.16,0,0,TAU);
        x.fillStyle = i%2 ? ivory : a1; x.fill(); x.restore();
      }
      x.beginPath(); x.arc(0,0,r*0.28,0,TAU); x.fillStyle=gold; x.fill();
    }
    x.restore();
  }
}

function makeTile(x, idx, C, P) {
  const [deep, mid, gold, ivory, a1, a2] = P;
  const R = C * 0.46;
  const ring = (r, w, c) => { x.beginPath(); x.arc(0,0,r,0,TAU); x.lineWidth=w; x.strokeStyle=c; x.stroke(); };
  const disc = (r, c) => { x.beginPath(); x.arc(0,0,r,0,TAU); x.fillStyle=c; x.fill(); };
  const dots = (r, n, rad, c, ph) => {
    for (let i = 0; i < n; i++) {
      const a = (i/n)*TAU + (ph||0);
      x.beginPath(); x.arc(Math.cos(a)*r, Math.sin(a)*r, rad, 0, TAU);
      x.fillStyle = c; x.fill();
    }
  };
  const petals = (n, r0, r1, w, c, ph) => {
    for (let i = 0; i < n; i++) {
      x.save(); x.rotate((i/n)*TAU + (ph||0));
      x.beginPath(); x.moveTo(r0,0);
      x.quadraticCurveTo(r1*0.6, w, r1, 0);
      x.quadraticCurveTo(r1*0.6,-w, r0, 0);
      x.closePath(); x.fillStyle=c; x.fill(); x.restore();
    }
  };
  const star = (n, skip, r, c, lw) => {
    x.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = ((i*skip)%n)/n*TAU - Math.PI/2;
      const px=Math.cos(a)*r, py=Math.sin(a)*r;
      i ? x.lineTo(px,py) : x.moveTo(px,py);
    }
    x.closePath(); x.lineWidth=lw; x.strokeStyle=c; x.stroke();
  };

  switch (idx) {
  case 0:  /* rosette */
    wrap(x, C, () => {
      disc(R, mid);
      petals(12, R*0.18, R*0.96, R*0.16, gold, 0);
      petals(12, R*0.14, R*0.62, R*0.11, ivory, Math.PI/12);
      disc(R*0.27, deep); ring(R*0.27, R*0.05, gold); disc(R*0.12, a1);
      ring(R*0.97, R*0.04, gold);
    });
    break;
  case 1:  /* concentric dotted rings */
    wrap(x, C, () => {
      disc(R, deep);
      ring(R*0.86, R*0.05, gold); ring(R*0.62, R*0.035, ivory); ring(R*0.40, R*0.045, gold);
      dots(R*0.74, 20, R*0.045, ivory, 0);
      dots(R*0.51, 14, R*0.038, a1, 0.2);
      dots(R*0.28, 8,  R*0.05,  gold, 0);
      disc(R*0.13, ivory);
    });
    break;
  case 2:  /* sunburst */
    wrap(x, C, () => {
      disc(R*0.97, deep);
      for (let i = 0; i < 32; i++) {
        x.save(); x.rotate(i/32*TAU);
        x.beginPath(); x.moveTo(R*0.34,-R*0.035); x.lineTo(R*0.98,0); x.lineTo(R*0.34,R*0.035);
        x.closePath(); x.fillStyle = (i%2)?gold:ivory; x.fill(); x.restore();
      }
      disc(R*0.36, gold); ring(R*0.36, R*0.05, ivory); disc(R*0.20, a1); disc(R*0.09, ivory);
    });
    break;
  case 3:  /* eye */
    wrap(x, C, () => {
      const lid = () => {
        x.beginPath(); x.moveTo(-R,0);
        x.quadraticCurveTo(0,-R*0.78, R,0);
        x.quadraticCurveTo(0, R*0.78,-R,0); x.closePath();
      };
      lid(); x.fillStyle = ivory; x.fill();
      x.save(); lid(); x.clip();
      disc(R*0.44, a2); ring(R*0.44, R*0.07, gold);
      disc(R*0.31, mid); disc(R*0.16, '#07070a');
      x.beginPath(); x.arc(-R*0.10,-R*0.10,R*0.07,0,TAU); x.fillStyle=ivory; x.fill();
      x.restore();
      lid(); x.lineWidth = R*0.06; x.strokeStyle = gold; x.stroke();
    });
    break;
  case 4:  /* paisley */
    wrap(x, C, () => {
      x.save();
      x.beginPath(); x.moveTo(0,-R*0.95);
      x.bezierCurveTo(R*0.82,-R*0.55, R*0.72,R*0.55, -R*0.05,R*0.92);
      x.bezierCurveTo(-R*0.82,R*0.50, -R*0.64,-R*0.35, 0,-R*0.95);
      x.closePath(); x.fillStyle=mid; x.fill();
      x.lineWidth=R*0.07; x.strokeStyle=gold; x.stroke();
      x.clip();
      for (let i = 0; i < 5; i++) {
        x.beginPath(); x.arc(0,R*0.12,R*(0.70-i*0.13),0,TAU);
        x.lineWidth=R*0.045; x.strokeStyle = i%2?ivory:a1; x.stroke();
      }
      dots(R*0.45, 10, R*0.05, gold, 0.3);
      x.restore();
      disc(R*0.12, ivory);
    });
    break;
  case 5:  /* star mesh */
    wrap(x, C, () => {
      disc(R*0.97, deep); ring(R*0.96, R*0.04, gold);
      star(12,5,R*0.88,gold,R*0.045);
      star(12,5,R*0.62,ivory,R*0.035);
      star(8,3,R*0.40,a1,R*0.04);
      disc(R*0.15, gold);
    });
    break;
  case 6:  /* dotted mandala */
    wrap(x, C, () => {
      disc(R*0.98, mid);
      for (let k = 0; k < 4; k++)
        dots(R*(0.86-k*0.19), 24-k*5, R*(0.055-k*0.008), k%2?gold:ivory, k*0.13);
      ring(R*0.96, R*0.035, gold);
      disc(R*0.14, a1); ring(R*0.14, R*0.03, ivory);
    });
    break;
  case 7:  /* gear ring */
    wrap(x, C, () => {
      disc(R*0.95, deep);
      for (let i = 0; i < 18; i++) {
        x.save(); x.rotate(i/18*TAU);
        x.fillStyle = gold; x.fillRect(R*0.70,-R*0.075,R*0.27,R*0.15); x.restore();
      }
      ring(R*0.70, R*0.09, gold); ring(R*0.54, R*0.04, ivory);
      disc(R*0.40, mid); dots(R*0.40, 6, R*0.065, a2, 0); disc(R*0.17, gold);
    });
    break;
  case 8:  /* scales — offset rows, drawn directly for a clean lap */
    for (let row = -1; row <= 2; row++) {
      for (let col = -1; col <= 2; col++) {
        const cx = col*C*0.5 + (row&1 ? C*0.25 : 0), cy = row*C*0.38;
        x.save(); x.translate(cx, cy);
        x.beginPath(); x.arc(0,0,C*0.30,Math.PI,0); x.closePath();
        x.fillStyle = (row+col)%2 ? mid : deep; x.fill();
        x.lineWidth = C*0.016; x.strokeStyle = gold; x.stroke();
        x.beginPath(); x.arc(0,0,C*0.17,Math.PI,0);
        x.lineWidth = C*0.012; x.strokeStyle = a1; x.stroke();
        x.beginPath(); x.arc(0,-C*0.04,C*0.035,0,TAU); x.fillStyle = ivory; x.fill();
        x.restore();
      }
    }
    break;
  case 9:  /* spiral */
    wrap(x, C, () => {
      disc(R*0.97, deep);
      for (let s = 0; s < 3; s++) {
        x.beginPath();
        for (let t = 0; t < 150; t++) {
          const u=t/149, a=u*TAU*2.3+s*TAU/3, rr=R*0.10+u*R*0.85;
          const px=Math.cos(a)*rr, py=Math.sin(a)*rr;
          t ? x.lineTo(px,py) : x.moveTo(px,py);
        }
        x.lineWidth=R*0.085; x.strokeStyle = s===1?ivory:gold; x.stroke();
      }
      disc(R*0.13, a2);
    });
    break;
  case 10: /* lotus */
    wrap(x, C, () => {
      disc(R*0.97, deep);
      petals(8, R*0.10, R*0.96, R*0.26, mid, 0);
      petals(8, R*0.10, R*0.96, R*0.10, gold, 0);
      petals(8, R*0.08, R*0.60, R*0.17, ivory, Math.PI/8);
      petals(8, R*0.06, R*0.38, R*0.10, a1, 0);
      disc(R*0.14, gold);
    });
    break;
  case 11: /* checker ring */
    wrap(x, C, () => {
      disc(R*0.97, ivory);
      for (let i = 0; i < 24; i++) {
        const a0=i/24*TAU, a1b=(i+1)/24*TAU;
        x.beginPath(); x.arc(0,0,R*0.96,a0,a1b); x.arc(0,0,R*0.62,a1b,a0,true);
        x.closePath(); x.fillStyle = (i%2)?deep:gold; x.fill();
      }
      ring(R*0.62, R*0.045, gold); disc(R*0.56, mid);
      dots(R*0.36, 8, R*0.07, ivory, 0); disc(R*0.16, a1);
    });
    break;
  case 12: /* filigree arcs */
    wrap(x, C, () => {
      disc(R*0.97, mid);
      for (let i = 0; i < 8; i++) {
        x.save(); x.rotate(i/8*TAU);
        x.beginPath(); x.moveTo(R*0.16,0);
        x.bezierCurveTo(R*0.55,R*0.30, R*0.80,R*0.16, R*0.94,0);
        x.lineWidth=R*0.055; x.strokeStyle=gold; x.stroke();
        x.beginPath(); x.moveTo(R*0.16,0);
        x.bezierCurveTo(R*0.55,-R*0.30, R*0.80,-R*0.16, R*0.94,0);
        x.lineWidth=R*0.04; x.strokeStyle=ivory; x.stroke();
        x.restore();
      }
      ring(R*0.96, R*0.04, gold); dots(R*0.80, 16, R*0.035, a1, 0.2);
      disc(R*0.17, deep); ring(R*0.17, R*0.035, gold);
    });
    break;
  case 13: /* beaded ring */
    wrap(x, C, () => {
      disc(R*0.95, deep);
      ring(R*0.78, R*0.055, gold);
      dots(R*0.78, 18, R*0.085, ivory, 0);
      dots(R*0.78, 18, R*0.040, a2, 0);
      dots(R*0.48, 10, R*0.07, gold, 0.3);
      disc(R*0.24, mid); ring(R*0.24, R*0.04, ivory); disc(R*0.10, a1);
    });
    break;
  case 14: /* crescent cluster */
    wrap(x, C, () => {
      disc(R*0.95, deep);
      for (let i = 0; i < 6; i++) {
        x.save(); x.rotate(i/6*TAU); x.translate(R*0.52,0);
        x.beginPath(); x.arc(0,0,R*0.33,0,TAU); x.fillStyle=(i%2)?gold:ivory; x.fill();
        x.globalCompositeOperation='destination-out';
        x.beginPath(); x.arc(R*0.16,0,R*0.27,0,TAU); x.fill();
        x.globalCompositeOperation='source-over';
        x.restore();
      }
      ring(R*0.94, R*0.035, gold); disc(R*0.20, a1); ring(R*0.20, R*0.035, ivory);
    });
    break;
  default: /* compass rose */
    wrap(x, C, () => {
      disc(R*0.96, ivory);
      for (let i = 0; i < 8; i++) {
        const L = (i%2)?R*0.58:R*0.96;
        x.save(); x.rotate(i/8*TAU);
        x.beginPath(); x.moveTo(0,0); x.lineTo(L,-R*0.10); x.lineTo(L,0);
        x.closePath(); x.fillStyle=deep; x.fill();
        x.beginPath(); x.moveTo(0,0); x.lineTo(L, R*0.10); x.lineTo(L,0);
        x.closePath(); x.fillStyle=gold; x.fill();
        x.restore();
      }
      ring(R*0.96, R*0.045, gold); ring(R*0.70, R*0.025, a1);
      disc(R*0.16, a2); ring(R*0.16, R*0.035, deep);
    });
    break;
  }
}

/** One canvas per motif, for upload as a TEXTURE_2D_ARRAY layer.
 *
 *  A single 4x4 atlas sheet cannot be mipmapped: at coarse levels every cell
 *  bleeds into its neighbours, so a form small on screen samples the average
 *  of all sixteen tiles and turns to mud. One layer per motif keeps the mip
 *  chain clean, and lets the sampler REPEAT in hardware — no fract(), no
 *  textureGrad, no seam at the tile boundary.
 *
 *  `pal` is [deep, mid, gold, ivory, accent1, accent2].
 */
export function buildAtlasLayers(pal) {
  const C = ATLAS_CELL;
  const out = [];
  for (let i = 0; i < MOTIF_COUNT; i++) {
    const cv = document.createElement('canvas');
    cv.width = C; cv.height = C;
    const x = cv.getContext('2d');
    /* ground: the mid tone, never the void — a near-black ground leaves most
       of the tile dead and the solids read as unlit lumps */
    x.fillStyle = pal[1]; x.fillRect(0, 0, C, C);
    x.save();
    x.beginPath(); x.rect(0, 0, C, C); x.clip();
    x.translate(C/2, C/2);
    x.lineJoin = 'round'; x.lineCap = 'round';
    interstitial(x, i, C, pal);
    makeTile(x, i, C, pal);
    x.restore();
    out.push(cv);
  }
  return out;
}
