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
export const MOTIF_COUNT = 32;

export const MOTIF_NAMES = [
  'rosette','dot rings','sunburst','eye','paisley','star mesh','mandala',
  'gear ring','scales','spiral','lotus','checker','filigree','beads',
  'crescents','compass',
  /* 16-31 — the second half leans to ALL-OVER patterns. The original
     sixteen were almost all centred medallions, which read as a grid of
     badges once tiled; a repeating field reads as fabric or inlay, and
     that mixture is what the reference imagery actually has. */
  'chevron','guilloche','honeycomb','plume','vine','sun face','harlequin',
  'fan','coins','ric-rac','quatrefoil','seigaiha','starfield','rope',
  'meander','shell'
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
    /* Row pitch must divide the cell, and because alternate rows are offset
       sideways the real vertical period is TWO rows — so the pitch is C/4,
       giving a period of C/2. The original 0.38*C divided into the cell
       2.63 times and left a hard seam along the top edge for the life of
       the tile. The loops also have to run past the cell on every side or
       the band nearest an edge is simply missing. */
    for (let row = -3; row <= 3; row++) {
      for (let col = -2; col <= 2; col++) {
        const cx = col*C*0.5 + (row&1 ? C*0.25 : 0), cy = row*C*0.25;
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
  case 15: /* compass rose */
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

  /* ── 16-31 ────────────────────────────────────────────────────────────
     The all-over patterns below are NOT stamped with wrap(). They are drawn
     directly on a lattice whose period divides C exactly, which makes them
     seamless by construction — a centred motif needs the nine-fold stamp
     because it spills past the cell, but a field that repeats every C/4
     already lines up with its own neighbour. */
  case 16: { /* chevron weave */
    const p16 = C/4;
    x.fillStyle = deep; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        x.save(); x.translate(col*p16, row*p16);
        x.beginPath();
        x.moveTo(-p16*0.5, p16*0.18); x.lineTo(0,-p16*0.30); x.lineTo(p16*0.5, p16*0.18);
        x.lineWidth = p16*0.20; x.strokeStyle = (row%2) ? gold : ivory; x.stroke();
        x.beginPath();
        x.moveTo(-p16*0.5, p16*0.46); x.lineTo(0, p16*0.0); x.lineTo(p16*0.5, p16*0.46);
        x.lineWidth = p16*0.09; x.strokeStyle = (row%2) ? mid : a1; x.stroke();
        x.restore();
      }
    }
    break; }
  case 17: { /* guilloche — interlaced circle band */
    const p17 = C/6;
    x.fillStyle = mid; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -3; row <= 3; row++) {
      for (let col = -4; col <= 4; col++) {
        const cx = col*p17 + ((row&1)?p17*0.5:0), cy = row*p17;
        x.beginPath(); x.arc(cx, cy, p17*0.72, 0, TAU);
        x.lineWidth = p17*0.11; x.strokeStyle = (col+row)%2 ? gold : ivory; x.stroke();
        x.beginPath(); x.arc(cx, cy, p17*0.40, 0, TAU);
        x.lineWidth = p17*0.07; x.strokeStyle = a1; x.stroke();
      }
    }
    break; }
  case 18: { /* honeycomb */
    const hx = C/3, hy = C/4;
    x.fillStyle = deep; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -4; row <= 4; row++) {
      for (let col = -3; col <= 3; col++) {
        const cx = col*hx + ((row&1)?hx*0.5:0), cy = row*hy;
        x.save(); x.translate(cx, cy);
        x.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i/6*TAU + Math.PI/6;
          const px = Math.cos(a)*hx*0.50, py = Math.sin(a)*hx*0.50;
          i ? x.lineTo(px,py) : x.moveTo(px,py);
        }
        x.closePath();
        x.fillStyle = (row+col)%3 ? mid : a2; x.fill();
        x.lineWidth = hx*0.07; x.strokeStyle = gold; x.stroke();
        x.beginPath(); x.arc(0,0,hx*0.13,0,TAU); x.fillStyle = ivory; x.fill();
        x.restore();
      }
    }
    break; }
  case 19: /* plume */
    wrap(x, C, () => {
      disc(R*0.97, deep);
      for (let i = 0; i < 14; i++) {
        x.save(); x.rotate(i/14*TAU);
        x.beginPath(); x.moveTo(0,0);
        x.bezierCurveTo(R*0.34,-R*0.26, R*0.76,-R*0.20, R*0.96,0);
        x.bezierCurveTo(R*0.76, R*0.20, R*0.34, R*0.26, 0,0);
        x.closePath();
        x.fillStyle = (i%2) ? mid : a2; x.fill();
        x.lineWidth = R*0.025; x.strokeStyle = gold; x.stroke();
        x.restore();
      }
      ring(R*0.97, R*0.04, gold);
      disc(R*0.20, ivory); ring(R*0.20, R*0.04, gold); disc(R*0.08, a1);
    });
    break;
  case 20: { /* vine lattice */
    const p20 = C/2;
    x.fillStyle = mid; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        x.save(); x.translate(col*p20, row*p20);
        x.beginPath();
        x.moveTo(-p20*0.5,0);
        x.bezierCurveTo(-p20*0.25,-p20*0.40, p20*0.25, p20*0.40, p20*0.5,0);
        x.lineWidth = p20*0.055; x.strokeStyle = gold; x.stroke();
        x.beginPath();
        x.moveTo(0,-p20*0.5);
        x.bezierCurveTo(-p20*0.40,-p20*0.25, p20*0.40, p20*0.25, 0, p20*0.5);
        x.lineWidth = p20*0.045; x.strokeStyle = ivory; x.stroke();
        for (const [lx,ly] of [[-0.22,-0.14],[0.22,0.14],[0.14,-0.26],[-0.14,0.26]]) {
          x.save(); x.translate(lx*p20, ly*p20);
          x.beginPath(); x.ellipse(0,0,p20*0.085,p20*0.045,Math.PI*0.25,0,TAU);
          x.fillStyle = a1; x.fill(); x.restore();
        }
        x.beginPath(); x.arc(0,0,p20*0.055,0,TAU); x.fillStyle = a2; x.fill();
        x.restore();
      }
    }
    break; }
  case 21: /* sun face */
    wrap(x, C, () => {
      disc(R*0.98, deep);
      for (let i = 0; i < 24; i++) {
        const L = (i%2) ? R*0.74 : R*0.98;
        x.save(); x.rotate(i/24*TAU);
        x.beginPath(); x.moveTo(R*0.48,-R*0.05); x.lineTo(L,0); x.lineTo(R*0.48,R*0.05);
        x.closePath(); x.fillStyle = (i%2) ? ivory : gold; x.fill(); x.restore();
      }
      disc(R*0.50, gold); ring(R*0.50, R*0.05, ivory);
      disc(R*0.40, mid);
      for (const sx of [-1, 1]) {
        x.beginPath(); x.ellipse(sx*R*0.17,-R*0.07,R*0.09,R*0.06,0,0,TAU);
        x.fillStyle = ivory; x.fill();
        x.beginPath(); x.arc(sx*R*0.17,-R*0.07,R*0.035,0,TAU);
        x.fillStyle = deep; x.fill();
      }
      x.beginPath(); x.arc(0, R*0.10, R*0.17, 0.15*Math.PI, 0.85*Math.PI);
      x.lineWidth = R*0.045; x.strokeStyle = a1; x.stroke();
    });
    break;
  case 22: { /* harlequin diamonds */
    const p22 = C/4;
    x.fillStyle = deep; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        const cx = col*p22 + ((row&1)?p22*0.5:0), cy = row*p22*0.5;
        x.save(); x.translate(cx, cy);
        x.beginPath();
        x.moveTo(0,-p22*0.30); x.lineTo(p22*0.5,0);
        x.lineTo(0,p22*0.30); x.lineTo(-p22*0.5,0); x.closePath();
        x.fillStyle = (row+col)%2 ? gold : mid; x.fill();
        x.lineWidth = p22*0.035; x.strokeStyle = ivory; x.stroke();
        x.beginPath(); x.arc(0,0,p22*0.07,0,TAU);
        x.fillStyle = (row+col)%2 ? deep : a1; x.fill();
        x.restore();
      }
    }
    break; }
  case 23: /* fan */
    wrap(x, C, () => {
      disc(R*0.96, mid);
      for (let i = 0; i < 9; i++) {
        x.save(); x.rotate(i/9*TAU);
        x.beginPath(); x.moveTo(0,0);
        x.arc(0,0,R*0.94, -0.28, 0.28);
        x.closePath();
        x.fillStyle = (i%2) ? deep : a2; x.fill();
        x.lineWidth = R*0.03; x.strokeStyle = gold; x.stroke();
        for (let k = 1; k <= 3; k++) {
          x.beginPath(); x.arc(0,0,R*0.94*k/3.6, -0.26, 0.26);
          x.lineWidth = R*0.022; x.strokeStyle = ivory; x.stroke();
        }
        x.restore();
      }
      disc(R*0.17, gold); ring(R*0.17, R*0.035, deep);
    });
    break;
  case 24: /* coins */
    wrap(x, C, () => {
      disc(R*0.97, deep);
      for (let i = 0; i < 6; i++) {
        const a = i/6*TAU;
        x.save(); x.translate(Math.cos(a)*R*0.56, Math.sin(a)*R*0.56);
        x.beginPath(); x.arc(0,0,R*0.33,0,TAU); x.fillStyle = gold; x.fill();
        x.lineWidth = R*0.035; x.strokeStyle = ivory; x.stroke();
        x.beginPath(); x.arc(0,0,R*0.17,0,TAU); x.fillStyle = mid; x.fill();
        x.restore();
      }
      disc(R*0.30, a2); ring(R*0.30, R*0.05, gold);
      disc(R*0.14, ivory);
      ring(R*0.96, R*0.04, gold);
    });
    break;
  case 25: { /* ric-rac */
    const p25 = C/4;
    x.fillStyle = mid; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -3; row <= 3; row++) {
      x.beginPath();
      for (let t = -5; t <= 5; t++) {      /* must overrun both side edges */
        const px = t*p25*0.5, py = row*p25 + ((t&1)?p25*0.22:-p25*0.22);
        t === -5 ? x.moveTo(px,py) : x.lineTo(px,py);
      }
      x.lineWidth = p25*0.17; x.strokeStyle = (row%2) ? gold : ivory; x.stroke();
      x.lineWidth = p25*0.06; x.strokeStyle = deep; x.stroke();
    }
    break; }
  case 26: { /* quatrefoil grid */
    const p26 = C/2;
    x.fillStyle = deep; x.fillRect(-C/2,-C/2,C,C);
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        x.save(); x.translate(col*p26, row*p26);
        x.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = i/4*TAU;
          x.arc(Math.cos(a)*p26*0.21, Math.sin(a)*p26*0.21, p26*0.21, 0, TAU);
        }
        x.fillStyle = (row+col)%2 ? mid : a2; x.fill();
        x.lineWidth = p26*0.035; x.strokeStyle = gold; x.stroke();
        x.beginPath(); x.arc(0,0,p26*0.10,0,TAU); x.fillStyle = ivory; x.fill();
        x.restore();
      }
    }
    break; }
  case 27: { /* seigaiha — overlapping concentric arcs */
    const w27 = C/4;
    x.fillStyle = deep; x.fillRect(-C/2,-C/2,C,C);
    /* each fan fills UPWARD from its centre only, so rows must continue a
       full fan-radius past the top of the cell or the top band is bare */
    for (let row = -5; row <= 5; row++) {
      for (let col = -3; col <= 3; col++) {
        const cx = col*w27 + ((row&1)?w27*0.5:0), cy = row*w27*0.5;
        x.save(); x.translate(cx, cy);
        for (let k = 4; k >= 1; k--) {
          x.beginPath(); x.arc(0,0,w27*0.5*k/4, Math.PI, 0);
          x.closePath();
          x.fillStyle = (k%2) ? mid : ((k===4)?a1:ivory); x.fill();
          x.lineWidth = w27*0.018; x.strokeStyle = gold; x.stroke();
        }
        x.restore();
      }
    }
    break; }
  case 28: /* starfield */
    wrap(x, C, () => {
      disc(R*0.97, deep);
      for (let k = 0; k < 3; k++) {
        const n = 6 + k*2, rr = R*(0.88 - k*0.26);
        for (let i = 0; i < n; i++) {
          const a = i/n*TAU + k*0.3;
          x.save(); x.translate(Math.cos(a)*rr, Math.sin(a)*rr);
          x.beginPath();
          for (let j = 0; j < 8; j++) {
            const aa = j/8*TAU, L = (j%2) ? R*0.05 : R*0.13;
            const px = Math.cos(aa)*L, py = Math.sin(aa)*L;
            j ? x.lineTo(px,py) : x.moveTo(px,py);
          }
          x.closePath(); x.fillStyle = (k%2) ? gold : ivory; x.fill();
          x.restore();
        }
      }
      disc(R*0.13, a2); ring(R*0.96, R*0.035, gold);
    });
    break;
  case 29: /* rope ring */
    wrap(x, C, () => {
      disc(R*0.97, mid);
      for (const [rr, lw, n] of [[R*0.84, R*0.13, 26], [R*0.52, R*0.10, 16]]) {
        for (let i = 0; i < n; i++) {
          const a0 = i/n*TAU, a1b = (i+0.72)/n*TAU;
          x.beginPath(); x.arc(0,0,rr,a0,a1b);
          x.lineWidth = lw; x.strokeStyle = (i%2) ? gold : ivory; x.stroke();
        }
      }
      ring(R*0.97, R*0.035, gold);
      disc(R*0.26, deep); ring(R*0.26, R*0.045, gold); disc(R*0.11, a1);
    });
    break;
  case 30: { /* meander — greek key */
    const p30 = C/4;
    x.fillStyle = deep; x.fillRect(-C/2,-C/2,C,C);
    x.lineCap = 'butt';
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        x.save(); x.translate(col*p30, row*p30);
        const u = p30/8;
        x.beginPath();
        x.moveTo(-4*u, 3*u); x.lineTo(-4*u,-2*u); x.lineTo(2*u,-2*u);
        x.lineTo(2*u, 1*u); x.lineTo(-1*u, 1*u); x.lineTo(-1*u,-0*u);
        x.lineWidth = u*0.9; x.strokeStyle = (row%2) ? gold : ivory; x.stroke();
        x.beginPath();
        x.moveTo(4*u,-3*u); x.lineTo(4*u, 2*u); x.lineTo(-2*u, 2*u);
        x.lineWidth = u*0.9; x.strokeStyle = a1; x.stroke();
        x.restore();
      }
    }
    x.lineCap = 'round';
    break; }
  default: /* shell */
    wrap(x, C, () => {
      disc(R*0.96, deep);
      for (let i = 0; i < 16; i++) {
        x.save(); x.rotate(i/16*TAU - Math.PI/2);
        x.beginPath(); x.moveTo(0, R*0.08);
        x.quadraticCurveTo(R*0.50, R*0.17, R*0.95, 0);
        x.quadraticCurveTo(R*0.50,-R*0.17, 0,-R*0.08);
        x.closePath();
        x.fillStyle = (i%2) ? mid : a2; x.fill();
        x.lineWidth = R*0.022; x.strokeStyle = gold; x.stroke();
        x.restore();
      }
      for (let k = 1; k <= 3; k++) ring(R*0.26*k, R*0.03, ivory);
      disc(R*0.15, gold); ring(R*0.96, R*0.04, gold);
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
