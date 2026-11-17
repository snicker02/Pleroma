const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const MIME={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((rq,rs)=>{
  let f=path.join('/home/claude/pleroma3d',rq.url==='/'?'/index.html':rq.url.split('?')[0]);
  if(!fs.existsSync(f)){rs.writeHead(404);return rs.end();}
  rs.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  rs.end(fs.readFileSync(f));
});
(async()=>{
  await new Promise(r=>srv.listen(8810,r));
  const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p=await b.newPage({viewport:{width:320,height:560}});
  p.on('pageerror',e=>console.log('PAGEERR',e.message));
  const warns=[];
  p.on('console',m=>{if(m.type()==='warning')warns.push(m.text());});
  const tw = process.argv[2] || '{}';
  await p.addInitScript(t=>{window.__loopTweaks=t;}, tw);
  await p.goto('http://localhost:8810/index.html');
  await p.waitForTimeout(3000);
  await p.evaluate(()=>{
    const extra = JSON.parse(window.__loopTweaks||'{}');
    for(const [k,v] of Object.entries(Object.assign({fly:'0',roll:'0',res:'0.5'},extra))){
      const el=document.getElementById(k); el.value=v;
      el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
    }
    document.getElementById('panel').classList.add('hidden');
  });
  await p.waitForTimeout(800);
  async function grab(ph){
    await p.evaluate(v=>{window.__pleroma.setPhaseRaw(v);window.__pleroma.redraw();},ph);
    await p.waitForTimeout(140);
    return p.evaluate(()=>{
      const c=document.getElementById('c');
      const t=document.createElement('canvas');t.width=c.width;t.height=c.height;
      t.getContext('2d').drawImage(c,0,0);
      return Array.from(t.getContext('2d').getImageData(0,0,c.width,c.height).data);
    });
  }
  const diff=(a,b)=>{let s=0;for(let i=0;i<a.length;i+=4)s+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return s/(a.length/4*3);};
  const worst=(a,b)=>{let m=0;for(let i=0;i<a.length;i+=4)m=Math.max(m,Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));return m;};

  console.log('SEAMLESS-LOOP TEST\n');
  console.log('The meaningful check is PERIODICITY: frame(p) must equal frame(p+1).');
  console.log('Comparing the wrap step against NEIGHBOURING steps is not a valid test —');
  console.log('step size genuinely varies around the cycle, so that gives false alarms.\n');
  console.log('frame(p) vs frame(p+1) — must be 0 if the scene is 1-periodic\n');
  let ok=true;
  for(const ph of [0.0,0.25,0.5,0.75]){
    const a=await grab(ph), c=await grab(ph+1);
    const d=diff(a,c), w=worst(a,c);
    const pass=d<0.35;
    if(!pass)ok=false;
    console.log('  p='+ph.toFixed(2)+'  mean|d|='+d.toFixed(4)+'  worst channel='+w+(pass?'':'   <-- NOT PERIODIC'));
  }
  // Is the step across the wrap genuinely larger, or is the wrap itself bad?
  console.log('\nSTEP SIZE around the cycle (all raw 0.01 steps):');
  for(const a0 of [0.50,0.90,0.96,0.98,0.99]){
    const x=await grab(a0), y=await grab(a0+0.01);
    console.log('  '+a0.toFixed(2)+' -> '+(a0+0.01).toFixed(2)+'   '+diff(x,y).toFixed(3));
  }
  const w1=await grab(0.99), w2=await grab(1.00);
  console.log('  0.99 -> 1.00 (raw)        '+diff(w1,w2).toFixed(3));
  await p.evaluate(()=>{window.__pleroma.setPhase(0.0);window.__pleroma.redraw();});
  await p.waitForTimeout(140);
  const w3=await p.evaluate(()=>{const c=document.getElementById('c');
    const t=document.createElement('canvas');t.width=c.width;t.height=c.height;
    t.getContext('2d').drawImage(c,0,0);
    return Array.from(t.getContext('2d').getImageData(0,0,c.width,c.height).data);});
  console.log('  0.99 -> 0.00 (wrapped)    '+diff(w1,w3).toFixed(3));
  console.log('  frame(1.00) vs frame(0.00) '+diff(w2,w3).toFixed(5));
  if(warns.length)console.log('\nconsole warnings:\n'+warns.slice(0,4).join('\n'));
  console.log(ok?'\nPASS - scene is 1-periodic; the phase wrap is a no-op'
               :'\nFAIL - scene is not 1-periodic; the wrap changes the image');
  await b.close(); srv.close();
  process.exit(ok?0:1);
})();
