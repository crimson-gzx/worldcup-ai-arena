(() => {
  const canvas = document.getElementById("pixel-hero");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  let W = 0, H = 0, dpr = 1, CELL = 10;
  let cells = [];
  let txt = null, txtCtx = null;   // 基色实心字
  let txtR = null, txtC = null;    // 红 / 青 单色剪影（RGB 色散）
  const colors = { dim: "#222", base: "#caa", lit: "#fff" };
  const CH_R = "#ff2a5d";
  const CH_C = "#1fe6ff";

  // 指针（设备像素，相对 canvas）；power = 影响强度的缓动 0..1
  const ptr = { x: -9999, y: -9999, active: false, power: 0 };
  let raf = 0;
  // 复用的活动块缓冲，避免每帧分配
  const active = [];
  let activeN = 0;

  function readColors() {
    const cs = getComputedStyle(root);
    colors.dim = cs.getPropertyValue("--pixel-dim").trim() || colors.dim;
    colors.base = cs.getPropertyValue("--pixel-base").trim() || colors.base;
    colors.lit = cs.getPropertyValue("--pixel-lit").trim() || colors.lit;
  }

  function makeTint(color) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const cx = c.getContext("2d");
    cx.drawImage(txt, 0, 0);
    cx.globalCompositeOperation = "source-in";
    cx.fillStyle = color;
    cx.fillRect(0, 0, W, H);
    return c;
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    // 全程在设备像素空间作画：drawImage 文字 1:1，静止实心字保持锐利
    W = canvas.width;
    H = canvas.height;

    let base = parseInt(canvas.dataset.cell, 10) || 10;
    if (cssW < 560) base = Math.max(4, Math.round(base * 0.7));
    CELL = Math.max(2, Math.round(base * dpr));

    // 离屏：实心文字（静止时即平滑实心字，非像素风）
    if (!txt) {
      txt = document.createElement("canvas");
      txtCtx = txt.getContext("2d", { willReadFrequently: true });
    }
    txt.width = W;
    txt.height = H;
    renderText();
    if (!txtCtx) return;

    // 预渲染红/青单色剪影，用于 RGB 色散
    txtR = makeTint(CH_R);
    txtC = makeTint(CH_C);

    // 按 CELL 把字形切成方块（仅含字形的块），划过时让这些块撕裂错位
    const data = txtCtx.getImageData(0, 0, W, H).data;
    cells = [];
    for (let gy = 0; gy < H; gy += CELL) {
      for (let gx = 0; gx < W; gx += CELL) {
        const cx = Math.min(W - 1, gx + (CELL >> 1));
        const cy = Math.min(H - 1, gy + (CELL >> 1));
        if (data[(cy * W + cx) * 4 + 3] > 40) {
          cells.push({
            sx: gx, sy: gy,
            w: Math.min(CELL, W - gx),
            h: Math.min(CELL, H - gy),
            ox: 0, oy: 0, vx: 0, vy: 0,
            seed: Math.random()
          });
        }
      }
    }
    active.length = cells.length;
    draw(performance.now());
  }

  function renderText() {
    if (!txtCtx) return;
    txtCtx.clearRect(0, 0, W, H);
    txtCtx.fillStyle = colors.base;
    txtCtx.textAlign = "center";
    txtCtx.textBaseline = "middle";
    const lines = W < 520 * dpr ? ["WORLD", "CUP", "2026"] : ["WORLD CUP", "2026"];
    const font = (s) => `700 ${s}px "Space Grotesk", Arial, "Helvetica Neue", sans-serif`;
    let fs = H / (lines.length + 0.6);
    txtCtx.font = font(fs);
    const widest = Math.max(...lines.map((l) => txtCtx.measureText(l).width));
    const limit = W * 0.86;
    if (widest > limit) {
      fs *= limit / widest;
      txtCtx.font = font(fs);
    }
    const lineH = fs * 1.04;
    const totalH = lineH * lines.length;
    let y = H / 2 - totalH / 2 + lineH / 2;
    for (const l of lines) {
      txtCtx.fillText(l, W / 2, y);
      y += lineH;
    }
  }

  // 横向信号失真带：自我复制 + 错位 + 通道描边
  function glitchBands(energy) {
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const by = (Math.random() * H) | 0;
      const bh = Math.max(2, (CELL * (0.6 + Math.random() * 2.2)) | 0);
      const sh = (Math.random() - 0.5) * CELL * (3 + energy * 8);
      try {
        ctx.drawImage(canvas, 0, by, W, bh, sh, by, W, bh);
      } catch (e) {}
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,42,93," + (0.2 * energy + 0.04).toFixed(3) + ")";
      ctx.fillRect(sh, by, W, 1);
      ctx.fillStyle = "rgba(31,230,255," + (0.2 * energy + 0.04).toFixed(3) + ")";
      ctx.fillRect(sh, by + bh - 1, W, 1);
      ctx.restore();
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    if (!txt) return;

    // 影响强度缓动：鼠标离开后平滑"愈合"，而不是骤停
    const target = ptr.active ? 1 : 0;
    ptr.power += (target - ptr.power) * 0.16;
    if (!ptr.active && ptr.power < 0.004) ptr.power = 0;

    // 失真强度完全由指针决定：不划过字时画面静止纯净
    const energy = ptr.power;

    // 1) 实心文字底层
    ctx.globalAlpha = 1;
    ctx.drawImage(txt, 0, 0, W, H);

    const tearing = ptr.power > 0.01;
    const R = CELL * 7.5;
    const R2 = R * R;

    if (tearing) {
      // 2) 在光标处把底层"撕开"一个柔边缺口
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const hole = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, R);
      hole.addColorStop(0, "rgba(0,0,0," + (0.96 * ptr.power).toFixed(3) + ")");
      hole.addColorStop(0.65, "rgba(0,0,0," + (0.5 * ptr.power).toFixed(3) + ")");
      hole.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hole;
      ctx.fillRect(ptr.x - R, ptr.y - R, R * 2, R * 2);
      ctx.restore();
    }

    // 3) 物理：撕裂的细颗粒块（水平为主错位 + 切片抖动，弹簧回弹）
    activeN = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      let f = 0;
      if (tearing) {
        const ccx = c.sx + c.w * 0.5;
        const ccy = c.sy + c.h * 0.5;
        const dx = ccx - ptr.x;
        const dy = ccy - ptr.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 0.0001;
          f = (1 - d / R) * ptr.power;
          const nx = dx / d;
          const ny = dy / d;
          const slice = (c.seed - 0.5) * 2; // 每块不同 → 切片撕裂
          c.vx += nx * f * f * (CELL * 0.7) + slice * f * f * (CELL * 1.2);
          c.vy += ny * f * f * (CELL * 0.3) + (c.seed - 0.5) * f * CELL * 0.4;
        }
      }

      // 弹簧（偏移趋向 0）+ 阻尼
      c.vx += -c.ox * 0.16;
      c.vy += -c.oy * 0.16;
      c.vx *= 0.78;
      c.vy *= 0.78;
      c.ox += c.vx;
      c.oy += c.vy;

      const moved = c.ox * c.ox + c.oy * c.oy > 0.5;
      if (f <= 0 && !moved) continue; // 未受影响且已归位 → 底层已画好，跳过
      active[activeN++] = c;
    }

    // 4) 三通道分离：基色 → 红左移 → 青右移（RGB 色散撕裂）
    if (activeN > 0) {
      const split = CELL * (0.45 + energy * 1.4);
      for (let i = 0; i < activeN; i++) {
        const c = active[i];
        ctx.drawImage(txt, c.sx, c.sy, c.w, c.h, c.sx + c.ox, c.sy + c.oy, c.w, c.h);
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5 + energy * 0.35;
      for (let i = 0; i < activeN; i++) {
        const c = active[i];
        ctx.drawImage(txtR, c.sx, c.sy, c.w, c.h, c.sx + c.ox - split, c.sy + c.oy, c.w, c.h);
      }
      for (let i = 0; i < activeN; i++) {
        const c = active[i];
        ctx.drawImage(txtC, c.sx, c.sy, c.w, c.h, c.sx + c.ox + split, c.sy + c.oy, c.w, c.h);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 5) 撕裂处的能量高光
    if (tearing) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, R * 0.95);
      const g = (0.22 * ptr.power).toFixed(3);
      glow.addColorStop(0, "rgba(255,228,154," + g + ")");
      glow.addColorStop(0.5, "rgba(31,230,255," + (0.09 * ptr.power).toFixed(3) + ")");
      glow.addColorStop(1, "rgba(255,228,154,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(ptr.x - R, ptr.y - R, R * 2, R * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 6) 横向信号失真带 —— 仅在指针实际撕到字形时出现
    if (tearing && activeN > 0 && Math.random() < 0.45) {
      glitchBands(energy);
    }
  }

  function loop(t) {
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  function setPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ptr.x = (clientX - rect.left) * (canvas.width / rect.width);
    ptr.y = (clientY - rect.top) * (canvas.height / rect.height);
    ptr.active = true;
  }

  canvas.addEventListener("pointermove", (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener("pointerdown", (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener("pointerleave", () => {
    ptr.active = false;
  });
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches && e.touches[0]) setPointer(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );

  // 主题切换 → 重上色 + 重绘
  new MutationObserver(() => {
    readColors();
    renderText();
    if (W) {
      txtR = makeTint(CH_R);
      txtC = makeTint(CH_C);
    }
    draw(performance.now());
  }).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });

  let rt;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(build, 120);
  };
  if (window.ResizeObserver) {
    new ResizeObserver(onResize).observe(canvas);
  } else {
    window.addEventListener("resize", onResize);
  }

  readColors();
  build();
  if (!reduce) {
    raf = requestAnimationFrame(loop);
  }
})();

// ---- 主题切换按钮 ----
(() => {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wc-theme", next);
    } catch (e) {}
  });
})();
