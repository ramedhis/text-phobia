const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const panicBadge = document.getElementById("panicBadge");

const state = {
  text: document.getElementById("textInput").value,
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 48,
  textColor: "#f2ede2",
  bgColor: "#0b0a08",
  marginTop: 90,
  marginRight: 90,
  marginBottom: 90,
  marginLeft: 90,
  textAlign: "left",
  radius: 140,
  strength: 14,
  spring: 8,
  damp: 85,
  tremble: 2,
  calmSpeed: 8,
  randomizeCalm: true,
  wobble: true,
  autoMode: false,
  showGuide: true,
  showPointer: true,
  showRadius: true,
  showPanic: true,
  autoScroll: false,
  autoScrollSpeed: 40,
  showScrollbar: true,
  hyphenate: false,
  zoom: 1,
};

let letters = [];
let mouseX = -9999, mouseY = -9999;
let hasPointer = false;
let autoT = 0;
let panicLevel = 0;
let scrollY = 0;
let autoScrollT = 0; // 0..1 progress through the one-shot eased auto-scroll
let totalContentHeight = 0;
let isDraggingScrollbar = false;
let dragOffsetY = 0;
let lastFrameTime = performance.now();

function contentBox() {
  const x = state.marginLeft;
  const y = state.marginTop;
  const w = canvas.width - state.marginLeft - state.marginRight;
  const h = canvas.height - state.marginTop - state.marginBottom;
  return { x, y, w: Math.max(10, w), h: Math.max(10, h) };
}

// Color helpers: derive the on-canvas indicator colors (margin guide,
// scrollbar, radius circle, pointer dot, panic bits) from whatever text/bg
// colors the user picked, instead of a hardcoded accent color.
function hexToRgb(hex) {
  let h = (hex || "#ffffff").replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const num = parseInt(h, 16) || 0;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLightness(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Updates the DOM badges (fear radius label, panic label + bar) to sit
// comfortably on top of whatever background color the canvas currently has.
function applyCanvasAccent() {
  const bgIsLight = relativeLightness(state.bgColor) > 0.55;
  const overlay = bgIsLight ? "0,0,0" : "255,255,255";
  const badgeBg = `rgba(${overlay},0.45)`;
  document.querySelectorAll(".fear-badge, .panic").forEach((el) => {
    el.style.background = badgeBg;
    el.style.color = state.textColor;
  });
  const panicBar = document.querySelector(".panic-bar");
  if (panicBar) panicBar.style.background = `rgba(${overlay},0.25)`;
  const panicFill = document.getElementById("panicFill");
  if (panicFill) panicFill.style.background = state.textColor;
}

function layoutText() {
  letters = [];
  const box = contentBox();
  ctx.font = `${state.fontSize}px ${state.fontFamily}`;
  const lineHeight = state.fontSize * 1.35;
  const spaceWidth = ctx.measureText(" ").width;

  const paragraphs = state.text.split("\n");
  let docY = lineHeight / 2;

  paragraphs.forEach((paragraph) => {
    if (paragraph.trim() === "") {
      docY += lineHeight;
      return;
    }
    const words = paragraph.split(" ");
    let lineWords = [];
    let lineWidth = 0;

    function flushLine(isLast) {
      let docX = 0;
      let extraGap = 0;
      if (state.textAlign === "center") {
        docX = (box.w - lineWidth) / 2;
      } else if (state.textAlign === "right") {
        docX = box.w - lineWidth;
      } else if (
        state.textAlign === "justify" &&
        !isLast &&
        lineWords.length > 1
      ) {
        extraGap = (box.w - lineWidth) / (lineWords.length - 1);
      }
      lineWords.forEach((word, wi) => {
        for (const ch of word) {
          const w = ctx.measureText(ch).width;
          letters.push({
            char: ch,
            docX: docX + w / 2,
            docY: docY,
            x: box.x + docX + w / 2,
            y: box.y + docY,
            ox: 0,
            oy: 0,
            vx: 0,
            vy: 0,
            fear: 0,
            phase: Math.random() * Math.PI * 2,
            angleJitter: (Math.random() - 0.5) * 1.0,
            speedMult: 0.55 + Math.random() * 1.1,
            calmMult: 0.3 + Math.random() * 2.2,
          });
          docX += w;
        }
        if (wi < lineWords.length - 1) docX += spaceWidth + extraGap;
      });
      docY += lineHeight;
      lineWords = [];
      lineWidth = 0;
    }

    function measureWord(w) {
      return [...w].reduce((a, c) => a + ctx.measureText(c).width, 0);
    }

    // Tries to split `word` into a hyphenated chunk that fits `availWidth`
    // plus a remainder. Follows basic hyphenation etiquette: never strand a
    // single letter on either side of the hyphen. Returns null if a decent
    // break isn't possible, so the caller falls back to normal wrapping.
    function breakWord(word, availWidth) {
      const MIN_BEFORE = 2; // min letters kept before the hyphen
      const MIN_AFTER = 2; // min letters pushed to the next line
      const chars = [...word];
      if (chars.length < MIN_BEFORE + MIN_AFTER) return null; // too short to hyphenate decently

      const hyphenWidth = ctx.measureText("-").width;
      let w = 0,
        count = 0;
      for (let i = 0; i < chars.length; i++) {
        const cw = ctx.measureText(chars[i]).width;
        if (w + cw + hyphenWidth > availWidth) break;
        w += cw;
        count++;
      }

      // Clamp to the largest break point that still respects both minimums.
      const maxCount = chars.length - MIN_AFTER;
      if (count > maxCount) count = maxCount;
      if (count < MIN_BEFORE) return null;

      // Recompute the exact width for the clamped count.
      w = 0;
      for (let i = 0; i < count; i++) w += ctx.measureText(chars[i]).width;

      return {
        chunk: chars.slice(0, count).join("") + "-",
        chunkWidth: w + hyphenWidth,
        rest: chars.slice(count).join(""),
      };
    }

    const queue = words.slice();
    let qi = 0;
    while (qi < queue.length) {
      const word = queue[qi];
      const wWidth = measureWord(word);
      const extra = lineWords.length > 0 ? spaceWidth : 0;
      const avail = box.w - lineWidth - extra;

      if (wWidth <= avail) {
        lineWords.push(word);
        lineWidth += extra + wWidth;
        qi++;
        continue;
      }

      if (state.hyphenate) {
        const brk = breakWord(word, Math.max(0, avail));
        if (brk) {
          lineWords.push(brk.chunk);
          lineWidth += extra + brk.chunkWidth;
          flushLine(false);
          queue[qi] = brk.rest;
          continue; // reprocess the leftover chunk on the fresh line
        }
      }

      if (lineWords.length === 0) {
        // Nothing to break onto a fresh line, and it still doesn't fit
        // (or hyphenation is off / found no room) — place it as-is rather
        // than looping forever; it may overflow the box slightly.
        lineWords.push(word);
        lineWidth += wWidth;
        qi++;
        continue;
      }

      // Doesn't fit and couldn't be split usefully — push the whole word
      // to the next line, same as the original behavior.
      flushLine(false);
    }
    if (lineWords.length > 0) flushLine(true);
  });

  totalContentHeight = docY + lineHeight / 2;
  const maxScroll = Math.max(0, totalContentHeight - box.h);
  scrollY = Math.min(scrollY, maxScroll);
}

function applyZoom() {
  const baseMaxW = Math.min(window.innerWidth * 0.84, 760);
  const baseMaxH = window.innerHeight * 0.88;
  canvas.style.maxWidth = baseMaxW * state.zoom + "px";
  canvas.style.maxHeight = baseMaxH * state.zoom + "px";
}

function getCursorTarget() {
  const box = contentBox();
  if (state.autoMode) {
    autoT += 0.015;
    const cx = box.x + box.w / 2 + Math.sin(autoT * 1.3) * box.w * 0.38;
    const cy = box.y + box.h / 2 + Math.cos(autoT * 0.9) * box.h * 0.38;
    return { x: cx, y: cy, active: true };
  }
  return { x: mouseX, y: mouseY, active: hasPointer };
}

function step(dt) {
  const box = contentBox();
  const cursor = getCursorTarget();
  const springK = state.spring / 1000;
  const dampK = state.damp / 100;
  const t = performance.now() / 1000;
  const calmRate = state.calmSpeed / 1000;
  const inset = state.fontSize * 0.35;
  const minX = inset, maxX = canvas.width - inset;
  const minY = inset, maxY = canvas.height - inset;
  const simBuffer = state.fontSize * 1.1;
  const REST_EPS = 1.2;
  const VEL_EPS = 0.05;
  let totalDisp = 0;

  if (state.autoScroll) {
    const maxScroll = Math.max(0, totalContentHeight - box.h);
    if (maxScroll > 0 && autoScrollT < 1) {
      // autoScrollSpeed is treated as a nominal px/s pace; the eased curve
      // below speeds up out of that pace in the middle and eases back down
      // to it (and to zero) at both ends, so the whole pass still takes
      // roughly maxScroll/speed seconds.
      const speed = Math.max(1, state.autoScrollSpeed);
      const duration = maxScroll / speed;
      autoScrollT = Math.min(1, autoScrollT + dt / duration);
      const eased =
        autoScrollT < 0.5
          ? 4 * autoScrollT * autoScrollT * autoScrollT
          : 1 - Math.pow(-2 * autoScrollT + 2, 3) / 2;
      scrollY = eased * maxScroll;
    } else if (maxScroll <= 0) {
      scrollY = 0;
    }
  }

  letters.forEach((L) => {
    const homeX = box.x + L.docX;
    const homeY = box.y + L.docY - scrollY;

    const visible =
      homeY > box.y - simBuffer && homeY < box.y + box.h + simBuffer;
    if (!visible) {
      L.ox = 0;
      L.oy = 0;
      L.vx = 0;
      L.vy = 0;
      L.fear = 0;
      L.x = homeX;
      L.y = homeY;
      return;
    }

    // Actual on-screen position is always home (moves instantly with scroll,
    // like normal text) plus a fear-offset that only physics ever touches.
    L.x = homeX + L.ox;
    L.y = homeY + L.oy;

    const dx = L.x - cursor.x;
    const dy = L.y - cursor.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const rMult = state.randomizeCalm ? L.calmMult : 1;
    const active = cursor.active && dist < state.radius;

    if (active) {
      const angle = Math.atan2(dy, dx) + L.angleJitter;
      const push = (1 - dist / state.radius) * state.strength * L.speedMult;
      L.vx += Math.cos(angle) * push;
      L.vy += Math.sin(angle) * push;
      L.fear = 1;
    } else if (L.fear > 0) {
      L.fear = Math.max(0, L.fear - calmRate * rMult);
    }

    const settled =
      !active &&
      L.fear <= 0 &&
      Math.abs(L.ox) < REST_EPS &&
      Math.abs(L.oy) < REST_EPS &&
      Math.abs(L.vx) < VEL_EPS &&
      Math.abs(L.vy) < VEL_EPS;

    if (settled) {
      L.ox = 0;
      L.oy = 0;
      L.vx = 0;
      L.vy = 0;
    } else {
      // spring pulls the offset back to zero (i.e. back home), independent of scroll
      L.vx += (0 - L.ox) * springK * L.speedMult;
      L.vy += (0 - L.oy) * springK * L.speedMult;

      if (state.tremble > 0 && L.fear > 0) {
        L.vx +=
          Math.sin(t * (6 + L.speedMult * 3) + L.phase) *
          state.tremble *
          0.08 *
          L.fear;
        L.vy +=
          Math.cos(t * (5 + L.speedMult * 3) + L.phase * 1.3) *
          state.tremble *
          0.08 *
          L.fear;
      }

      L.vx *= dampK;
      L.vy *= dampK;
      L.ox += L.vx;
      L.oy += L.vy;

      let ax = Math.min(maxX, Math.max(minX, homeX + L.ox));
      let ay = Math.min(maxY, Math.max(minY, homeY + L.oy));
      L.ox = ax - homeX;
      L.oy = ay - homeY;
    }

    L.x = homeX + L.ox;
    L.y = homeY + L.oy;

    const disp = Math.sqrt(L.ox * L.ox + L.oy * L.oy);
    totalDisp += disp;
  });

  panicLevel =
    panicLevel * 0.9 +
    Math.min(100, (totalDisp / Math.max(1, letters.length)) * 1.6) * 0.1;
}

function render() {
  const box = contentBox();
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.fillStyle = state.textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${state.fontSize}px ${state.fontFamily}`;

  // Letters are skipped (not simulated, not drawn) once their home position
  // scrolls far enough past the margin — that's what gives the top/bottom
  // "text window" cutoff during scrolling. There's no hard clip line here,
  // so a letter that's still in play but fleeing the cursor can cross the
  // margin and be seen right up to the true canvas edge, same as it already
  // could sideways.
  const simBuffer = state.fontSize * 1.1;
  letters.forEach((L) => {
    const homeY = box.y + L.docY - scrollY;
    if (homeY < box.y - simBuffer || homeY > box.y + box.h + simBuffer) return;
    ctx.save();
    ctx.translate(L.x, L.y);
    if (state.wobble && L.fear > 0) {
      const angle = Math.atan2(L.oy, L.ox);
      const mag =
        Math.min(1, Math.sqrt(L.ox * L.ox + L.oy * L.oy) / 120) * L.fear;
      ctx.rotate(Math.sin(angle) * mag * 0.35);
    }
    ctx.fillText(L.char, 0, 0);
    ctx.restore();
  });

  ctx.restore();

  if (state.showGuide) {
    ctx.save();
    ctx.strokeStyle = hexToRgba(state.textColor, 0.35);
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  const maxScroll = Math.max(0, totalContentHeight - box.h);
  if (maxScroll > 0 && state.showScrollbar) {
    const trackX = canvas.width - 12;
    const thumbH = Math.max(24, box.h * (box.h / totalContentHeight));
    const thumbY = box.y + (box.h - thumbH) * (scrollY / maxScroll);
    const bgOverlay = relativeLightness(state.bgColor) > 0.55 ? "0,0,0" : "255,255,255";
    ctx.save();
    ctx.fillStyle = `rgba(${bgOverlay},0.1)`;
    ctx.fillRect(trackX, box.y, 5, box.h);
    ctx.fillStyle = hexToRgba(state.textColor, 0.6);
    ctx.fillRect(trackX, thumbY, 5, thumbH);
    ctx.restore();
  }

  let cursorForDraw = null;
  if (!state.autoMode && hasPointer) cursorForDraw = { x: mouseX, y: mouseY };
  else if (state.autoMode) cursorForDraw = getCursorTarget();

  if (cursorForDraw) {
    if (state.showRadius) {
      ctx.save();
      ctx.strokeStyle = hexToRgba(state.textColor, 0.5);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cursorForDraw.x, cursorForDraw.y, state.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (state.showPointer) {
      ctx.save();
      ctx.fillStyle = state.textColor;
      ctx.beginPath();
      ctx.arc(cursorForDraw.x, cursorForDraw.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function loop(now) {
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  step(dt);
  render();
  document.getElementById("panicFill").style.width = Math.round(panicLevel) + "%";
  requestAnimationFrame(loop);
}

function localCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("pointermove", (e) => {
  const p = localCoords(e);
  if (isDraggingScrollbar) {
    const box = contentBox();
    const maxScroll = Math.max(0, totalContentHeight - box.h);
    const thumbH = Math.max(24, box.h * (box.h / totalContentHeight));
    const trackRange = box.h - thumbH;
    const ratio = trackRange > 0 ? (p.y - box.y - dragOffsetY) / trackRange : 0;
    scrollY = Math.min(maxScroll, Math.max(0, ratio * maxScroll));
  } else {
    mouseX = p.x;
    mouseY = p.y;
    hasPointer = true;
  }
});
canvas.addEventListener("pointerdown", (e) => {
  const p = localCoords(e);
  const box = contentBox();
  const maxScroll = Math.max(0, totalContentHeight - box.h);
  if (maxScroll > 0 && state.showScrollbar && p.x > canvas.width - 20) {
    isDraggingScrollbar = true;
    const thumbH = Math.max(24, box.h * (box.h / totalContentHeight));
    const thumbY = box.y + (box.h - thumbH) * (scrollY / maxScroll);
    dragOffsetY = p.y - thumbY;
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener("pointerup", () => {
  isDraggingScrollbar = false;
});
canvas.addEventListener("pointerleave", () => {
  hasPointer = false;
  isDraggingScrollbar = false;
});
canvas.addEventListener(
  "wheel",
  (e) => {
    const box = contentBox();
    const maxScroll = Math.max(0, totalContentHeight - box.h);
    if (maxScroll <= 0) return;
    scrollY = Math.min(maxScroll, Math.max(0, scrollY + e.deltaY));
    e.preventDefault();
  },
  { passive: false },
);

function bindRange(id, key, valId, fmt) {
  const el = document.getElementById(id);
  const out = document.getElementById(valId);
  el.addEventListener("input", () => {
    let v = parseFloat(el.value);
    state[key] = v;
    if (out) out.textContent = fmt ? fmt(v) : v;
    if (key === "radius")
      document.getElementById("badgeRadius").textContent = v;
  });
}
bindRange("radius", "radius", "radiusVal");
bindRange("strength", "strength", "strengthVal");
bindRange("spring", "spring", "springVal", (v) => (v / 100).toFixed(2));
bindRange("damp", "damp", "dampVal", (v) => (v / 100).toFixed(2));
bindRange("tremble", "tremble", "trembleVal");
bindRange("calmSpeed", "calmSpeed", "calmVal", (v) => (v / 10).toFixed(1));
bindRange("autoScrollSpeed", "autoScrollSpeed", "autoScrollSpeedVal");

document.getElementById("zoom").addEventListener("input", (e) => {
  state.zoom = parseInt(e.target.value) / 100;
  document.getElementById("zoomVal").textContent = e.target.value + "%";
  applyZoom();
});

document.getElementById("fontSize").addEventListener("input", (e) => {
  state.fontSize = parseInt(e.target.value);
  document.getElementById("fontSizeVal").textContent = state.fontSize;
  layoutText();
});
document.getElementById("fontFamily").addEventListener("change", (e) => {
  state.fontFamily = e.target.value;
  layoutText();
});
document.querySelectorAll("#alignToggle .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document
      .querySelectorAll("#alignToggle .chip")
      .forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.textAlign = chip.dataset.align;
    layoutText();
  });
});

document.getElementById("textColor").addEventListener("input", (e) => {
  state.textColor = e.target.value;
  applyCanvasAccent();
});
document.getElementById("bgColor").addEventListener("input", (e) => {
  state.bgColor = e.target.value;
  applyCanvasAccent();
});
document.getElementById("wobble").addEventListener("change", (e) => {
  state.wobble = e.target.checked;
});
document.getElementById("showGuide").addEventListener("change", (e) => {
  state.showGuide = e.target.checked;
});
document.getElementById("showPointer").addEventListener("change", (e) => {
  state.showPointer = e.target.checked;
});
document.getElementById("showRadius").addEventListener("change", (e) => {
  state.showRadius = e.target.checked;
  document.getElementById("radiusBadge").style.display = state.showRadius
    ? "block"
    : "none";
});
document.getElementById("showPanic").addEventListener("change", (e) => {
  state.showPanic = e.target.checked;
  panicBadge.style.display = state.showPanic ? "flex" : "none";
});
document.getElementById("randomizeCalm").addEventListener("change", (e) => {
  state.randomizeCalm = e.target.checked;
});
document.getElementById("autoScroll").addEventListener("change", (e) => {
  state.autoScroll = e.target.checked;
  if (state.autoScroll) {
    scrollY = 0;
    autoScrollT = 0;
  }
});
document.getElementById("showScrollbar").addEventListener("change", (e) => {
  state.showScrollbar = e.target.checked;
});
document.getElementById("hyphenate").addEventListener("change", (e) => {
  state.hyphenate = e.target.checked;
  layoutText();
});

document.getElementById("textInput").addEventListener("input", (e) => {
  state.text = e.target.value || " ";
  layoutText();
});

const marginIds = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
marginIds.forEach((id) => {
  document.getElementById(id).addEventListener("input", (e) => {
    const v = Math.max(0, parseInt(e.target.value) || 0);
    if (document.getElementById("marginLock").checked) {
      marginIds.forEach((mid) => {
        state[mid] = v;
        document.getElementById(mid).value = v;
      });
    } else {
      state[id] = v;
    }
    layoutText();
  });
});

document.getElementById("resetBtn").addEventListener("click", () => {
  layoutText();
});

const rack = document.getElementById("rack");
const menuToggleBtn = document.getElementById("menuToggleBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
menuToggleBtn.addEventListener("click", () => {
  rack.classList.toggle("hidden");
  const hidden = rack.classList.contains("hidden");
  menuToggleBtn.classList.toggle("collapsed", hidden);
  themeToggleBtn.classList.toggle("collapsed", hidden);
  menuToggleBtn.textContent = hidden ? "›" : "‹";
  menuToggleBtn.title = hidden ? "Show menu" : "Hide menu";
  applyZoom();
});

function setCanvasSize(w, h) {
  canvas.width = w;
  canvas.height = h;
  document.getElementById("canvasW").value = w;
  document.getElementById("canvasH").value = h;
  layoutText();
  applyZoom();
}

document.querySelectorAll(".chip[data-w]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document
      .querySelectorAll(".chip[data-w]")
      .forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    setCanvasSize(parseInt(chip.dataset.w), parseInt(chip.dataset.h));
  });
});
document.getElementById("canvasW").addEventListener("change", (e) => {
  document
    .querySelectorAll(".chip[data-w]")
    .forEach((c) => c.classList.remove("active"));
  setCanvasSize(parseInt(e.target.value) || 1080, canvas.height);
});
document.getElementById("canvasH").addEventListener("change", (e) => {
  document
    .querySelectorAll(".chip[data-w]")
    .forEach((c) => c.classList.remove("active"));
  setCanvasSize(canvas.width, parseInt(e.target.value) || 1350);
});

const modeMouse = document.getElementById("modeMouse");
const modeAuto = document.getElementById("modeAuto");
modeMouse.addEventListener("click", () => {
  state.autoMode = false;
  modeMouse.classList.add("active");
  modeAuto.classList.remove("active");
});
modeAuto.addEventListener("click", () => {
  state.autoMode = true;
  modeAuto.classList.add("active");
  modeMouse.classList.remove("active");
});

window.addEventListener("resize", applyZoom);

let mediaRecorder = null;
let recordedChunks = [];
let recordTimerInterval = null;
let recordStartTime = 0;

const recBtn = document.getElementById("recBtn");
const recDot = document.getElementById("recDot");
const recLabel = document.getElementById("recLabel");
const recTimer = document.getElementById("recTimer");
const statusText = document.getElementById("statusText");
const videoDl = document.getElementById("videoDl");
const gifBtn = document.getElementById("gifBtn");
const gifDl = document.getElementById("gifDl");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

function startVideoRecording() {
  const duration = parseFloat(document.getElementById("durationInput").value) || 5;
  const fps = parseInt(document.getElementById("fpsInput").value) || 24;
  const stream = canvas.captureStream(fps);
  let mimeType = "video/webm;codecs=vp9";
  if (!MediaRecorder.isTypeSupported(mimeType))
    mimeType = "video/webm;codecs=vp8";
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  recordedChunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    videoDl.href = url;
    videoDl.style.display = "inline-flex";
    statusText.textContent = "Video ready";
    statusText.classList.remove("active");
  };
  mediaRecorder.start();
  recordStartTime = performance.now();
  recBtn.classList.add("busy");
  recDot.classList.add("pulse");
  recLabel.textContent = "Stop recording";
  statusText.textContent = "Recording — move your mouse over the canvas";
  statusText.classList.add("active");
  videoDl.style.display = "none";

  recordTimerInterval = setInterval(() => {
    const elapsed = (performance.now() - recordStartTime) / 1000;
    recTimer.textContent = fmtTime(elapsed);
    if (elapsed >= duration) stopVideoRecording();
  }, 100);
}

function stopVideoRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  clearInterval(recordTimerInterval);
  recBtn.classList.remove("busy");
  recDot.classList.remove("pulse");
  recLabel.textContent = "Record video";
  recTimer.textContent = "0:00";
}

recBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopVideoRecording();
  } else {
    startVideoRecording();
  }
});

gifBtn.addEventListener("click", () => {
  const duration = Math.min(
    parseFloat(document.getElementById("durationInput").value) || 5,
    8,
  );
  const fps = Math.min(
    parseInt(document.getElementById("fpsInput").value) || 15,
    20,
  );
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: canvas.width,
    height: canvas.height,
    workerScript:
      "https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js",
  });

  gifBtn.disabled = true;
  gifBtn.textContent = "Capturing…";
  statusText.textContent =
    "Capturing GIF frames — move your mouse over the canvas";
  statusText.classList.add("active");
  gifDl.style.display = "none";

  const frameDelay = 1000 / fps;
  const totalFrames = Math.round(duration * fps);
  let framesCaptured = 0;

  const captureInterval = setInterval(() => {
    gif.addFrame(ctx, { copy: true, delay: frameDelay });
    framesCaptured++;
    recTimer.textContent = fmtTime(framesCaptured / fps);
    if (framesCaptured >= totalFrames) {
      clearInterval(captureInterval);
      gifBtn.textContent = "Encoding…";
      statusText.textContent = "Encoding GIF…";
      progressBar.style.display = "block";
      gif.render();
    }
  }, frameDelay);

  gif.on("progress", (p) => {
    progressFill.style.width = Math.round(p * 100) + "%";
  });

  gif.on("finished", (blob) => {
    const url = URL.createObjectURL(blob);
    gifDl.href = url;
    gifDl.style.display = "inline-flex";
    gifBtn.disabled = false;
    gifBtn.textContent = "Export GIF";
    statusText.textContent = "GIF ready";
    statusText.classList.remove("active");
    progressBar.style.display = "none";
    progressFill.style.width = "0%";
    recTimer.textContent = "0:00";
  });
});

document.fonts.ready.then(() => {
  layoutText();
  applyZoom();
  applyCanvasAccent();
  requestAnimationFrame(loop);
});

themeToggleBtn.addEventListener("click", () => {
  const isLight = document.body.classList.toggle("light-theme");
  themeToggleBtn.textContent = isLight ? "Dark" : "Light";
});
