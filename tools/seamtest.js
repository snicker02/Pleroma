/* Seam check. A tile is seamless when the wrap edge is no more of a
   discontinuity than an ordinary interior step: compare |col0 - colC-1| to
   the mean |col_i - col_i+1| inside the tile, and likewise for rows. A ratio
   near 1 means the join is invisible; a large ratio is a hard seam. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html':'text/html', '.js':'text/javascript' };
const ROOT = '/home/claude/pleroma3d', PORT = 8834;
const srv = http.createServer((rq, rs) => {
  const f = path.join(ROOT, rq.url === '/' ? '/index.html' : rq.url.split('?')[0]);
  if (!fs.existsSync(f)) { rs.writeHead(404); return rs.end('no'); }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  rs.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport:{ width: 300, height: 300 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForTimeout(3000);
  const res = await p.evaluate(async () => {
    const A = await import('./engine/atlas.js');
    const P = await import('./engine/palette.js');
    const layers = A.buildAtlasLayers(P.palArray(P.PALETTES[0]));
    const out = [];
    for (let i = 0; i < layers.length; i++) {
      const C = layers[i].width;
      const d = layers[i].getContext('2d').getImageData(0,0,C,C).data;
      const px = (x,y) => { const o=(((y+C)%C)*C+((x+C)%C))*4; return [d[o],d[o+1],d[o+2]]; };
      const diff = (a,b) => Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);

      /* Step between every pair of ADJACENT rows, including the wrap pair.
         A seamless tile is one where the wrap step is unremarkable among
         the others — comparing it to the MEAN is wrong, because a sparse
         pattern has mostly flat rows and a few hard edges, so the mean is
         near zero and any real edge at the wrap looks catastrophic. The
         95th percentile is the fair question: is this step larger than the
         sharpest ordinary detail in the tile? */
      const rowStep = [], colStep = [];
      for (let y = 0; y < C; y++) {
        let sx = 0, sy = 0;
        for (let k = 0; k < C; k++) { sy += diff(px(k,y), px(k,y+1)); sx += diff(px(y,k), px(y+1,k)); }
        rowStep.push(sy/C); colStep.push(sx/C);
      }
      const wrapY = rowStep[C-1], wrapX = colStep[C-1];
      const p95 = arr => { const a=[...arr].sort((m,n)=>m-n); return a[Math.floor(a.length*0.95)]; };
      out.push({ i, name: A.MOTIF_NAMES[i],
                 wy: wrapY, wx: wrapX, py: p95(rowStep), pxx: p95(colStep) });
    }
    return out;
  });

  let bad = [];
  console.log('wrap = step across the tile join; p95 = 95th-percentile ordinary step (0-765)');
  for (const r of res) {
    /* flag only when the join is a sharper edge than 95% of the tile's own
       detail AND is big enough to see at all */
    const seamY = r.wy > Math.max(r.py*1.6, 20);
    const seamX = r.wx > Math.max(r.pxx*1.6, 20);
    if (seamY || seamX) bad.push(r.i + ' ' + r.name + (seamX?' [x]':'') + (seamY?' [y]':''));
    console.log(String(r.i).padStart(2), r.name.padEnd(11),
      'wrapX', r.wx.toFixed(1).padStart(6), '/p95', r.pxx.toFixed(1).padStart(6),
      '  wrapY', r.wy.toFixed(1).padStart(6), '/p95', r.py.toFixed(1).padStart(6),
      (seamX||seamY) ? '  <-- SEAM' : '');
  }
  console.log(bad.length ? '\nSEAMS: ' + bad.join(', ')
                         : '\nPASS - every tile wraps cleanly');
  await b.close(); srv.close();
})();
