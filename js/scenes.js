/*
 * Procedural particle formations.
 * Every scene fills the same number of particles (SIDE * SIDE). Each particle stores
 * xyz + w, where w encodes how it is shaded in the vertex shader:
 *   w = 0          -> base colour (structure)
 *   w = 0.5        -> accent "LED" (flickers, larger)
 *   w = 1 + t      -> flow particle, t in [0,1) is the parameter along a path;
 *                     pulses of light travel along increasing t.
 */
(function () {
  const TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function tools(seed) {
    const r = mulberry32(seed);
    let spare = null;
    const T = {
      r,
      rand: (a, b) => a + (b - a) * r(),
      gauss() {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let u = 0;
        while (u === 0) u = r();
        const v = r();
        const m = Math.sqrt(-2 * Math.log(u));
        spare = m * Math.sin(TAU * v);
        return m * Math.cos(TAU * v);
      },
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      onSphere(R) {
        const z = T.rand(-1, 1), a = T.rand(0, TAU), s = Math.sqrt(1 - z * z);
        return [R * s * Math.cos(a), R * z, R * s * Math.sin(a)];
      },
      sign: () => (r() < 0.5 ? -1 : 1),
    };
    return T;
  }

  /* ---------- small math helpers ---------- */
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const frac = (x) => x - Math.floor(x);

  function slerp(a, b, t) {
    const d = Math.min(1, Math.max(-1, dot3(a, b)));
    const om = Math.acos(d);
    if (om < 1e-4) return a.slice();
    const s = Math.sin(om);
    const ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
    return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
  }

  function polyline(pts) {
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = len3([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]]);
      segs.push({ a: pts[i], b: pts[i + 1], l, s: total });
      total += l;
    }
    return {
      total,
      at(u) {
        const d = u * total;
        for (let i = 0; i < segs.length; i++) {
          const g = segs[i];
          if (d <= g.s + g.l || i === segs.length - 1) return lerp3(g.a, g.b, g.l > 0 ? (d - g.s) / g.l : 0);
        }
        return pts[pts.length - 1];
      },
    };
  }

  /* ---------- value noise for continents ---------- */
  function hash(x, y, z, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(s, 2654435761)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (i, j, k) => hash(xi + i, yi + j, zi + k, s);
    return L(
      L(L(c(0, 0, 0), c(1, 0, 0), xf), L(c(0, 1, 0), c(1, 1, 0), xf), yf),
      L(L(c(0, 0, 1), c(1, 0, 1), xf), L(c(0, 1, 1), c(1, 1, 1), xf), yf),
      zf
    );
  }
  function fbm(p, s) {
    let a = 0.5, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) {
      sum += a * vnoise(p[0] * f + 11.3, p[1] * f + 4.7, p[2] * f + 8.1, s + o);
      f *= 2.1; a *= 0.5;
    }
    return sum / 0.9375;
  }
  const isLand = (p, s, scale = 1.7, th = 0.52) => fbm([p[0] * scale, p[1] * scale, p[2] * scale], s) > th;

  function surfacePoint(T, seed, oceanKeep) {
    let p;
    for (let k = 0; k < 40; k++) {
      p = T.onSphere(1);
      if (isLand(p, seed) || T.r() < oceanKeep) break;
    }
    return p;
  }

  /* =========================================================
   * Scene 0 — Genesis: spiral galaxy of compute
   * ========================================================= */
  function genesis(N, T, put) {
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.12) {
        const p = T.onSphere(1);
        const rr = Math.pow(T.r(), 2.2) * 1.1;
        put(i, p[0] * rr, p[1] * rr * 0.55, p[2] * rr, T.r() < 0.06 ? 0.5 : 0);
      } else if (c < 0.9) {
        const arm = Math.floor(T.r() * 3);
        const rr = 0.35 + Math.pow(T.r(), 0.75) * 6.8;
        const a = (arm * TAU) / 3 + rr * 0.85 + T.gauss() * 0.22 * (1 + rr * 0.06);
        const x = Math.cos(a) * rr + T.gauss() * 0.12;
        const z = Math.sin(a) * rr + T.gauss() * 0.12;
        const y = T.gauss() * 0.06 * (1 + (7 - rr) * 0.12);
        put(i, x, y, z, T.r() < 0.035 ? 0.5 : 0);
      } else if (c < 0.95) {
        // an equatorial data ring
        const a = T.rand(0, TAU), rr = 7.6 + T.gauss() * 0.03;
        put(i, Math.cos(a) * rr, T.gauss() * 0.01, Math.sin(a) * rr, 1 + frac(a / TAU));
      } else {
        const p = T.onSphere(T.rand(4, 14));
        put(i, p[0], p[1] * 0.4, p[2], 0);
      }
    }
  }

  /* =========================================================
   * Scene 1 — AI Data Center: aisles of server racks
   * ========================================================= */
  function dataCenter(N, T, put) {
    const rows = [-3.9, -1.5, 1.5, 3.9];
    const RW = 0.72, RH = 2.4, RD = 1.0, Z0 = -18, Z1 = 18, Y = -1.3;
    const racks = [];
    for (const x of rows) for (let z = Z0; z < Z1 - RW; z += RW + 0.06) racks.push({ x, z: z + RW / 2, s: x > 0 ? -1 : 1 });
    const trays = [-3.9, -1.5, 0, 1.5, 3.9];
    const offs = trays.map(() => T.r());
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.5) {
        const k = T.pick(racks), f = T.r();
        let x, y, z;
        if (f < 0.55) { // server units on the front face
          x = k.x + (k.s * RD) / 2; y = ((Math.floor(T.r() * 24) + 0.5) / 24) * RH; z = k.z + T.rand(-RW / 2, RW / 2) * 0.92;
        } else if (f < 0.72) { // vertical frame posts
          x = k.x + (k.s * RD) / 2; y = T.r() * RH; z = k.z + (T.sign() * RW) / 2;
        } else if (f < 0.85) { // top
          x = k.x + T.rand(-RD / 2, RD / 2); y = RH; z = k.z + T.rand(-RW / 2, RW / 2);
        } else { // side panels
          x = k.x + T.rand(-RD / 2, RD / 2); y = T.r() * RH; z = k.z + (T.sign() * RW) / 2;
        }
        put(i, x, y + Y, z, 0);
      } else if (c < 0.64) { // status LEDs
        const k = T.pick(racks), slot = Math.floor(T.r() * 24);
        put(i, k.x + k.s * (RD / 2 + 0.01), ((slot + 0.5) / 24) * RH + Y, k.z + RW * 0.32 * (T.r() < 0.75 ? 1 : -1) + T.gauss() * 0.01, 0.5);
      } else if (c < 0.82) { // floor grid
        let x, z;
        if (T.r() < 0.5) { x = Math.round(T.rand(-6.5, 6.5) / 0.6) * 0.6; z = T.rand(Z0, Z1); }
        else { x = T.rand(-6.5, 6.5); z = Math.round(T.rand(Z0, Z1) / 0.6) * 0.6; }
        put(i, x, Y, z, 0);
      } else { // overhead cable trays carrying data
        const ti = Math.floor(T.r() * trays.length);
        const z = T.rand(Z0, Z1);
        const t = (z - Z0) / (Z1 - Z0);
        put(i, trays[ti] + T.gauss() * 0.04, RH + 0.55 + Y + T.gauss() * 0.02, z, 1 + frac(1 - t + offs[ti]));
      }
    }
  }

  /* =========================================================
   * Scene 2 — Planetary Network: globe + great-circle links
   * ========================================================= */
  function planetary(N, T, put) {
    const R = 3, SEED = 7;
    const cities = [];
    while (cities.length < 52) { const p = T.onSphere(1); if (isLand(p, SEED)) cities.push(p); }
    const arcs = [];
    while (arcs.length < 110) {
      const a = T.pick(cities), b = T.pick(cities);
      const ang = Math.acos(Math.min(1, Math.max(-1, dot3(a, b))));
      if (ang > 0.35) arcs.push({ a, b, ang, off: T.r() });
    }
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.56) {
        const p = surfacePoint(T, SEED, 0.06);
        put(i, p[0] * R, p[1] * R, p[2] * R, 0);
      } else if (c < 0.66) {
        const p = T.onSphere(R * (1.02 + Math.abs(T.gauss()) * 0.07));
        put(i, p[0], p[1], p[2], 0);
      } else if (c < 0.72) {
        const p = T.pick(cities);
        const q = norm3([p[0] + T.gauss() * 0.012, p[1] + T.gauss() * 0.012, p[2] + T.gauss() * 0.012]);
        put(i, q[0] * R * 1.005, q[1] * R * 1.005, q[2] * R * 1.005, 0.5);
      } else {
        const a = T.pick(arcs), t = T.r();
        const p = slerp(a.a, a.b, t);
        const h = R * (1.01 + Math.sin(t * Math.PI) * 0.16 * a.ang);
        put(i, p[0] * h, p[1] * h, p[2] * h, 1 + frac(t + a.off));
      }
    }
  }

  /* =========================================================
   * Scene 3 — Primary Compute Node: chip + circuit traces
   * ========================================================= */
  function computeNode(N, T, put) {
    const D = 1.3;
    const normals = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const traces = [];
    for (let n = 0; n < 260; n++) {
      const nr = normals[Math.floor(T.r() * 4)];
      const tg = [nr[1], -nr[0]];
      const s = T.rand(-D * 0.92, D * 0.92);
      let px = nr[0] * D + tg[0] * s, pz = nr[1] * D + tg[1] * s;
      const pts = [[px, 0, pz]];
      const L1 = T.rand(0.15, 1.1);
      px += nr[0] * L1; pz += nr[1] * L1; pts.push([px, 0, pz]);
      const d = Math.sign(s || 1) * (T.r() < 0.75 ? 1 : -1), L2 = T.rand(0.2, 2.2) * 0.7071;
      px += (nr[0] + tg[0] * d) * L2; pz += (nr[1] + tg[1] * d) * L2; pts.push([px, 0, pz]);
      const L3 = T.rand(0.3, 3.2);
      px += nr[0] * L3; pz += nr[1] * L3; pts.push([px, 0, pz]);
      traces.push({ line: polyline(pts), end: [px, pz], off: T.r() });
    }
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.24) { // die surface lattice
        let x = T.rand(-D, D), z = T.rand(-D, D);
        if (T.r() < 0.5) x = Math.round(x / 0.13) * 0.13; else z = Math.round(z / 0.13) * 0.13;
        put(i, x, 0.02, z, 0);
      } else if (c < 0.35) { // central core block
        const H = 0.75, S = 0.45, f = Math.floor(T.r() * 5);
        let x = T.rand(-S, S), y = T.rand(0.02, H), z = T.rand(-S, S);
        if (f === 0) y = H; else if (f === 1) x = S; else if (f === 2) x = -S; else if (f === 3) z = S; else z = -S;
        put(i, x, y, z, T.r() < 0.5 ? 0.5 : 0);
      } else if (c < 0.42) { // die + heat-spreader outlines
        const big = T.r() < 0.5, S = big ? 1.65 : D, y = big ? -0.08 : 0.02;
        const e = Math.floor(T.r() * 4), u = T.rand(-S, S);
        const xz = [[S, u], [-S, u], [u, S], [u, -S]][e];
        put(i, xz[0], y, xz[1], 0);
      } else if (c < 0.82) { // traces
        const tr = T.pick(traces), u = T.r();
        const p = tr.line.at(u);
        put(i, p[0], p[1] + T.gauss() * 0.004, p[2], 1 + frac(u + tr.off));
      } else if (c < 0.88) { // pads at trace ends
        const tr = T.pick(traces), a = T.rand(0, TAU);
        put(i, tr.end[0] + Math.cos(a) * 0.07, 0, tr.end[1] + Math.sin(a) * 0.07, 0.5);
      } else { // substrate dust
        const rr = Math.sqrt(T.r()) * 8.5, a = T.rand(0, TAU);
        put(i, Math.cos(a) * rr, -0.18 + T.gauss() * 0.02, Math.sin(a) * rr, 0);
      }
    }
  }

  /* =========================================================
   * Scene 4 — Orbital Intelligence: planet + constellation
   * ========================================================= */
  function orbital(N, T, put) {
    const R = 1.4, SEED = 23;
    const orbits = [];
    for (let k = 0; k < 6; k++) orbits.push({ r: 2.2 + k * 0.55, inc: T.rand(-0.65, 0.65), node: T.rand(0, TAU), off: T.r() });
    const orbitPt = (o, a) => {
      const x = Math.cos(a) * o.r, z = Math.sin(a) * o.r;
      const y2 = -z * Math.sin(o.inc), z2 = z * Math.cos(o.inc);
      return [x * Math.cos(o.node) + z2 * Math.sin(o.node), y2, -x * Math.sin(o.node) + z2 * Math.cos(o.node)];
    };
    const sats = [];
    for (const o of orbits) for (let j = 0; j < 4; j++) {
      const a = o.off * TAU + (j * TAU) / 4 + T.rand(-0.3, 0.3);
      const p = orbitPt(o, a), q = orbitPt(o, a + 0.01);
      sats.push({ p, tan: norm3([q[0] - p[0], q[1] - p[1], q[2] - p[2]]), off: T.r() });
    }
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.4) {
        const p = surfacePoint(T, SEED, 0.1);
        put(i, p[0] * R, p[1] * R, p[2] * R, 0);
      } else if (c < 0.47) {
        const p = T.onSphere(R * (1.03 + Math.abs(T.gauss()) * 0.08));
        put(i, p[0], p[1], p[2], 0);
      } else if (c < 0.67) {
        const o = T.pick(orbits), a = T.rand(0, TAU);
        const p = orbitPt(o, a);
        put(i, p[0] + T.gauss() * 0.006, p[1] + T.gauss() * 0.006, p[2] + T.gauss() * 0.006, 1 + frac(a / TAU + o.off));
      } else if (c < 0.77) {
        const s = T.pick(sats);
        let p;
        if (T.r() < 0.45) p = [s.p[0] + T.gauss() * 0.035, s.p[1] + T.gauss() * 0.035, s.p[2] + T.gauss() * 0.035];
        else { const u = T.rand(-0.24, 0.24); p = [s.p[0] + s.tan[0] * u, s.p[1] + s.tan[1] * u + T.gauss() * 0.01, s.p[2] + s.tan[2] * u]; }
        put(i, p[0], p[1], p[2], 0.5);
      } else if (c < 0.87) { // downlink beams
        const s = T.pick(sats), t = T.r();
        const g = norm3(s.p);
        const p = lerp3(s.p, [g[0] * R, g[1] * R, g[2] * R], t);
        put(i, p[0], p[1], p[2], 1 + frac(t + s.off));
      } else {
        const p = T.onSphere(T.rand(2.5, 11));
        put(i, p[0], p[1], p[2], 0);
      }
    }
  }

  /* =========================================================
   * Scene 5 — Quantum Intelligence: warped lattice + qubit core
   * ========================================================= */
  function quantum(N, T, put) {
    const S = 0.95;
    const warp = (p) => [
      p[0] + 0.2 * Math.sin(p[1] * 1.1 + p[2] * 0.7),
      p[1] + 0.2 * Math.sin(p[2] * 1.1 + p[0] * 0.7),
      p[2] + 0.2 * Math.sin(p[0] * 1.1 + p[1] * 0.7),
    ];
    const map = new Map(), nodes = [];
    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) for (let z = -4; z <= 4; z++) {
      const p = [x * S, y * S, z * S], d = len3(p);
      if (d < 4.3 && d > 1.8) { const n = { k: [x, y, z], p: warp(p) }; map.set(x + "," + y + "," + z, n); nodes.push(n); }
    }
    const edges = [];
    for (const n of nodes) {
      for (const dd of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const m = map.get(n.k[0] + dd[0] + "," + (n.k[1] + dd[1]) + "," + (n.k[2] + dd[2]));
        if (m) edges.push({ a: n.p, b: m.p, flow: T.r() < 0.3, off: T.r() });
      }
    }
    const rings = [0, 1, 2].map((k) => ({ ax: (k * Math.PI) / 3, off: T.r() }));
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.17) {
        const n = T.pick(nodes);
        put(i, n.p[0] + T.gauss() * 0.035, n.p[1] + T.gauss() * 0.035, n.p[2] + T.gauss() * 0.035, 0.5);
      } else if (c < 0.55) {
        const e = T.pick(edges), t = T.r();
        const p = lerp3(e.a, e.b, t);
        put(i, p[0], p[1], p[2], e.flow ? 1 + frac(t + e.off) : 0);
      } else if (c < 0.73) { // qubit sphere with latitude bands
        const p = T.onSphere(1.15);
        if (T.r() < 0.5) {
          const lat = Math.round((p[1] / 1.15) * 7) / 7, rr = Math.sqrt(1 - lat * lat) * 1.15, a = Math.atan2(p[2], p[0]);
          put(i, Math.cos(a) * rr, lat * 1.15, Math.sin(a) * rr, 0);
        } else put(i, p[0], p[1], p[2], 0);
      } else if (c < 0.85) { // gyroscopic rings
        const g = T.pick(rings), a = T.rand(0, TAU), rr = 1.55;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        put(i, x * Math.cos(g.ax), y, x * Math.sin(g.ax), 1 + frac(a / TAU + g.off));
      } else if (c < 0.88) {
        put(i, T.gauss() * 0.08, T.gauss() * 0.08, T.gauss() * 0.08, 0.5);
      } else {
        put(i, T.rand(-5, 5), T.rand(-5, 5), T.rand(-5, 5), 0);
      }
    }
  }

  /* =========================================================
   * Scene 6 — Autonomous Systems: layered neural fabric
   * ========================================================= */
  function autonomous(N, T, put) {
    const counts = [8, 14, 22, 28, 22, 14, 8];
    const layers = counts.map((n, l) => {
      const x = -6 + l * 2, R = Math.sqrt(n) * 0.5, out = [];
      for (let j = 0; j < n; j++) {
        const a = j * 2.39996 + l, rr = R * Math.sqrt((j + 0.5) / n);
        out.push([x, Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      return out;
    });
    const edges = [];
    for (let l = 0; l < layers.length - 1; l++) for (const a of layers[l]) for (let k = 0; k < 4; k++) edges.push({ a, b: T.pick(layers[l + 1]), off: T.r() });
    const nodes = layers.flat();
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.2) {
        const n = T.pick(nodes), p = T.onSphere(0.09 * Math.cbrt(T.r()));
        put(i, n[0] + p[0], n[1] + p[1], n[2] + p[2], 0.5);
      } else if (c < 0.8) {
        const e = T.pick(edges), t = T.r();
        const p = lerp3(e.a, e.b, t);
        put(i, p[0], p[1], p[2], T.r() < 0.6 ? 1 + frac(t + e.off) : 0);
      } else if (c < 0.9) { // halo shells around each layer
        const l = Math.floor(T.r() * layers.length), a = T.rand(0, TAU), R = Math.sqrt(counts[l]) * 0.5 + 0.35;
        put(i, -6 + l * 2, Math.cos(a) * R, Math.sin(a) * R, 0);
      } else {
        put(i, T.rand(-9, 9), T.gauss() * 1.6, T.gauss() * 1.6, 0);
      }
    }
  }

  /* =========================================================
   * Scene 7 — Horizon: the closing ring
   * ========================================================= */
  function horizon(N, T, put) {
    const rings = [{ r: 3.2, w: 0.05, tilt: 0 }, { r: 3.65, w: 0.015, tilt: 0.05 }, { r: 4.3, w: 0.01, tilt: -0.08 }];
    for (let i = 0; i < N; i++) {
      const c = T.r();
      if (c < 0.55) {
        const g = c < 0.35 ? rings[0] : c < 0.47 ? rings[1] : rings[2];
        const a = T.rand(0, TAU), rr = g.r + T.gauss() * g.w;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        put(i, x, z * Math.sin(g.tilt) + T.gauss() * g.w * 0.5, z * Math.cos(g.tilt), 1 + frac(a / TAU));
      } else if (c < 0.62) {
        const p = T.onSphere(0.5 * Math.cbrt(T.r()));
        put(i, p[0], p[1], p[2], 0.5);
      } else {
        const rr = 1.2 + Math.pow(T.r(), 0.6) * 9, a = T.rand(0, TAU);
        put(i, Math.cos(a) * rr, T.gauss() * 0.05 * rr * 0.2, Math.sin(a) * rr, 0);
      }
    }
  }

  const GENERATORS = [genesis, dataCenter, planetary, computeNode, orbital, quantum, autonomous, horizon];

  /** Fill scene `s` into `data` (Float32Array of side*side*4*count floats). */
  function buildScene(s, side, data) {
    const N = side * side;
    const T = tools(1337 + s * 97);
    const base = s * N * 4;
    GENERATORS[s](N, T, (i, x, y, z, w) => {
      const o = base + i * 4;
      data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = w;
    });
  }

  window.EdolusScenes = { buildScene, count: GENERATORS.length };
})();
