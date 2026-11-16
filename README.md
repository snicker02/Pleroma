# Pleroma

A solid-geometry ornament engine. Thousands of procedurally generated 3D forms
are instanced into a self-similar tunnel and rendered as real, z-buffered,
lit solids — producing dense recursive ornamental scenes that recede into a
light source.

WebGL2. No dependencies. No build step.

---

## The name

*Pleroma* (Greek πλήρωμα, "fullness") is the term Gnostic cosmology uses for
the totality of the divine — the realm of light, as against the *kenoma*, the
emptiness outside it. The Pleroma is not a single thing but a structured one:
it is filled by aeons that emanate from one source in ordered pairs and
levels, each a diminished reflection of the one before, the whole receding
away from its origin without ever becoming something other than itself.

Which is a fair description of what the engine does. A single form recurs at
every scale down a tunnel that contracts geometrically into a light source,
every ring a scaled copy of the last, filled until there is no gap left —
and surrounded by a void colour the shader literally calls `uVoid`.

The reference imagery that started this project has the same quality:
ornament packed to the edges, detail inside detail, everything organised
around a single point of light.

---

## Running it

Pleroma is split into ES modules, so it needs to be served over HTTP —
opening `index.html` straight off disk will fail on CORS.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or push to GitHub Pages, where it just works.

---

## The idea

The look this engine targets — recursive ornamental tunnels, nested detail at
several scales, everything receding into a glow — comes from four mechanisms.

1. **A procedural form library.** Every ornament is a lathe: a 2D profile
   revolved around an axis, with optional angular lobing. One generator yields
   domes, beads, finials, torii, rosettes, gears, starbursts and spires —
   thirty wall forms, built at load.

   Seven of them are POLYHEDRA, from the same generator. `flat: true`
   un-indexes the mesh and gives every triangle its own facet normal; with a
   low segment count and a `raw` (un-smoothed) profile that turns the lathe
   into a cube, gem, obelisk, ziggurat or hex nut. The geometry of a
   4-segment lathe is already a box — only the averaged normals were making
   it read as a soft barrel. They are also the cheapest forms in the set: a
   cube is 40 triangles against a dome's ~400.

2. **An ornament print.** The richness in the reference imagery lives on the
   SURFACES, not in the object count: every form is printed with flat ornament
   — mandalas, dot rings, eyes, scales, filigree. `atlas.js` draws 16 seamless
   tiles at load (each motif stamped nine times and clipped, so it wraps) and
   they are UV-mapped onto the solids.

   One array layer per motif, not a 4x4 sheet: a single atlas cannot be
   mipmapped, because at coarse levels the cells bleed together and a form
   small on screen samples the average of all sixteen tiles.

   Keep `TILES AROUND`/`ALONG` at 1 unless forms are large on screen. Repeating
   a motif across a small form puts each copy on a few pixels, the mip chain
   averages it to the tile's ground colour, and it turns to mud.

3. **A branch IFS at every wall position.** Each wall position is the root of
   a contraction IFS. Every node spawns `branches` children through the *same*
   rotate-tilt-offset-shrink map, so the depth-3 cloud is a scaled copy of the
   depth-2 cloud.

   `SELF-SIMILARITY` is what makes that read as fractal rather than as a heap
   of assorted objects: a child inherits its parent's FORM and ornament tile,
   so the same shape recurs at every scale. Give every node an independent
   random mesh and the recursion is still mathematically present and
   completely invisible — which is the mistake an earlier version made.

   Two things have to be true for the cascade to be seen at all:

   - **It must be big enough.** `contraction^depth` sets the smallest node.
     0.58 at depth 3 gives 1.00 / 0.58 / 0.34 / 0.20; push contraction down
     and the deep levels land on a few pixels and disappear.
   - **It must have gaps.** A fractal reads through its holes. `ORBIT` well
     above 1 separates children from the parent so the branching is legible;
     near 1 they merge into an undifferentiated crust.

   Node count per wall position is `(b^(d+1) - 1)/(b - 1)` — watch the solids
   counter, it climbs fast.

4. **A ribbon tier.** Each ribbon is ONE continuous swept surface, not a
   chain of cylinders. Mesh 16 is a parametric grid carrying
   `(cos(theta), t, sin(theta))`; the vertex shader maps `t` onto the ring
   coordinate and evaluates the helix there, so every vertex sits exactly on
   the curve and the tube bends smoothly — no joints, no caps.

   The cross-section frame is the radial direction projected off the tangent.
   That never flips along a helix; a Frenet frame would spin at inflections
   and twist the tube.

   Samples run uniformly in **screen-space arc**, not uniformly in `e`. On-screen
   radius goes as `q^e`, so equal steps in `e` give long visible facets on the
   near tube and sub-pixel ones deep in the tunnel. Inverting the cumulative
   arc gives `q^e = A + t(B - A)`, which spends every vertex where it shows —
   measured arc-per-sample is even to four decimal places.

   `RIBBON SHAPE` swaps the round cross-section for a prism bar with 3, 4, 6
   or 8 flat faces. Each facet carries its own pair of corner vertices with
   that facet's normal — sharing a corner ring between neighbouring faces
   would smooth-shade them straight back into a lumpy tube. `aNrm` carries
   the cross-section normal, which for the round tube equals the corner
   direction, so one shader path serves both.

   `HARD ANGLES` bends the path instead of the section. The helix becomes a
   polygon: every template sample snaps onto a corner of a lattice uniform in
   `e`, and the frame comes from the FORWARD chord rather than the analytic
   tangent, so both ends of a segment share one frame and each run is a
   dead-straight bar meeting the next at a hard mitre.

   Two details that look optional and are not. Samples SNAP to corners rather
   than interpolating between them: any sample landing mid-chord chamfers the
   corner it straddles, and the hard angle rounds straight back off. Surplus
   samples collapse into degenerate quads that draw nothing. And the corner
   count is a whole number PER RING, like the wobble harmonic and the bead
   lattice, because one ring of phase slide must map the corner set onto
   itself. The prism templates carry enough samples for the worst case
   (44 rings + 3) x 16 corners; `checkCornerBudget` warns rather than quietly
   dropping corners if that is ever exceeded.

   There are two families. The main set all wind the same way at the same
   radius, which makes them parallel helices that can never meet however many
   you add. `CROSSING RIBBONS` is a counter-wound set: at the same radius the
   two families genuinely intersect rather than merely appearing to.
   `CROSS RADIUS` offsets them to weave past instead, and `CROSS TURN RATIO`
   sets how steeply they cut across.

   Wobble runs on integer harmonics and beads on an integer-per-ring lattice,
   both so each sub-tier's period divides one ring.

5. **Copies.** A copy is the WHOLE structure again — every ring, ribbon and
   fractal cluster — rigidly placed with its own offset, turn and scale.

   The structure is solved in its own LOCAL frame first and the finished
   point is placed into the world at the end of the vertex shader:

   ```glsl
   world = uModelR * (world * uModelS) + uModelT;
   nrm   = normalize(uModelR * nrm);
   ```

   Local-first is the whole trick. Every depth-dependent mechanism — the
   fade guards at both ends of the loop, the ring recursion, the depth fog —
   keeps measuring along *its own* tunnel, so a copy turned on its side is
   still internally self-similar rather than fogged by its distance from
   someone else's vanishing point. The key light is transformed by the same
   matrix and passed in as `uLightPos`, so each tunnel is backlit down its
   own axis.

   The instance set is replayed per copy against one shared depth buffer,
   which is what makes intersections real: where two vortexes cross, each
   occludes the other face by face instead of one being painted over the
   top. Uniform scale leaves the normal alone and the rotation is
   orthonormal, so no inverse-transpose is needed.

   The lattice is built once, so a copy costs draw calls and triangles but
   no CPU rebuild and no extra memory. Cost is linear: four copies is four
   times the triangles.

Shading is two-sided: once forms are large enough they overlap into a shell
around the camera, and with backface culling every face would point away.

### Contraction and funnel

`q` is what you see — the on-screen shrink per ring. `FUNNEL` decides how
that shrink is physically achieved:

```
μ = (1/q)^(1−f)      λ = q^f
```

- `f = 0` — straight cylinder. All apparent shrink comes from distance.
  Maximum depth.
- `f = 1` — the tunnel physically narrows to nothing and the scene flattens
  into a spiral with no depth at all.
- `0.1 – 0.3` — real depth with a vortex read. This is the useful band.

### Seamlessness, and the three rules it actually took

Every per-instance property must be a function of the spoke index, the
shell/ribbon index, and the **continuous** ring coordinate `e` — never of an
integer index. That rule is necessary but nowhere near sufficient, and each
of the others below was found by a test rather than by inspection.

**1 — Both ends must be invisible when the set shifts.** On each wrap the
whole lattice slides one ring, gaining a band at the near end and losing one
at the far end. The vertex shader scales both bands to zero.

**2 — Every tier's period must divide one ring.** Ribbon wobble uses integer
harmonics of `e`; ribbon beads ride an integer-per-ring lattice. An earlier
version spaced beads "every Nth segment", which keyed placement to the
integer segment index — the one-ring slide then moved every bead by
`segments-per-ring mod N` slots.

**3 — Every tier's minimum `ringE` must be ≤ −2** (the guard invariant), and
its generated range must extend a full ring past that. The near guard is zero
below −1, so a tier whose minimum sits higher has part of its appearing band
inside the fading region and pops in at partial scale. This bit twice: the
ribbon tier started at −2 with 0.1-ring spacing, so ten segments appeared
across [−2, −1.1], the last at 41% scale; and the brick and shell offsets
were *added*, lifting those tiers' minima to −1.75 and higher. Offsets are
now subtracted, and `buildLattice` checks the invariant and warns.

Being off-screen is not a substitute for any of this — inner shells have a
smaller radius, so their appearing ring is inside the frustum regardless.

`window.__pleroma.copyState()` returns the resolved per-copy transforms, so
the render harness can assert what reached the GPU rather than inferring it
from the picture.

`looptest.js` checks the only thing that actually matters: `frame(p)` must be
byte-identical to `frame(p+1)`. It currently reports a mean difference of
0.0000 with a worst channel of 0, at four separate phases.

An earlier version of the test instead compared the wrap step against its
neighbouring steps, and kept reporting a 1.35x jump. That was a false alarm:
step size genuinely varies around the cycle, and measuring the same
`0.99 -> 1.00` step *without* wrapping gives the identical number (20.031
either way). Don't reintroduce that formulation.

### Lighting

The key light sits at the vanishing point, so the scene is backlit and every
form picks up a rim. Haze fades toward the *void* colour rather than toward
the light — fading toward the light turns the whole mid-field the same pale
cream and destroys the depth read. Brightness deep in the tunnel instead comes
from genuine proximity to the light source, which is what actually happens
down there.

### Surface banding

Each form's pattern is evaluated in its own **object space**, so the banding
wraps the solid instead of sliding across it. Latitude rings, concentric
rings, petals or a checker, with a per-instance frequency jitter so
neighbours don't march in lockstep, and a duty-cycle bias so the accent reads
as thin inlay rather than a half-and-half stripe.

---

## Layout

```
index.html           markup and the control panel
main.js              UI binding, camera, frame loop
engine/
  meshes.js          lathe generator, 30 wall forms, swept tube + prism bars
  video.js           offline clip recording (WebCodecs / MediaRecorder)
  mp4.js             minimal ISO-BMFF muxer for H.264
  lattice.js         the recursive placement (the one idea)
  render.js          GL resources, three draw passes
  palette.js         material palettes
  mat4.js            minimal matrix helpers
```

Only structural controls rebuild the instance buffers. Everything else is a
uniform, so dragging a light or material slider never touches the CPU.

---

## Controls

Drag to look around. `☰ CTRL` toggles the panel.

Dragging writes back into the `ROTATE X` and `ROTATE Y` sliders rather than
keeping a separate hidden angle, so the mouse and the sliders can never
disagree, and `LEVEL` and `RESET` always reflect the real orientation. The
auto-tumble rates advance the same sliders, wrapping to [-180, 180].

`PIVOT DISTANCE` decides what the angles mean. At 0 the camera sits on the
tunnel axis and the angles rotate the view in place — Z rolls the scene, and
past about 30° X and Y swing the tunnel out of frame so you see the void
behind it. Raise `PIVOT` and the camera orbits a point that far down the
tunnel instead, so the structure tumbles while staying framed.

The two agree exactly at zero rotation (the eye lands on the origin for every
pivot value), so moving `PIVOT` on its own changes nothing — it only changes
what the angles do.

| Group | What matters |
|---|---|
| Tunnel | `CONTRACTION` and `FUNNEL` set the recursion; `SPOKES` × `SHELLS` set density |
| Ornaments | `FORM SET` picks the vocabulary |
| Branch Fractal | `DEPTH` and `BRANCHES` set recursion; `CONTRACTION` and `ORBIT` set the attractor's shape |
| Ribbons | `TURN RATE` winds them; `TUBE RADIUS` 0.4–0.6 slims them; `WOBBLE HARMONIC` must stay an integer; `RIBBON SHAPE` and `HARD ANGLES` make them angular |
| Material | `BAND BIAS` controls how much accent shows; `INLAY SHARPNESS` how crisply |
| Light | `KEY` comes from the vanishing point, `FILL` from the camera |
| Video | `SECONDS PER LOOP` sets the clip; `PERFECT LOOP` snaps the motion so it repeats exactly |
| Copies | `COPIES` duplicates the whole structure; `EDIT COPY` picks which one the OFFSET/TURN/SCALE sliders address |
| Orientation | `ROTATE X/Y/Z` tilt, turn and roll; `SPIN X/Y/Z` tumble it; `PIVOT` decides whether it turns in place or orbits |
| Camera & Motion | `FLY SPEED` is loop-safe at any value |

### Video

`● RECORD VIDEO` writes an MP4 (H.264) where the browser has a WebCodecs
encoder, and a WebM otherwise.

Frames are NOT captured in real time: each is drawn to completion and then
encoded, so the export is decoupled from how fast the machine renders.

**MediaRecorder cannot do this, and finding that out took three tries.** It
stamps every frame with its ARRIVAL time. `captureStream(0)` +
`requestFrame()` controls WHICH frames are recorded but not WHEN they are
said to occur, so a scene rendering at 0.3 fps yields a file that PLAYS at
0.3 fps — a 48-frame two-second clip came out a perfectly valid 649 KB MP4
lasting 131 seconds. Feeding explicitly timestamped `VideoFrame`s through a
`MediaStreamTrackGenerator` does not help either: the same clip, with correct
presentation timestamps on every frame, still came out 139 seconds long.
MediaRecorder has no offline mode.

Each of those bad files passed a "does the clip have content" check without
trouble, which is why the test asserts DURATION against ffprobe and not just
byte count.

So MP4 goes through WebCodecs instead. `VideoEncoder` honours each frame's
timestamp exactly and returns encoded chunks; `mp4.js` wraps them in a
container — ftyp / mdat / moov, one H.264 track, constant frame duration,
moov last so every sample offset is known without patching. Render speed then
has no bearing on the result: a 4K clip that takes an hour still plays at the
rate you asked for.

WebM keeps the MediaRecorder path, because hand-muxing WebM is a far bigger
job than MP4. That path is still timed by arrival, so it paces itself to the
wall clock and counts frames that came out late, reporting a stretched clip
instead of quietly handing one back.

It also lets the phase be driven by frame INDEX. The scene is 1-periodic in
phase, so stepping 0 -> (N-1)/N over N frames lands exactly back on frame
zero: the loop is seamless by construction, not by tuning.

`PERFECT LOOP` extends that to the camera, which is otherwise what gives a
"seamless" loop away — a tumble completing 2.3 turns jumps on repeat.
`loopSnap` rounds `TUNNEL SPIN` and each `SPIN` axis to a whole number of
turns per loop (rates under one turn per loop snap to zero), and the
fly-through comes from the frame index instead of `FLY SPEED`. Turn it off to
record exactly what is on screen.

Both exporters share `framing()`, so the video inherits the PNG's no-crop
rule; it additionally rounds both dimensions to even numbers, since H.264
rejects odd ones.

`↓ SAVE PNG` renders at full quality regardless of the preview resolution.
`SAVE SHAPE` picks the aspect; because the projection is built from VERTICAL
field of view, saving at a shape narrower than the window would silently crop
the sides, so the vertical fov is widened to compensate. The saved frame
always contains what was on screen — it can add area, never remove it.

---

## Performance

Cost is `instances × triangles-per-form × copies`. The defaults are roughly
8,000 solids at ~400 triangles — about 3M triangles per frame in 17 instanced
draw calls, comfortable on any discrete GPU. `COPIES` multiplies both figures
directly: 4 copies is 68 draw calls and 12M triangles.

Branch clusters span roughly `2 × (1 + orbit × (1 + contraction))` times the
base scale. If that exceeds the spoke spacing `2πR₀/spokes` the clusters merge
into mush — which is exactly what the first tuning pass did. Raise `SPOKES`
and lower `ORNAMENT SCALE` together, or the reverse.

`DEPTH` is the dangerous knob: each step multiplies the node count by
`branches`. Depth 4 at 4 branches is 341 solids per wall position, which at
26 spokes × 32 rings is 283,000 instances. If it crawls, drop `DEPTH` first,
then `SHELLS`, then `SPOKES`. Resolution scaling is in the Quality group.

---

## Known gaps

- **Ribbons are helices only.** They wind, wobble and carry beads, and they
  can be angular, but they cannot branch, knot or cross between shells.
- **One ribbon shape at a time.** All ribbons share a cross-section; there is
  no mixing round and square in one scene.
- **No audio.** The muxer writes one video track and nothing else.
- **WebM clips are only as accurate as the render keeps up.** MP4 is exact at
  any render speed; WebM is paced in real time and says when it slipped.
- **The muxer is deliberately minimal.** No fragmentation, no edit lists, no
  B-frame reordering, and the 32-bit box size caps a clip at 4 GB.
- **Copies are rigid and identical.** Each one is the same lattice placed
  differently — same seed, same forms. A per-copy seed would need a separate
  lattice build per copy.
- **One background glow.** The bloom pass is anchored to copy one's
  projected axis; further copies get the in-shader proximity glow but not a
  screen-space halo of their own.
- **No LOD.** Distant forms carry the same triangle count as near ones.
- **Uniform density.** Real compositions in this genre breathe — they have
  gaps and quiet passages. The lattice is relentless.
- **No self-shadowing or ambient occlusion.** Contact between forms reads
  softer than it should.

---

Created with help from Claude AI
