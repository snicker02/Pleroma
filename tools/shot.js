const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{
  let f=path.join('/home/claude/pleroma3d',rq.url==='/'?'/index.html':rq.url.split('?')[0]);
  if(!fs.existsSync(f)){rs.writeHead(404);return rs.end('nope');}
  rs.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  rs.end(fs.readFileSync(f));
});
(async()=>{
  await new Promise(r=>srv.listen(8945,r));
  const out=process.argv[2]||'shot.png';
  const tweaks=process.argv[3]?JSON.parse(process.argv[3]):{};
  const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p=await b.newPage({viewport:{width:520,height:924}});
  const errs=[];
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,400));});
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await p.goto('http://localhost:8945/index.html');
  await p.waitForTimeout(3000);
  if(Object.keys(tweaks).length){
    await p.evaluate(t=>{for(const[k,v]of Object.entries(t)){
      if(k.startsWith('_')) continue;          /* directives, not controls */
      const el=document.getElementById(k); if(!el){console.error('no ctrl '+k);continue;}
      el.value=v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));}
      /* "_click": "<buttonId>" fires a panel button after the sliders settle */
      if(t._click){const b=document.getElementById(t._click); if(b)b.click(); else console.error('no btn '+t._click);}
      /* "_dbg": "<n>" selects a diagnostic channel (10 = the AO buffer) */
      if(t._dbg !== undefined){ window.__dbgMode = parseInt(t._dbg,10)||0; }
    },tweaks);
    await p.waitForTimeout(2000);
  }
  const err=await p.evaluate(()=>{const e=document.getElementById('err');return e.style.display==='block'?e.textContent.slice(0,900):null;});
  const stat=await p.evaluate(()=>document.getElementById('stat').textContent);
  const cps=await p.evaluate(()=>JSON.stringify(window.__pleroma.copyState()));
  console.log('COPIES:',cps);
  await p.evaluate(()=>document.getElementById('panel').classList.add('hidden'));
  await p.waitForTimeout(700);
  await p.screenshot({path:out,timeout:120000});
  console.log(out,'|',stat);
  if(err)console.log('FATAL PANEL:\n'+err);
  if(errs.length)console.log('CONSOLE:\n'+errs.slice(0,5).join('\n'));
  await b.close(); srv.close();
})();
