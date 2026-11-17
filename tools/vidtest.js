/* Headless check of the video exporter: records a short clip, confirms a
   file actually lands, and reports which container the browser gave us.
   Playwright's Chromium ships without the H.264 encoder, so MP4 is expected
   to be unavailable here — that exercises the AUTO fallback path, which is
   exactly what a Firefox user hits. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const ROOT = __dirname;
const PORT = 8822;

const srv = http.createServer((rq, rs) => {
  const f = path.join(ROOT, rq.url === '/' ? '/index.html' : rq.url.split('?')[0]);
  if (!fs.existsSync(f)) { rs.writeHead(404); return rs.end('nope'); }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  rs.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const ctx = await b.newContext({ viewport: { width: 420, height: 740 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForTimeout(3500);

  /* what can this browser actually record? */
  const probe = await p.evaluate(async () => {
    const m = await import('./engine/video.js');
    return {
      exact: m.hasExactTiming('auto'),
      auto: m.pickFormat('auto'),
      mp4:  m.pickFormat('mp4'),
      webm: m.pickFormat('webm'),
      snap: [m.loopSnap(100, 8), m.loopSnap(10, 8), m.loopSnap(45, 8)]
    };
  });
  console.log('exact frame timing:', probe.exact);
  const fdesc = f => f ? (f.label + (f.exact ? ' (exact timing)' : ' (real-time paced)')) : 'none';
  console.log('AUTO :', fdesc(probe.auto));
  console.log('MP4  :', fdesc(probe.mp4));
  console.log('WEBM :', fdesc(probe.webm));
  console.log('loopSnap(100,8)=' + probe.snap[0].toFixed(2) +
              '  (8s x rate / 360 must be a whole number: ' +
              (probe.snap[0] * 8 / 360).toFixed(4) + ')');
  console.log('loopSnap(10,8) =' + probe.snap[1].toFixed(2) + '  (under one turn -> 0)');
  console.log('loopSnap(45,8) =' + probe.snap[2].toFixed(2) +
              '  turns=' + (probe.snap[2] * 8 / 360).toFixed(4));

  /* small, fast clip: 24 frames */
  await p.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
    set('res', '0.5');
    set('vidFmt', 'auto'); set('vidShape', 'land'); set('vidSize', '720');
    set('vidFps', '24');   set('vidSec', '2');      set('vidLoops', '1');
    set('vidRate', '8');
  });

  const dl = p.waitForEvent('download', { timeout: 180000 }).catch(() => null);
  const t0 = Date.now();
  await p.evaluate(() => document.getElementById('vidBtn').click());

  /* wait for the handler to finish (button text returns to RECORD) */
  await p.waitForFunction(
    () => !/STOP/.test(document.getElementById('vidBtn').textContent),
    null,
    { timeout: 300000, polling: 500 }
  );
  const stat = await p.evaluate(() => document.getElementById('vidStat').textContent);
  console.log('status:', stat);
  console.log('elapsed:', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  const d = await dl;
  if (d) {
    const out = '/tmp/claude-0/-home-claude/fa5d1c52-b478-58c2-8ef9-a32b68671ad7/scratchpad/' + d.suggestedFilename();
    await d.saveAs(out);
    const sz = fs.statSync(out).size;
    console.log('downloaded:', d.suggestedFilename(), (sz / 1024).toFixed(0) + ' KB');
    const want = 48 / 24;                       /* frames / fps */
    let dur = null;
    try {
      const { execSync } = require('child_process');
      dur = parseFloat(execSync(
        'ffprobe -v error -show_entries format=duration -of csv=p=0 "' + out + '"'
      ).toString().trim());
    } catch (_) { /* ffprobe absent */ }
    if (dur === null) {
      console.log('duration: ffprobe unavailable — cannot verify timing');
      console.log(sz > 2048 ? 'PARTIAL - has content, timing unverified' : 'FAIL - empty');
    } else {
      const off = Math.abs(dur - want);
      console.log('duration: ' + dur.toFixed(2) + 's  want ' + want.toFixed(2) +
                  's  off by ' + off.toFixed(2) + 's');
      console.log(sz > 2048 && off < 0.35
        ? 'PASS - real content at the correct playback rate'
        : 'FAIL - ' + (sz <= 2048 ? 'clip is empty' : 'clip plays at the wrong rate'));
    }
  } else {
    console.log('FAIL - no download fired');
  }

  /* the canvas must be restored to its live size, not left at 1280x720 */
  const after = await p.evaluate(() => ({
    w: document.getElementById('c').width,
    h: document.getElementById('c').height,
    btn: document.getElementById('vidBtn').textContent.trim()
  }));
  console.log('canvas restored to', after.w + 'x' + after.h, '| button:', after.btn);

  await b.close(); srv.close();
})();
