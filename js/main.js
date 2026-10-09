/* UI controller: loader, scroll-driven chapters, HUD, cursor, sound wiring. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const Engine = window.EdolusGL;
  const Sound = window.EdolusAudio;

  const chapters = $$(".chapter");
  const S = chapters.length;
  const state = { target: 0, smooth: 0, vel: 0, active: -1, nearest: 0, entered: false, mouse: [0, 0], mouseS: [0, 0] };

  /* ------------------------------------------------ split titles into chars */
  $$("[data-split]").forEach((el) => {
    const lines = el.innerHTML.split(/<br\s*\/?>/i);
    let i = 0;
    el.innerHTML = lines
      .map((line) => {
        const words = line.trim().split(/\s+/).map((w) => `<span class="word">${[...w].map((c) => `<span class="ch" style="--i:${i++}">${c}</span>`).join("")}</span>`);
        return `<span class="line">${words.join(" ")}</span>`;
      })
      .join("");
    el.setAttribute("aria-label", lines.join(" ").replace(/<[^>]+>/g, ""));
  });

  /* ------------------------------------------------ rail + menu */
  const rail = $("#rail"), menuList = $("#menuList");
  chapters.forEach((c, i) => {
    const name = c.dataset.name;
    rail.insertAdjacentHTML("beforeend", `<button data-goto="${i}" data-hover aria-label="${name}"><i></i>${pad(i)}<span>${name}</span></button>`);
    menuList.insertAdjacentHTML("beforeend", `<li><button data-goto="${i}" data-hover style="transition-delay:${i * 40}ms"><small>${pad(i)}</small>${name}</button></li>`);
  });
  $("#progTotal").textContent = pad(S);

  /* ------------------------------------------------ scroll length */
  const scroller = $("#scroller");
  const sizeScroller = () => { scroller.style.height = `${S * window.innerHeight}px`; };
  sizeScroller();
  window.addEventListener("resize", sizeScroller);

  function goto(i) {
    closeMenu();
    window.scrollTo({ top: Math.round(i * window.innerHeight), behavior: Math.abs(i - state.smooth) > 3 ? "auto" : "smooth" });
  }
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (!g) return;
    e.preventDefault();
    goto(+g.dataset.goto);
  });

  /* ------------------------------------------------ menu */
  const menu = $("#menu"), menuBtn = $("#menuBtn");
  function closeMenu() { menu.classList.remove("is-open"); menu.setAttribute("aria-hidden", "true"); menuBtn.setAttribute("aria-expanded", "false"); menuBtn.textContent = "Index"; }
  menuBtn.addEventListener("click", () => {
    const open = !menu.classList.contains("is-open");
    if (!open) return closeMenu();
    menu.classList.add("is-open"); menu.setAttribute("aria-hidden", "false"); menuBtn.setAttribute("aria-expanded", "true"); menuBtn.textContent = "Close";
  });
  menu.addEventListener("click", (e) => { if (e.target === menu) closeMenu(); });

  window.addEventListener("keydown", (e) => {
    if (!state.entered) return;
    if (e.key === "Escape") return closeMenu();
    const cur = Math.round(state.target);
    if (["ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); goto(Math.min(S - 1, cur + 1)); }
    if (["ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); goto(Math.max(0, cur - 1)); }
    if (e.key === "Home") { e.preventDefault(); goto(0); }
    if (e.key === "End") { e.preventDefault(); goto(S - 1); }
  });

  /* ------------------------------------------------ sound */
  const soundBtn = $("#soundBtn"), soundLabel = $("#soundLabel");
  function renderSound() {
    soundBtn.classList.toggle("is-on", Sound.enabled);
    soundBtn.setAttribute("aria-pressed", String(Sound.enabled));
    soundLabel.textContent = Sound.enabled ? "Sound on" : "Sound off";
  }
  soundBtn.addEventListener("click", () => { Sound.toggle(); renderSound(); });
  document.addEventListener("visibilitychange", () => {
    if (!Sound.ctx) return;
    if (document.hidden) Sound.ctx.suspend(); else if (Sound.enabled) Sound.ctx.resume();
  });

  /* ------------------------------------------------ cursor */
  const cursor = $("#cursor");
  const cur = { x: innerWidth / 2, y: innerHeight / 2, sx: innerWidth / 2, sy: innerHeight / 2 };
  window.addEventListener("pointermove", (e) => {
    cur.x = e.clientX; cur.y = e.clientY;
    state.mouse[0] = (e.clientX / innerWidth) * 2 - 1;
    state.mouse[1] = (e.clientY / innerHeight) * 2 - 1;
  });
  window.addEventListener("pointerdown", () => cursor.classList.add("is-down"));
  window.addEventListener("pointerup", () => cursor.classList.remove("is-down"));
  document.addEventListener("pointerover", (e) => {
    const h = e.target.closest("[data-hover]");
    cursor.classList.toggle("is-hover", !!h);
    if (h && h !== state.lastHover) Sound.tick();
    state.lastHover = h;
  });

  /* ------------------------------------------------ count-up stats */
  function countUp(section) {
    $$("[data-count]", section).forEach((dd) => {
      const to = parseFloat(dd.dataset.count), dec = +(dd.dataset.dec || 0);
      const t0 = performance.now(), dur = 1600;
      const fmt = (v) => (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-US"));
      cancelAnimationFrame(dd._raf);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 4);
        dd.textContent = fmt(to * e);
        if (t < 1) dd._raf = requestAnimationFrame(step);
      };
      dd._raf = requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------ chapter state */
  const hudIndex = $("#hudIndex"), hudName = $("#hudName"), progBar = $("#progBar"), progCurrent = $("#progCurrent"), hint = $("#scrollHint");
  const railBtns = $$("button", rail), menuBtns = $$("button", menuList);

  function setActive(i) {
    if (i === state.active) return;
    state.active = i;
    chapters.forEach((c, j) => c.classList.toggle("is-active", j === i));
    if (i >= 0) countUp(chapters[i]);
  }
  function setNearest(i) {
    if (i === state.nearest) return;
    state.nearest = i;
    hudIndex.textContent = pad(i);
    hudName.textContent = chapters[i].dataset.name;
    progCurrent.textContent = pad(i + 1);
    railBtns.forEach((b, j) => b.classList.toggle("is-active", j === i));
    menuBtns.forEach((b, j) => b.classList.toggle("is-active", j === i));
    if (state.entered) { Sound.setChapter(i); Engine.flash = Math.max(Engine.flash, 0.3); }
  }
  railBtns[0].classList.add("is-active");
  menuBtns[0].classList.add("is-active");

  /* ------------------------------------------------ telemetry */
  const tFps = $("#tFps"), tNodes = $("#tNodes"), tCam = $("#tCam"), tUtc = $("#tUtc");
  let teleT = 0;

  /* ------------------------------------------------ main loop */
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    state.target = Math.min(S - 1, Math.max(0, window.scrollY / window.innerHeight));
    const prev = state.smooth;
    state.smooth += (state.target - state.smooth) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(state.target - state.smooth) < 1e-4) state.smooth = state.target;
    state.vel = dt > 0 ? (state.smooth - prev) / dt : 0;

    state.mouseS[0] += (state.mouse[0] - state.mouseS[0]) * (1 - Math.exp(-dt * 2.5));
    state.mouseS[1] += (state.mouse[1] - state.mouseS[1]) * (1 - Math.exp(-dt * 2.5));
    Engine.progress = state.smooth;
    Engine.mouse = state.mouseS;

    const p = state.smooth, k = Math.floor(p), f = p - k;
    const active = !state.entered ? -1 : f < 0.3 ? k : f > 0.9 ? Math.min(k + 1, S - 1) : -1;
    setActive(active);
    setNearest(Math.min(S - 1, Math.round(p)));
    progBar.style.transform = `scaleX(${p / (S - 1)})`;
    hint.classList.toggle("is-hidden", p > 0.15);
    Sound.update(state.vel);

    cur.sx += (cur.x - cur.sx) * (1 - Math.exp(-dt * 18));
    cur.sy += (cur.y - cur.sy) * (1 - Math.exp(-dt * 18));
    cursor.style.transform = `translate3d(${cur.sx}px, ${cur.sy}px, 0)`;

    teleT += dt;
    if (teleT > 0.25 && Engine.ready) {
      teleT = 0;
      tFps.textContent = Engine.stats.fps;
      tNodes.textContent = Engine.stats.particles.toLocaleString("en-US");
      const c = Engine.lastCam;
      if (c) tCam.textContent = c.eye.map((v) => (v >= 0 ? "+" : "") + v.toFixed(1)).join(" ");
      tUtc.textContent = new Date().toISOString().slice(11, 19);
    }
  }
  requestAnimationFrame(loop);

  /* ------------------------------------------------ boot */
  const loader = $("#loader"), loaderCount = $("#loaderCount"), loaderBar = $("#loaderBar"), loaderStatus = $("#loaderStatus");
  const STATUS = ["Allocating particle buffers", "Racking accelerators", "Laying subsea fiber", "Etching silicon", "Launching constellation", "Cooling qubits", "Training agents", "Calibrating horizon", "Compiling shaders"];
  let shown = 0, goal = 0;
  (function tickLoader() {
    shown += (goal - shown) * 0.12 + (goal > shown ? 0.2 : 0);
    shown = Math.min(shown, goal);
    loaderCount.textContent = pad(Math.floor(shown), 3);
    loaderBar.style.transform = `scaleX(${shown / 100})`;
    if (shown < 100) requestAnimationFrame(tickLoader);
    else loader.classList.add("is-ready");
  })();

  window.scrollTo(0, 0);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  Engine.onFrame = ({ cam }) => { Engine.lastCam = cam; };
  Engine.init($("#gl"), (v) => {
    goal = Math.round(v * 100);
    loaderStatus.textContent = STATUS[Math.min(STATUS.length - 1, Math.floor(v * (STATUS.length - 1)))];
  }).catch((err) => {
    console.error(err);
    $("#noWebgl").hidden = false;
    loader.classList.add("is-gone");
  });

  $$("[data-enter]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.enter === "sound") Sound.start();
      renderSound();
      state.entered = true;
      document.body.classList.remove("is-loading");
      loader.classList.add("is-gone");
      Engine.flash = 0.8;
      state.active = -2; // force refresh
    })
  );
})();
