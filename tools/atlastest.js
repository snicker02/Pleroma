/* Render every atlas motif into one contact sheet, so new tiles can be
   checked for seams and legibility without hunting for them in a scene. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const ROOT = '/home/claude/pleroma3d', PORT = 8833;
const srv = http.createServer((rq, rs) => {
  const f = path.join(ROOT, rq.url === '/' ? '/index.html' : rq.url.split('?')[0]);
  if (!fs.existsSync(f)) { rs.writeHead(404); return rs.end('no'); }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  rs.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport:{ width: 1100, height: 1160 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForTimeout(3000);
  const info = await p.evaluate(async () => {
    const A = await import('./engine/atlas.js');
    const P = await import('./engine/palette.js');
    const pal = P.palArray(P.PALETTES[0]);
    const layers = A.buildAtlasLayers(pal);
    /* 2x2 of each tile, so a seam at the edge shows as a visible join */
    const cell = 128, cols = 8, rows = Math.ceil(layers.length/cols);
    const cv = document.createElement('canvas');
    cv.width = cols*cell; cv.height = rows*cell;
    const x = cv.getContext('2d');
    layers.forEach((L,i) => {
      const cx=(i%cols)*cell, cy=Math.floor(i/cols)*cell;
      for (let a=0;a<2;a++) for (let bb=0;bb<2;bb++)
        x.drawImage(L, cx+bb*cell/2, cy+a*cell/2, cell/2, cell/2);
      x.strokeStyle='#000'; x.lineWidth=1; x.strokeRect(cx+.5,cy+.5,cell-1,cell-1);
      x.fillStyle='#fff'; x.font='10px monospace';
      x.fillText(i+' '+A.MOTIF_NAMES[i], cx+4, cy+12);
    });
    document.body.innerHTML='';
    document.body.style.background='#111';
    document.body.appendChild(cv);
    return { n: layers.length, size: layers[0].width, names: A.MOTIF_NAMES.length };
  });
  console.log('motifs:', info.n, '| cell:', info.size, '| names:', info.names);
  await p.waitForTimeout(400);
  await p.screenshot({ path: process.argv[2] });
  console.log('wrote', process.argv[2]);
  await b.close(); srv.close();
})();
