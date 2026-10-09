# EDOLUS — remake

A recreation of the cinematic "journey into AI infrastructure" from edolus.com. It uses raw WebGL2 and the Web Audio API, with no dependencies and no build step. All particle formations, copy and audio are made fresh in code.

## Run

```bash
cd portofolio1
python3 -m http.server 8000   # or: npx serve .
# open http://localhost:8000
```

Opening `index.html` directly from disk also works.

## Structure

| File | Purpose |
|---|---|
| `js/scenes.js` | Builds 8 particle formations procedurally: galaxy, server aisles, globe with network arcs, chip and traces, orbital constellation, quantum lattice, neural layers, horizon ring |
| `js/gl.js` | Particle engine: GPU morphing between formations, depth-of-field sprites, HDR bloom chain, chromatic aberration, grain, camera keyframes per chapter |
| `js/audio.js` | Generative score: drone and pad that glide to a new root note per chapter, noise that follows scroll speed, chimes on chapter change |
| `js/main.js` | Loader, smoothed scroll → chapter progress, chapter reveals, rail and index menu, HUD telemetry, custom cursor, keyboard navigation |
| `css/styles.css` | Layout, typography and motion |

## Tweaking

- **Camera, colours, spin and lens shift per chapter:** the `SCENES` array in `js/gl.js`.
- **Particle count:** `side` in `Engine.init`. 256² = 65,536 on desktop and 176² on mobile.
- **Copy:** each `<section class="chapter">` in `index.html`. If you add or remove a section, add or remove a generator in `scenes.js` and an entry in `SCENES` too.
