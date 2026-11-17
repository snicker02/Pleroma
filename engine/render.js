/* ═══════════════════════════════════════════════════════════════════════════
   render.js — GL resources and the draw path
   ───────────────────────────────────────────────────────────────────────────
   The scene is rendered OFF SCREEN into a G-buffer, so that screen-space
   ambient occlusion can be computed from it before the image is finished:

     1. background  — void gradient, starfield, the light at the vanishing point
     2. ornaments   — instanced solid meshes, depth-tested (this is the 3D)
     3. resolve     — multisample blit down to sampleable textures
     4. SSAO        — hemisphere occlusion from depth + view normals
     5. blur        — box filter, to kill the sampling noise
     6. composite   — AO x scene, tonemap, bloom, vignette, to the screen

   The ornaments are OPAQUE and z-buffered. Occlusion is real: a near dome
   genuinely hides what is behind it. No sorting, no blending, no fakery.

   WHY OFFSCREEN. Thousands of forms overlap each other and nothing darkened
   where they met, so every one of them floated in the same evenly lit soup —
   the single biggest reason the output read as CG rather than as painted
   ornament. Contact shadowing needs depth and normals as TEXTURES, which the
   default framebuffer cannot give you.

   That costs the default framebuffer's MSAA, so the G-buffer is itself
   multisampled and resolved with a blit. Dropping to a single sample and
   leaning on a post-process AA instead would have cost edge quality on
   exactly the thing this engine makes: thousands of small, high-contrast
   silhouettes.

   One instanced program serves two placement modes, chosen per instance:
     mode 0  wall  — the form sits on the tunnel wall, up pointing inward
     mode 1  ribbon— the form rides a helix, up pointing along the analytic
                     tangent of that curve, so swept tube segments meet
                     end to end at any twist rate
   ═════════════════════════════════════════════════════════════════════════ */

const IDENTITY_COPY = {
  R: new Float32Array([1,0,0, 0,1,0, 0,0,1]),
  T: new Float32Array([0,0,0]),
  S: 1,
  L: new Float32Array([0,0,0])   /* replaced per frame from lightZ */
};

const MAX_AO_SAMPLES = 32;
const NEAR = 0.05, FAR = 4000.0;

/* Deterministic hemisphere kernel. Seeded rather than Math.random so the
   same build always produces the same AO — the loop test compares frames
   byte for byte and a kernel that changed between runs would mask a real
   regression. Samples are clustered toward the origin so the occlusion is
   dominated by near contact rather than by distant geometry. */
function aoKernel(n) {
  let s = 0x2545f491;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const k = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x, y, z, l;
    do {
      x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd();   /* z>=0 : hemisphere */
      l = Math.hypot(x, y, z);
    } while (l > 1 || l < 1e-3);
    const t = i / n;
    const scale = 0.1 + 0.9 * t * t;
    k[i*3] = x / l * scale; k[i*3+1] = y / l * scale; k[i*3+2] = z / l * scale;
  }
  return k;
}

export function createRenderer(gl) {

  /* float render targets — without these the scene buffer is 8-bit and the
     tonemap has to happen before AO rather than after */
  const floatRT = !!gl.getExtension('EXT_color_buffer_float');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log + '\n' + src.split('\n').map((l,i)=>(i+1)+' | '+l).join('\n'));
      throw new Error('shader compile: ' + log);
    }
    return s;
  }
  function prog(vs, fs, attrs) {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  const U = (p, names) => {
    const o = {}; names.forEach(n => o[n] = gl.getUniformLocation(p, n)); return o;
  };

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const VQUAD = `#version 300 es
in vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }`;

  /* ═══ 1 — background ═══ */
  const BG = prog(VQUAD,
`#version 300 es
precision highp float;
uniform vec2  uRes, uAxis;
uniform vec3  uVoid, uMid, uGlow;
uniform float uGlowI, uGlowR, uStars, uSeed;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oNrm;
float h21(vec2 p){ p=fract(p*vec2(.1031,.1030)); p+=dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
void main(){
  vec2 uv=(gl_FragCoord.xy-uRes*.5)/uRes.y;
  float r=length(uv-uAxis);
  vec3 col=mix(uMid*.34,uVoid*.85,smoothstep(.0,1.05,r));
  vec2 cell=floor((uv+uSeed*.137)*70.);
  float s=h21(cell);
  if(s>.988){
    float b=(s-.988)/.012;
    vec2 c=fract((uv+uSeed*.137)*70.)-.5;
    col+=vec3(.96,.94,.88)*b*uStars*smoothstep(.34,.0,length(c));
  }
  col+=uGlow*exp(-r*r/max(uGlowR*uGlowR,1e-5))*uGlowI;
  col+=uGlow*exp(-r/max(uGlowR*1.5,1e-4))*uGlowI*.15;
  oCol=vec4(col,1.0);
  /* alpha 0 marks "no geometry here" so AO never darkens the void */
  oNrm=vec4(0.5,0.5,1.0,0.0);
}`, ['a']);
  const BGU = U(BG, ['uRes','uAxis','uVoid','uMid','uGlow','uGlowI','uGlowR','uStars','uSeed']);

  /* ═══ 2 — instanced solid ornaments ═══ */
  const ORN = prog(
`#version 300 es
in vec3  aPos;
in vec3  aNrm;
in float aZone;
in vec2  aUv;
in vec4  iA;   /* ringE, theta0, scale,  mode     */
in vec4  iB;   /* offX,  offY,   offZ,   hue      */
in vec4  iC;   /* quaternion x,y,z,w              */
in vec4  iD;   /* shellR, bodyMix, tubeR, turnRate*/
in vec4  iE;   /* motif, tileU, tileV, spare   */
uniform mat4  uVP;
uniform mat3  uViewR;    /* view rotation, for the view-space normal buffer */
uniform mat3  uModelR;   /* per-copy object rotation */
uniform vec3  uModelT;   /* per-copy object offset   */
uniform float uModelS;   /* per-copy object scale    */
uniform float uPhase,uLambda,uMu,uR0,uD0,uS0,uTwist,uSpin,uRings;
uniform float uLnLambda,uLnMu,uRibWobble,uRibHarm,uRibStart,uRibSpan;
uniform float uRibSteps;   /* corners per ring; 0 = smooth curve */
out vec3  vN, vW, vL, vNV;
out vec2  vUv;
out float vZone, vHue, vBody, vDist, vMotif;

vec3 qrot(vec4 q, vec3 v){
  return v + 2.0*cross(q.xyz, cross(q.xyz, v) + q.w*v);
}

/* Centre of the ribbon helix at ring coordinate e. Pulled out of main so the
   stepped path can evaluate it at two corners and take the chord between
   them; the smooth path still uses the analytic tangent instead. */
vec3 ribPoint(float e, float shR, float turn) {
  float th = iA.y + e * turn + uSpin;
  float rr = uR0 * shR * pow(uLambda, e);
  if (uRibWobble > 0.0) rr *= (1.0 + uRibWobble * sin(e * 6.2831853 * uRibHarm));
  return vec3(cos(th) * rr, sin(th) * rr, -uD0 * pow(uMu, e));
}

void main(){
  /* ── the recursion ─────────────────────────────────────────── */
  /* A swept tube spans the whole curve in ONE instance, so its ring
     coordinate comes from the template's t (aPos.y, 0..1) rather than from
     the instance. This MUST be resolved before anything derived from e. */
  bool ribbon = iA.w > 0.5;
  bool isTube = ribbon && iA.w < 1.5;
  /* Sample the tube uniformly in SCREEN-SPACE ARC, not uniformly in e.
     On-screen radius goes as q^e, so equal steps in e give long chords near
     the camera (visible facets on a big tube) and sub-pixel ones deep in the
     tunnel (wasted vertices). Inverting the cumulative arc,
         q^e = A + t*(B - A),   A = q^start, B = q^(start+span)
     spends every vertex where it shows. ln q = ln lambda - ln mu. */
  float e;
  if (isTube && uRibSteps > 0.5) {
    /* ANGULAR PATH — snap every sample onto a corner of a polygonal helix.
       Corners sit uniformly in e at an INTEGER count per ring, which is what
       keeps the phase loop seamless: one ring of slide moves the corner set
       by a whole number of slots onto itself. (The same rule the wobble
       harmonic and the bead lattice obey.)

       Snapping rather than interpolating is deliberate. Interpolating
       between corners would let a sample land mid-chord, and any sample that
       straddles a corner chamfers it — the hard angle rounds off. With every
       sample snapped, surplus samples collapse into degenerate quads that
       draw nothing, and the visible surface is exactly the polyline through
       the corners. */
    float corners = max(uRibSpan * uRibSteps, 1.0);
    float ci = floor(aPos.y * corners + 0.5);
    e = uRibStart + ci / uRibSteps + uPhase;
  } else if (isTube) {
    float lnq = uLnLambda - uLnMu;
    float A = exp(lnq * uRibStart);
    float B = exp(lnq * (uRibStart + uRibSpan));
    float v = max(A + aPos.y * (B - A), 1e-20);
    e = log(v) / lnq + uPhase;
  } else {
    e = iA.x + uPhase;
  }
  float shR= iD.x;
  float r  = uR0 * shR * pow(uLambda, e);     /* physical radius   */
  float d  = uD0 *       pow(uMu,     e);     /* physical distance */
  float pS = uS0 * shR * pow(uLambda, e);     /* scale tracks radius*/
  /* ──────────────────────────────────────────────────────────── */

  /* Both ends of the ring set scale to zero, so the ring gained at the near
     end and the ring lost at the far end are invisible when the set shifts.
     The near guard is zero below -1: combined with lattice.js's invariant
     that every tier's minimum ringE is <= -2, that puts the whole appearing
     band in the dead zone. Being off-screen is not enough on its own —
     inner shells and brick-offset spokes appear inside the frustum. */
  float fade = smoothstep(-1.0, 0.0, e)
             * (1.0 - smoothstep(uRings - 3.0, uRings - 1.0, e));

  /* mode 0 = wall · 1 = swept ribbon tube · 2 = ribbon rider (bead) */
  float turn  = uTwist + (ribbon ? iD.w : 0.0);
  float th    = iA.y + e * turn + uSpin;
  float ct = cos(th), st = sin(th);
  vec3 radial = vec3(ct, st, 0.0);
  vec3 tang   = vec3(-st, ct, 0.0);
  vec3 axial  = vec3(0.0, 0.0, -1.0);

  float rr = r;
  float dRdE = r * uLnLambda;
  if (ribbon && uRibWobble > 0.0) {
    /* integer harmonics only — any other frequency breaks the phase loop */
    float w  = sin(e * 6.2831853 * uRibHarm);
    float dw = cos(e * 6.2831853 * uRibHarm) * 6.2831853 * uRibHarm;
    rr   = r * (1.0 + uRibWobble * w);
    dRdE = r * uLnLambda * (1.0 + uRibWobble * w) + r * uRibWobble * dw;
  }

  vec3 ctr = radial * rr + axial * d;

  /* local frame */
  vec3 Xp, Yp, Zp;
  float sx, sy, sz;
  if (!ribbon) {
    Yp = -radial;                 /* up points into the tunnel          */
    Zp = axial;
    Xp = vec3(st, -ct, 0.0);      /* tangent; Xp x Yp = Zp, right-handed*/
    sx = pS * iA.z; sy = sx; sz = sx;
  } else {
    /* analytic tangent of the helix: d/de of (rr·radial + d·axial) */
    vec3 T = radial * dRdE + tang * (rr * turn) + axial * (d * uLnMu);
    float Tl = max(length(T), 1e-6);
    Yp = T / Tl;
    vec3 ref = abs(Yp.z) > 0.95 ? radial : axial;
    Xp = normalize(cross(Yp, ref));
    Zp = cross(Xp, Yp);
    sx = pS * iA.z; sy = sx; sz = sx;
  }

  vec3 world, nrm;
  if (isTube) {
    /* Sweep: ring the cross-section around the curve point. The frame uses
       the radial direction projected perpendicular to the tangent, which is
       smooth and never flips along a helix — a Frenet frame would spin at
       inflections and twist the tube. */
    vec3 T;
    if (uRibSteps > 0.5) {
      /* Frame from the FORWARD chord. Both ends of a segment then share one
         frame, so the segment is a dead-straight bar and the only
         discontinuity is at the corner itself — a hard mitre, which is the
         point. An analytic tangent here would round the corner back off. */
      T = normalize(ribPoint(e + 1.0/uRibSteps, shR, turn) - ctr);
    } else {
      T = normalize(radial*dRdE + tang*(rr*turn) + axial*(d*uLnMu));
    }
    vec3 ref = radial - T*dot(T, radial);
    if (dot(ref, ref) < 1e-6) ref = axial - T*dot(T, axial);
    vec3 Nn = normalize(ref);
    vec3 Bb = cross(T, Nn);
    float tubeR = pS * iD.z * fade;
    vec3 off = aPos.x*Nn + aPos.z*Bb;
    world = ctr + off * tubeR;
    /* aNrm carries the CROSS-SECTION normal, which for the round tube equals
       the corner direction (so shading is unchanged) and for a prism is the
       facet normal — that is what keeps a bar's edges hard. */
    nrm   = normalize(aNrm.x*Nn + aNrm.z*Bb);
  } else {
    vec3 pos = ctr + (Xp*iB.x + Yp*iB.y + Zp*iB.z) * pS;
    vec3 lp = qrot(iC, aPos);
    vec3 ln = qrot(iC, aNrm);
    lp = vec3(lp.x*sx, lp.y*sy, lp.z*sz) * fade;
    ln = vec3(ln.x/max(sx,1e-6), ln.y/max(sy,1e-6), ln.z/max(sz,1e-6));
    world = pos + Xp*lp.x + Yp*lp.y + Zp*lp.z;
    nrm   = normalize(Xp*ln.x + Yp*ln.y + Zp*ln.z);
  }

  /* COPY TRANSFORM — the whole structure is solved in its own local frame
     above (that keeps every copy's tunnel internally self-similar: fade
     guards, depth fog and ring recursion all stay local), then the finished
     point is rigidly placed into the world. Uniform scale leaves the normal
     alone; the rotation is orthonormal so no inverse-transpose is needed. */
  world = uModelR * (world * uModelS) + uModelT;
  nrm   = normalize(uModelR * nrm);

  vW=world; vN=nrm; vL=aPos; vZone=aZone; vHue=iB.w; vBody=iD.y; vDist=d;
  vNV = uViewR * nrm;                 /* view-space normal, for SSAO */
  vUv = isTube ? vec2(aUv.x*iE.y, aUv.y*uRibSpan*0.5*iE.z)
               : aUv*iE.yz;
  vMotif=iE.x;
  gl_Position = uVP * vec4(world, 1.0);
}`,
`#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3  vN, vW, vL, vNV;
in vec2  vUv;
in float vZone, vHue, vBody, vDist, vMotif;
uniform vec3  uBody,uAccent,uGlow,uRim,uVoid;
uniform vec3  uEye;
uniform vec3  uLightPos;   /* copy's own vanishing point, world space */
uniform float uLightZ,uKey,uFill,uAmb,uSpec,uShine,uRimI,uFog,uZoneSharp,uGoldBias;
uniform float uBandFreq,uBandDepth,uBandBias;
uniform sampler2DArray uAtlas;
uniform float uAtlasN,uTexMix;
uniform int   uBandType, uDebug, uTonemap;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oNrm;
vec3 hueshift(vec3 c,float h){
  const vec3 w=vec3(0.299,0.587,0.114);
  float a=h*6.2831853, ch=cos(a), sh=sin(a);
  float l=dot(c,w); vec3 u=c-l;
  return clamp(l+vec3(u.r*ch+(u.g-u.b)*sh*.3333,
                      u.g*ch+(u.b-u.r)*sh*.3333,
                      u.b*ch+(u.r-u.g)*sh*.3333),0.0,1.0);
}
void main(){
  /* Two-sided: large forms overlap into a shell around the camera, and a
     one-sided normal would shade the interior as if unlit. */
  vec3 N=normalize(vN);
  vec3 NV=normalize(vNV);
  if (!gl_FrontFacing) { N = -N; NV = -NV; }
  vec3 V=normalize(uEye-vW);

  float zt=clamp((vZone-0.5)*uZoneSharp+0.5+(vBody-0.5)*uGoldBias, 0.0, 1.0);

  float ang=atan(vL.z,vL.x);
  float rad=length(vL.xz);
  float bf=uBandFreq*(0.55+0.9*vBody);
  float band;
  if(uBandType==0)      band=sin(vL.y*bf*6.2831853);
  else if(uBandType==1) band=sin(rad*bf*6.2831853);
  else if(uBandType==2) band=sin(ang*floor(bf*4.0+1.0));
  else if(uBandType==3) band=sin(vL.y*bf*6.2831853)*sin(ang*floor(bf*3.0+1.0));
  else                  band=sin(rad*bf*6.2831853)*sin(ang*floor(bf*3.0+1.0));
  zt=mix(zt, smoothstep(uBandBias-0.16,uBandBias+0.16,band), uBandDepth);

  float gold=smoothstep(0.35,0.65,zt);
  vec3 base=hueshift(mix(uBody,uAccent,gold),vHue);

  /* ornament print: one array layer per motif, hardware REPEAT */
  vec3 tex = texture(uAtlas, vec3(vUv, vMotif)).rgb;
  vec3 orn = hueshift(tex, vHue);
  vec3 albedo = mix(base, orn, uTexMix);

  vec3  Lp=uLightPos;
  vec3  L=normalize(Lp-vW);
  float dif=max(dot(N,L),0.0);
  float fil=max(dot(N,V),0.0);
  vec3  H=normalize(L+V);
  float lum=dot(albedo,vec3(0.299,0.587,0.114));
  float spec=pow(max(dot(N,H),0.0),uShine)*uSpec*mix(0.2,1.0,lum);
  float rim=pow(1.0-max(dot(N,V),0.0),3.0)*uRimI;
  float lightSum = uAmb + dif*uKey + fil*uFill;

  vec3 col = albedo*lightSum + uGlow*spec + uRim*rim;

  float fog=clamp(1.0-exp(-vDist*uFog*0.06), 0.0, 1.0);
  vec3  lit = col;
  col=mix(col, uVoid*1.15, fog);
  float prox = exp(-length(vW-Lp)/max(uLightZ*0.33,1e-3));
  col += uGlow*prox*uKey*0.75;

  /* The AO buffer's alpha is the geometry mask; fog rides in .b of nothing —
     instead fog is folded into the mask so the composite can fade occlusion
     out with distance. A hard-edged AO term on a form already lost in haze
     reads as dirt. */
  oNrm = vec4(NV*0.5+0.5, 1.0 - fog*0.85);

  /* ── diagnostic channels: isolate each term as false colour ── */
  if (uDebug > 0 && uDebug < 10) {
    vec3 d;
    if      (uDebug==1) d = albedo;                       // unlit surface colour
    else if (uDebug==2) d = vec3(lightSum);               // lighting only
    else if (uDebug==3) d = vec3(fog);                    // haze factor
    else if (uDebug==4) d = N*0.5+0.5;                    // world normal
    else if (uDebug==5) d = vec3(clamp(vDist/40.0,0.,1.));// depth
    else if (uDebug==6) d = tex;                          // raw texture sample
    else if (uDebug==7) d = vec3(fract(vUv),0.0);         // uv
    else if (uDebug==8) d = vec3(1.0);                    // coverage mask
    else                d = lit;                          // lit, pre-fog
    oCol = vec4(d,1.0); return;
  }

  /* With a float scene buffer the tonemap waits for the composite, so AO is
     applied to LINEAR light. With an 8-bit fallback buffer it has to happen
     here or the highlights clip on the way out. */
  if (uTonemap == 1) col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  oCol=vec4(max(col,0.0),1.0);
}`, ['aPos','aNrm','aZone','aUv','iA','iB','iC','iD','iE']);
  const ORNU = U(ORN, ['uVP','uViewR','uPhase','uLambda','uMu','uR0','uD0','uS0','uTwist','uSpin',
    'uRings','uLnLambda','uLnMu','uRibWobble','uRibHarm','uRibStart','uRibSpan',
    'uRibSteps',
    'uBody','uAccent','uGlow','uRim','uVoid','uEye','uLightZ','uKey','uFill','uAmb',
    'uSpec','uShine','uRimI','uFog','uZoneSharp','uGoldBias',
    'uBandFreq','uBandDepth','uBandType','uBandBias',
    'uAtlas','uAtlasN','uTexMix','uDebug','uTonemap',
    'uModelR','uModelT','uModelS','uLightPos']);

  /* ═══ 4 — SSAO ═══
     Classic hemisphere SSAO. For each pixel the view position is rebuilt
     from the depth buffer, a cosine-ish kernel is oriented to the surface
     normal, and each sample is projected back to the screen to ask whether
     real geometry sits in front of it.

     The kernel is rotated per pixel by a hash of the pixel coordinate. That
     trades banding for noise, which the blur then removes — and because the
     hash depends only on screen position, the result is identical frame to
     frame, which the seamless-loop test requires.                        */
  const AO = prog(VQUAD,
`#version 300 es
precision highp float;
uniform sampler2D uDepth, uNrm;
uniform mat4  uProj;
uniform vec2  uRes, uTanHalf;
uniform vec3  uKernel[${MAX_AO_SAMPLES}];
uniform float uRadius, uBias, uNear, uFar;
uniform int   uSamples;
out vec4 o;

float linearZ(float d){
  float z = d*2.0-1.0;
  return (2.0*uNear*uFar)/(uFar+uNear - z*(uFar-uNear));
}
vec3 viewPos(vec2 uv, float d){
  return vec3((uv*2.0-1.0)*uTanHalf, -1.0) * linearZ(d);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec4 nz = texture(uNrm, uv);
  if (nz.a < 0.01) { o = vec4(1.0); return; }      /* background: no occlusion */

  float d = texture(uDepth, uv).r;
  if (d >= 0.9999) { o = vec4(1.0); return; }

  vec3 P = viewPos(uv, d);
  vec3 N = normalize(nz.xyz*2.0-1.0);

  float a = hash12(gl_FragCoord.xy)*6.2831853;
  vec3 rv = vec3(cos(a), sin(a), 0.0);
  vec3 T = normalize(rv - N*dot(rv,N));
  vec3 B = cross(N,T);
  mat3 TBN = mat3(T,B,N);

  float occ = 0.0;
  for (int i=0;i<${MAX_AO_SAMPLES};i++){
    if (i>=uSamples) break;
    vec3 sp = P + (TBN*uKernel[i])*uRadius;
    vec4 cp = uProj*vec4(sp,1.0);
    if (cp.w <= 0.0) continue;
    vec2 suv = cp.xy/cp.w*0.5+0.5;
    if (suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0) continue;
    float sd = texture(uDepth, suv).r;
    float sz = linearZ(sd);
    /* the sample is occluded when real geometry at that pixel is NEARER
       than the sample point; -sp.z is the sample's own view distance */
    float range = smoothstep(0.0, 1.0, uRadius/max(abs(-P.z - sz), 1e-4));
    occ += (sz <= -sp.z - uBias ? 1.0 : 0.0) * range;
  }
  o = vec4(1.0 - occ/float(uSamples));
}`, ['a']);
  const AOU = U(AO, ['uDepth','uNrm','uProj','uRes','uTanHalf','uKernel',
                     'uRadius','uBias','uNear','uFar','uSamples']);

  /* ═══ 5 — AO blur ═══ */
  const BLUR = prog(VQUAD,
`#version 300 es
precision highp float;
uniform sampler2D uAO;
uniform vec2 uRes;
uniform int  uR;
out vec4 o;
void main(){
  vec2 t = 1.0/uRes;
  float s = 0.0; float n = 0.0;
  for (int y=-3;y<=3;y++){
    for (int x=-3;x<=3;x++){
      if (abs(x)>uR || abs(y)>uR) continue;
      s += texture(uAO, (gl_FragCoord.xy+vec2(x,y))*t).r; n += 1.0;
    }
  }
  o = vec4(s/max(n,1.0));
}`, ['a']);
  const BLURU = U(BLUR, ['uAO','uRes','uR']);

  /* ═══ 6 — composite: AO, tonemap, bloom, vignette ═══ */
  const POST = prog(VQUAD,
`#version 300 es
precision highp float;
uniform sampler2D uScene, uAO, uNrm;
uniform vec2 uRes,uAxis;
uniform vec3 uGlow;
uniform float uGlowI,uGlowR,uVig,uAOStrength;
uniform int  uTonemap, uDebug;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 col = texture(uScene, uv).rgb;

  if (uDebug > 0 && uDebug < 10) { o = vec4(col,1.0); return; }   /* raw diagnostic */

  float mask = texture(uNrm, uv).a;   /* 0 in the void, fades with haze */
  bool isGeo = mask > 0.001;

  float ao = texture(uAO, uv).r;
  ao = mix(1.0, ao, uAOStrength*mask);
  if (uDebug == 10) { o = vec4(vec3(ao),1.0); return; }

  col *= ao;
  /* ONLY the geometry is tonemapped. The background never was: it used to be
     written straight to the framebuffer while the ornament shader tonemapped
     itself, and running the void gradient through ACES as well washes it out
     and swells the glow. Moving the tonemap into the composite quietly
     changed that, so the geometry mask puts it back. */
  if (uTonemap == 1 && isGeo)
    col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);

  /* bloom and vignette, in the order the old blended pass applied them:
     the scene is dimmed by the vignette, then the glow is added on top so
     the core stays bright at the edge of frame */
  vec2 p=(gl_FragCoord.xy-uRes*.5)/uRes.y;
  float r=length(p-uAxis);
  vec3 add=uGlow*exp(-r*r/max(uGlowR*uGlowR*2.4,1e-5))*uGlowI*.55;
  add+=uGlow*exp(-r/max(uGlowR*1.9,1e-4))*uGlowI*.085;
  float vig=1.0-clamp(uVig*pow(length(p)*0.70,2.4),0.0,1.0);

  o=vec4(clamp(col*vig+add,0.0,1.0),1.0);
}`, ['a']);
  const POSTU = U(POST, ['uScene','uAO','uNrm','uRes','uAxis','uGlow','uGlowI','uGlowR',
                         'uVig','uAOStrength','uTonemap','uDebug']);

  /* ── render targets ────────────────────────────────────────────────────
     Rebuilt only when the size or sample count changes, which matters: a
     PNG or video export resizes the canvas every frame it draws.         */
  const RT = { w:0, h:0, samples:-1 };

  function tex2d(internal, format, type, w, h, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function msRb(internal, w, h, s) {
    const r = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, r);
    if (s > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, internal, w, h);
    else       gl.renderbufferStorage(gl.RENDERBUFFER, internal, w, h);
    return r;
  }

  function freeRT() {
    [RT.cRb, RT.nRb, RT.dRb].forEach(r => r && gl.deleteRenderbuffer(r));
    [RT.cTex, RT.nTex, RT.dTex, RT.aoTex, RT.aoTex2].forEach(t => t && gl.deleteTexture(t));
    [RT.msFbo, RT.resFbo, RT.aoFbo, RT.aoFbo2].forEach(f => f && gl.deleteFramebuffer(f));
  }

  function buildRT(w, h, samples) {
    if (RT.w === w && RT.h === h && RT.samples === samples) return;
    freeRT();
    RT.w = w; RT.h = h; RT.samples = samples;

    const colFmt = floatRT ? gl.RGBA16F : gl.RGBA8;

    /* multisampled side — rendered into, never sampled */
    RT.cRb = msRb(colFmt, w, h, samples);
    RT.nRb = msRb(gl.RGBA8, w, h, samples);
    RT.dRb = msRb(gl.DEPTH_COMPONENT24, w, h, samples);
    RT.msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, RT.cRb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, RT.nRb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.RENDERBUFFER, RT.dRb);

    /* resolved side — sampled by SSAO and the composite */
    RT.cTex = tex2d(colFmt, gl.RGBA, gl.FLOAT, w, h, gl.LINEAR);
    RT.nTex = tex2d(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, w, h, gl.NEAREST);
    RT.dTex = tex2d(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, w, h, gl.NEAREST);
    RT.resFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.resFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, RT.cTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, RT.nTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, RT.dTex, 0);

    RT.aoTex  = tex2d(gl.R8, gl.RED, gl.UNSIGNED_BYTE, w, h, gl.LINEAR);
    RT.aoTex2 = tex2d(gl.R8, gl.RED, gl.UNSIGNED_BYTE, w, h, gl.LINEAR);
    RT.aoFbo  = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.aoFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, RT.aoTex, 0);
    RT.aoFbo2 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.aoFbo2);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, RT.aoTex2, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ── per-mesh GPU resources ── */
  const FLOATS = 20;                 /* 5 vec4 of instance data */

  const atlasTex = gl.createTexture();
  /** layers: one canvas per motif. Array texture, so mips stay per-motif and
   *  the sampler can REPEAT in hardware. */
  function uploadAtlas(layers) {
    const C = layers[0].width, N = layers.length;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const levels = Math.floor(Math.log2(C)) + 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, C, C, N);
    for (let i = 0; i < N; i++)
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, C, C, 1,
                       gl.RGBA, gl.UNSIGNED_BYTE, layers[i]);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.REPEAT);
    /* ANISOTROPY — the tunnel wall is almost entirely grazing-angle surface,
       which is exactly where trilinear mips collapse to mush: the hardware
       picks a mip for the SHORT axis of the footprint and blurs the long one
       away. Without this the ornament print goes soft on most of the frame. */
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY,
                                aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }
  let slots = [];
  function uploadMeshes(meshes) {
    slots.forEach(s => {
      gl.deleteVertexArray(s.vao);
      [s.bPos,s.bNrm,s.bZone,s.bUv,s.bIdx,s.bInst].forEach(b => gl.deleteBuffer(b));
    });
    slots = meshes.map(m => {
      const bPos=gl.createBuffer(), bNrm=gl.createBuffer(), bZone=gl.createBuffer();
      const bUv=gl.createBuffer(), bIdx=gl.createBuffer(), bInst=gl.createBuffer();
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
      gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);

      gl.bindBuffer(gl.ARRAY_BUFFER, bNrm);
      gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);

      gl.bindBuffer(gl.ARRAY_BUFFER, bZone);
      gl.bufferData(gl.ARRAY_BUFFER, m.zon, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,0,0);

      gl.bindBuffer(gl.ARRAY_BUFFER, bUv);
      gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,2,gl.FLOAT,false,0,0);

      gl.bindBuffer(gl.ARRAY_BUFFER, bInst);
      const stride = FLOATS * 4;
      for (let i = 0; i < 5; i++) {
        gl.enableVertexAttribArray(4 + i);
        gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, stride, i * 16);
        gl.vertexAttribDivisor(4 + i, 1);
      }

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao,bPos,bNrm,bZone,bUv,bIdx,bInst, idxCount:m.idx.length, count:0 };
    });
  }

  function uploadInstances(buckets) {
    slots.forEach(s => s.count = 0);
    buckets.forEach(b => {
      const s = slots[b.meshIdx];
      if (!s) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, s.bInst);
      gl.bufferData(gl.ARRAY_BUFFER, b.data, gl.DYNAMIC_DRAW);
      s.count = b.count;
    });
  }

  let kernelN = 0, kernelBuf = null;
  function kernel(n) {
    if (kernelN !== n) { kernelN = n; kernelBuf = aoKernel(n); }
    return kernelBuf;
  }

  function draw(w, h, S) {
    const wantSamples = Math.min(S.msaa | 0, maxSamples);
    buildRT(w, h, wantSamples);
    const tonemapInOrn = floatRT ? 0 : 1;
    const aoOn = S.aoStrength > 0.001;

    /* ── scene into the G-buffer ── */
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.msFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, w, h);

    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
    gl.useProgram(BG); gl.bindVertexArray(quadVao);
    gl.uniform2f(BGU.uRes, w, h);
    gl.uniform2f(BGU.uAxis, S.axis[0], S.axis[1]);
    gl.uniform3fv(BGU.uVoid, S.cVoid);
    gl.uniform3fv(BGU.uMid, S.cMid);
    gl.uniform3fv(BGU.uGlow, S.cGlow);
    gl.uniform1f(BGU.uGlowI, S.glowI);
    gl.uniform1f(BGU.uGlowR, S.glowR);
    gl.uniform1f(BGU.uStars, S.stars);
    gl.uniform1f(BGU.uSeed, S.seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(ORN);
    gl.uniformMatrix4fv(ORNU.uVP, false, S.vp);
    gl.uniformMatrix3fv(ORNU.uViewR, false, S.viewR);
    gl.uniform1f(ORNU.uPhase, S.phase);
    gl.uniform1f(ORNU.uLambda, S.lambda);
    gl.uniform1f(ORNU.uMu, S.mu);
    gl.uniform1f(ORNU.uLnLambda, Math.log(S.lambda));
    gl.uniform1f(ORNU.uLnMu, Math.log(S.mu));
    gl.uniform1f(ORNU.uR0, S.R0);
    gl.uniform1f(ORNU.uD0, S.D0);
    gl.uniform1f(ORNU.uS0, S.S0);
    gl.uniform1f(ORNU.uTwist, S.twist);
    gl.uniform1f(ORNU.uSpin, S.spin);
    gl.uniform1f(ORNU.uRings, S.rings);
    gl.uniform1f(ORNU.uRibStart, S.ribStart);
    gl.uniform1f(ORNU.uRibSpan, S.ribSpan);
    gl.uniform1f(ORNU.uRibWobble, S.ribWobble);
    gl.uniform1f(ORNU.uRibHarm, S.ribHarm);
    gl.uniform1f(ORNU.uRibSteps, S.ribSteps);
    gl.uniform3fv(ORNU.uBody, S.cBody);
    gl.uniform3fv(ORNU.uAccent, S.cAccent);
    gl.uniform3fv(ORNU.uGlow, S.cGlow);
    gl.uniform3fv(ORNU.uRim, S.cRim);
    gl.uniform3fv(ORNU.uVoid, S.cVoid);
    gl.uniform3fv(ORNU.uEye, S.eye);
    gl.uniform1f(ORNU.uLightZ, S.lightZ);
    gl.uniform1f(ORNU.uKey, S.key);
    gl.uniform1f(ORNU.uFill, S.fill);
    gl.uniform1f(ORNU.uAmb, S.amb);
    gl.uniform1f(ORNU.uSpec, S.spec);
    gl.uniform1f(ORNU.uShine, S.shine);
    gl.uniform1f(ORNU.uRimI, S.rimI);
    gl.uniform1f(ORNU.uFog, S.fog);
    gl.uniform1f(ORNU.uZoneSharp, S.zoneSharp);
    gl.uniform1f(ORNU.uGoldBias, S.goldBias);
    gl.uniform1f(ORNU.uBandFreq, S.bandFreq);
    gl.uniform1f(ORNU.uBandDepth, S.bandDepth);
    gl.uniform1f(ORNU.uBandBias, S.bandBias);
    gl.uniform1i(ORNU.uBandType, S.bandType);
    gl.uniform1f(ORNU.uAtlasN, S.atlasN);
    gl.uniform1f(ORNU.uTexMix, S.texMix);
    gl.uniform1i(ORNU.uDebug, S.debug|0);
    gl.uniform1i(ORNU.uTonemap, tonemapInOrn);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex);
    gl.uniform1i(ORNU.uAtlas, 0);
    /* COPIES — the whole instance set is replayed once per copy with its own
       rigid transform. One shared depth buffer, so intersecting copies
       occlude each other properly instead of one being painted over the
       other. Cost is linear in the copy count. */
    let drawn = 0;
    const copies = (S.copies && S.copies.length) ? S.copies : [IDENTITY_COPY];
    for (const c of copies) {
      gl.uniformMatrix3fv(ORNU.uModelR, false, c.R);
      gl.uniform3fv(ORNU.uModelT, c.T);
      gl.uniform1f(ORNU.uModelS, c.S);
      /* each copy's key light rides along with it, so its tunnel is backlit
         down its own axis rather than toward copy one's vanishing point */
      gl.uniform3fv(ORNU.uLightPos, c.L);
      for (const s of slots) {
        if (!s.count) continue;
        gl.bindVertexArray(s.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, s.idxCount, gl.UNSIGNED_INT, 0, s.count);
        drawn++;
      }
    }

    /* ── resolve the multisample buffers down to textures ──
       blitFramebuffer moves one colour attachment at a time, so the read and
       draw buffer are re-pointed for each. */
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, RT.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, RT.resFbo);

    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);

    /* ── SSAO + blur ── */
    let aoSource = RT.aoTex;
    if (aoOn) {
      const n = Math.max(4, Math.min(S.aoSamples|0, MAX_AO_SAMPLES));
      gl.bindFramebuffer(gl.FRAMEBUFFER, RT.aoFbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0,0,w,h);
      gl.useProgram(AO); gl.bindVertexArray(quadVao);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, RT.dTex);
      gl.uniform1i(AOU.uDepth, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, RT.nTex);
      gl.uniform1i(AOU.uNrm, 2);
      gl.uniformMatrix4fv(AOU.uProj, false, S.proj);
      gl.uniform2f(AOU.uRes, w, h);
      /* tan(fov/2) per axis, read back off the projection: P[0] = 1/(a·t),
         P[5] = 1/t — so the AO never has to be told the fov separately and
         cannot disagree with the matrix the scene was drawn with. */
      gl.uniform2f(AOU.uTanHalf, 1.0/S.proj[0], 1.0/S.proj[5]);
      gl.uniform3fv(AOU.uKernel, kernel(n));
      gl.uniform1f(AOU.uRadius, S.aoRadius);
      gl.uniform1f(AOU.uBias, S.aoBias);
      gl.uniform1f(AOU.uNear, NEAR);
      gl.uniform1f(AOU.uFar, FAR);
      gl.uniform1i(AOU.uSamples, n);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const br = Math.max(0, Math.min(S.aoBlur|0, 3));
      if (br > 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, RT.aoFbo2);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.useProgram(BLUR); gl.bindVertexArray(quadVao);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, RT.aoTex);
        gl.uniform1i(BLURU.uAO, 1);
        gl.uniform2f(BLURU.uRes, w, h);
        gl.uniform1i(BLURU.uR, br);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        aoSource = RT.aoTex2;
      }
    }

    /* ── composite to the screen ── */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,w,h);
    gl.useProgram(POST); gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, RT.cTex);
    gl.uniform1i(POSTU.uScene, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, aoSource);
    gl.uniform1i(POSTU.uAO, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, RT.nTex);
    gl.uniform1i(POSTU.uNrm, 3);
    gl.uniform2f(POSTU.uRes, w, h);
    gl.uniform2f(POSTU.uAxis, S.axis[0], S.axis[1]);
    gl.uniform3fv(POSTU.uGlow, S.cGlow);
    gl.uniform1f(POSTU.uGlowI, S.glowI);
    gl.uniform1f(POSTU.uGlowR, S.glowR);
    gl.uniform1f(POSTU.uVig, S.vig);
    gl.uniform1f(POSTU.uAOStrength, aoOn ? S.aoStrength : 0.0);
    gl.uniform1i(POSTU.uTonemap, floatRT ? 1 : 0);
    gl.uniform1i(POSTU.uDebug, S.debug|0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
    return drawn;
  }

  /** What the hardware actually gave us, for the UI to report. */
  const caps = { aniso: !!aniso, maxAniso, floatRT, maxSamples };

  return { uploadMeshes, uploadInstances, uploadAtlas, draw, caps };
}
