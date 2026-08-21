// ==UserScript==
// @name         text-phobia (live)
// @namespace    https://github.com/ramedhis/text-phobia
// @version      1.0.0
// @description  Injects the text-phobia fear-radius letter physics into any webpage, with a live-tunable control panel. Toggle on/off from the Tampermonkey menu.
// @author       ramedhis
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/*
  text-phobia — Tampermonkey userscript
  --------------------------------------
  Takes the fear-radius letter physics from this repo's canvas tool and
  applies it to real text on any webpage you're browsing. Includes a small
  floating panel to tune the physics live.

  It does NOT run automatically on pages you visit — you turn it on
  per-tab from the Tampermonkey menu, and turn it off the same way.

  See readme.txt in this folder for install + usage steps.
*/

(function () {
  'use strict';

  function runTextPhobia() {
  if (window.__textPhobiaStop) window.__textPhobiaStop();

  const CONFIG = {
    radius: 90,
    strength: 10,
    spring: 10,
    damp: 85,
    tremble: 2,
    calmSpeed: 10,
    randomizeCalm: true,
    wobble: true,
    maxOffset: 40
  };

  const SKIP_TAGS = new Set([
    'SCRIPT','STYLE','NOSCRIPT','IFRAME','TEXTAREA','INPUT','SELECT',
    'SVG','CANVAS','VIDEO','AUDIO','CODE','PRE'
  ]);

  function shouldSkip(el) {
    while (el) {
      if (el.nodeType === 1) {
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (el.isContentEditable) return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  // Wrap text into per-character spans
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  textNodes.forEach(node => {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    for (const ch of text) {
      if (ch.trim() === '') { frag.appendChild(document.createTextNode(ch)); continue; }
      const span = document.createElement('span');
      span.textContent = ch;
      span.className = 'tp-letter';
      span.style.display = 'inline-block';
      span.style.willChange = 'transform';
      frag.appendChild(span);
    }
    node.parentNode.replaceChild(frag, node);
  });

  // Letter physics objects + spatial
  const BAND = 60;
  const bands = new Map();
  const letters = [];

  function addToBand(L) {
    L.band = Math.floor(L.homeY / BAND);
    if (!bands.has(L.band)) bands.set(L.band, []);
    bands.get(L.band).push(L);
  }

  document.querySelectorAll('span.tp-letter').forEach(el => {
    const rect = el.getBoundingClientRect();
    const L = {
      el,
      homeX: rect.left + rect.width / 2 + window.scrollX,
      homeY: rect.top + rect.height / 2 + window.scrollY,
      ox: 0, oy: 0, vx: 0, vy: 0, fear: 0,
      phase: Math.random() * Math.PI * 2,
      angleJitter: (Math.random() - 0.5) * 1.0,
      speedMult: 0.55 + Math.random() * 1.1,
      calmMult: 0.3 + Math.random() * 2.2,
      band: 0
    };
    letters.push(L);
    addToBand(L);
  });

  // Cursor tracking
  let mouseX = -99999, mouseY = -99999, hasPointer = false;
  function onMove(e) {
    mouseX = e.clientX + window.scrollX;
    mouseY = e.clientY + window.scrollY;
    hasPointer = true;
    activateNearCursor();
  }
  function onLeave() { hasPointer = false; }
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', onLeave, { passive: true });

  const activeSet = new Set();
  function activateNearCursor() {
    if (!hasPointer) return;
    const minBand = Math.floor((mouseY - CONFIG.radius) / BAND);
    const maxBand = Math.floor((mouseY + CONFIG.radius) / BAND);
    for (let b = minBand; b <= maxBand; b++) {
      const arr = bands.get(b);
      if (!arr) continue;
      for (const L of arr) {
        const dx = (L.homeX + L.ox) - mouseX;
        const dy = (L.homeY + L.oy) - mouseY;
        if (dx * dx + dy * dy < CONFIG.radius * CONFIG.radius) activeSet.add(L);
      }
    }
  }

  // --- Physics step ---
  function step() {
    const springK = CONFIG.spring / 1000;
    const dampK = CONFIG.damp / 100;
    const calmRate = CONFIG.calmSpeed / 1000;
    const t = performance.now() / 1000;
    const REST_EPS = 0.4, VEL_EPS = 0.03;

    for (const L of Array.from(activeSet)) {
      const curX = L.homeX + L.ox;
      const curY = L.homeY + L.oy;
      const dx = curX - mouseX;
      const dy = curY - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const rMult = CONFIG.randomizeCalm ? L.calmMult : 1;
      const activeNow = hasPointer && dist < CONFIG.radius;

      if (activeNow) {
        const angle = Math.atan2(dy, dx) + L.angleJitter;
        const push = (1 - dist / CONFIG.radius) * CONFIG.strength * L.speedMult;
        L.vx += Math.cos(angle) * push;
        L.vy += Math.sin(angle) * push;
        L.fear = 1;
      } else if (L.fear > 0) {
        L.fear = Math.max(0, L.fear - calmRate * rMult);
      }

      const settled = !activeNow && L.fear <= 0 &&
        Math.abs(L.ox) < REST_EPS && Math.abs(L.oy) < REST_EPS &&
        Math.abs(L.vx) < VEL_EPS && Math.abs(L.vy) < VEL_EPS;

      if (settled) {
        L.ox = 0; L.oy = 0; L.vx = 0; L.vy = 0;
        L.el.style.transform = '';
        activeSet.delete(L);
        continue;
      }

      L.vx += (0 - L.ox) * springK * L.speedMult;
      L.vy += (0 - L.oy) * springK * L.speedMult;

      if (CONFIG.tremble > 0 && L.fear > 0) {
        L.vx += Math.sin(t * (6 + L.speedMult * 3) + L.phase) * CONFIG.tremble * 0.08 * L.fear;
        L.vy += Math.cos(t * (5 + L.speedMult * 3) + L.phase * 1.3) * CONFIG.tremble * 0.08 * L.fear;
      }

      L.vx *= dampK;
      L.vy *= dampK;
      L.ox += L.vx;
      L.oy += L.vy;

      L.ox = Math.max(-CONFIG.maxOffset, Math.min(CONFIG.maxOffset, L.ox));
      L.oy = Math.max(-CONFIG.maxOffset, Math.min(CONFIG.maxOffset, L.oy));

      let transform = `translate(${L.ox.toFixed(2)}px, ${L.oy.toFixed(2)}px)`;
      if (CONFIG.wobble && L.fear > 0) {
        const angle = Math.atan2(L.oy, L.ox);
        const mag = Math.min(1, Math.sqrt(L.ox * L.ox + L.oy * L.oy) / 40) * L.fear;
        transform += ` rotate(${(Math.sin(angle) * mag * 20).toFixed(2)}deg)`;
      }
      L.el.style.transform = transform;
    }
  }

  let rafId = requestAnimationFrame(loop);
  function loop() {
    step();
    rafId = requestAnimationFrame(loop);
  }

  // Recompute on resize
  let resizeTimeout;
  function recomputeHomes() {
    letters.forEach(L => { L.el.style.transform = ''; });
    bands.clear();
    letters.forEach(L => {
      const rect = L.el.getBoundingClientRect();
      L.homeX = rect.left + rect.width / 2 + window.scrollX;
      L.homeY = rect.top + rect.height / 2 + window.scrollY;
      L.ox = 0; L.oy = 0; L.vx = 0; L.vy = 0; L.fear = 0;
      addToBand(L);
    });
    activeSet.clear();
  }
  function onResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(recomputeHomes, 200);
  }
  window.addEventListener('resize', onResize);

  // Floating control panel
  const hostEl = document.createElement('div');
  hostEl.id = 'tp-panel-host';
  hostEl.style.cssText = 'position:fixed; top:16px; right:16px; z-index:2147483647;';
  document.body.appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: 'open' });

  const SLIDERS = [
    { key: 'radius',    label: 'Fear radius',     min: 20,  max: 250, step: 5,  suffix: 'px' },
    { key: 'strength',  label: 'Flee strength',   min: 1,   max: 40,  step: 1,  suffix: '' },
    { key: 'spring',    label: 'Return speed',    min: 1,   max: 30,  step: 1,  suffix: '' },
    { key: 'damp',      label: 'Damping',         min: 60,  max: 98,  step: 1,  suffix: '' },
    { key: 'tremble',   label: 'Tremble',         min: 0,   max: 6,   step: 1,  suffix: '' },
    { key: 'calmSpeed', label: 'Calm-down speed', min: 1,   max: 50,  step: 1,  suffix: '' },
    { key: 'maxOffset', label: 'Max travel',      min: 10,  max: 150, step: 5,  suffix: 'px' }
  ];

  const sliderRows = SLIDERS.map(s => `
    <div class="row">
      <div class="row-top"><label>${s.label}</label><span class="val" id="val-${s.key}">${CONFIG[s.key]}${s.suffix}</span></div>
      <input type="range" id="s-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${CONFIG[s.key]}">
    </div>
  `).join('');

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        width: 220px;
        background: #fffffff0;
        border: 1px solid #d9d9d5;
        border-radius: 8px;
        padding: 12px 14px 14px;
        font-family: 'JetBrains Mono', monospace, monospace;
        color: #161615;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        backdrop-filter: blur(6px);
      }
      .title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin: 0 0 10px; display:flex; justify-content:space-between; align-items:center; }
      .title span.tag { color: #d1483a; }
      .row { margin-bottom: 9px; }
      .row-top { display:flex; justify-content:space-between; font-size: 10.5px; color:#6d6d68; margin-bottom:3px; }
      .val { color:#161615; font-variant-numeric: tabular-nums; }
      input[type=range] {
        -webkit-appearance:none; appearance:none; width:100%; height:16px; background:transparent; cursor:pointer;
      }
      input[type=range]::-webkit-slider-runnable-track { height:3px; background:#d9d9d5; border-radius:2px; }
      input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:12px;height:12px;border-radius:50%; background:#161615; cursor:pointer; margin-top:-4.5px; }
      .toggles { display:flex; gap:8px; margin: 8px 0 10px; }
      .chip { flex:1; text-align:center; font-size:10px; padding:6px 4px; border:1px solid #d9d9d5; border-radius:5px; cursor:pointer; color:#6d6d68; user-select:none; }
      .chip.active { background: rgba(22,22,21,0.08); border-color:#161615; color:#161615; }
      .btnrow { display:flex; gap:8px; margin-top:4px; }
      button { flex:1; font-family: inherit; font-size: 11px; padding: 7px 8px; border-radius: 6px; border:1px solid #d9d9d5; background:#f0f0ed; color:#161615; cursor:pointer; }
      button:hover { border-color:#161615; }
      button.stop { color:#d1483a; border-color:#d1483a; }
      .drag { cursor: move; }
      .mini {
        display:none;
        width:44px; height:44px; border-radius:50%;
        background:#fffffff0; border:1px solid #d9d9d5;
        color:#161615; font-family:'JetBrains Mono', monospace, monospace;
        font-size:16px; align-items:center; justify-content:center;
        cursor:move; box-shadow: 0 8px 24px rgba(0,0,0,0.12); backdrop-filter: blur(6px);
        user-select:none;
      }
    </style>
    <div class="panel" id="panel">
      <p class="title drag"><span>text<span class="tag">phobia</span> live</span></p>
      ${sliderRows}
      <div class="toggles">
        <div class="chip active" id="chip-wobble">Wobble</div>
        <div class="chip active" id="chip-random">Randomize</div>
      </div>
      <div class="btnrow">
        <button id="btn-reset">Reset text</button>
        <button id="btn-hide">Hide</button>
        <button id="btn-stop" class="stop">Stop</button>
      </div>
    </div>
    <div class="mini" id="mini" title="Show panel">👁</div>
  `;

  SLIDERS.forEach(s => {
    const input = shadow.getElementById(`s-${s.key}`);
    const val = shadow.getElementById(`val-${s.key}`);
    input.addEventListener('input', () => {
      CONFIG[s.key] = parseFloat(input.value);
      val.textContent = input.value + s.suffix;
    });
  });

  const chipWobble = shadow.getElementById('chip-wobble');
  chipWobble.addEventListener('click', () => {
    CONFIG.wobble = !CONFIG.wobble;
    chipWobble.classList.toggle('active', CONFIG.wobble);
  });
  const chipRandom = shadow.getElementById('chip-random');
  chipRandom.addEventListener('click', () => {
    CONFIG.randomizeCalm = !CONFIG.randomizeCalm;
    chipRandom.classList.toggle('active', CONFIG.randomizeCalm);
  });

  shadow.getElementById('btn-reset').addEventListener('click', () => {
    letters.forEach(L => {
      L.ox = 0; L.oy = 0; L.vx = 0; L.vy = 0; L.fear = 0;
      L.el.style.transform = '';
    });
    activeSet.clear();
  });
  shadow.getElementById('btn-stop').addEventListener('click', () => window.__textPhobiaStop());

  // Hide / show toggle button
  const panelEl = shadow.getElementById('panel');
  const miniEl = shadow.getElementById('mini');

  function showPanel() {
    panelEl.style.display = 'block';
    miniEl.style.display = 'none';
  }
  function hidePanel() {
    panelEl.style.display = 'none';
    miniEl.style.display = 'flex';
  }
  shadow.getElementById('btn-hide').addEventListener('click', hidePanel);
  miniEl.addEventListener('click', () => { if (!minidragged) showPanel(); });

  // Simple drag-to-move for the panel host
  let minidragged = false;
  (function makeDraggable() {
    let dragging = false, offX = 0, offY = 0, moved = false;

    function startDrag(e) {
      dragging = true;
      moved = false;
      minidragged = false;
      const r = hostEl.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      e.preventDefault();
    }
    function onDragMove(e) {
      if (!dragging) return;
      moved = true;
      minidragged = true;
      hostEl.style.left = (e.clientX - offX) + 'px';
      hostEl.style.top = (e.clientY - offY) + 'px';
      hostEl.style.right = 'auto';
    }
    function endDrag() {
      dragging = false;
      // Allow a following click on the mini button only if it wasn't a real drag
      setTimeout(() => { minidragged = moved && minidragged; moved = false; }, 0);
    }

    shadow.querySelector('.drag').addEventListener('mousedown', startDrag);
    miniEl.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
  })();

  // Stop/cleanup script
  window.__textPhobiaStop = function () {
    cancelAnimationFrame(rafId);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('resize', onResize);
    letters.forEach(L => { L.el.style.transform = ''; });
    hostEl.remove();
    delete window.__textPhobiaStop;
    console.log('text-phobia: stopped');
  };

  console.log(`text-phobia: active on ${letters.length} characters. Panel added top-right. Run window.__textPhobiaStop() to stop.`);
  }

  // Toggle logic
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Toggle text-phobia', function () {
      if (window.__textPhobiaStop) {
        window.__textPhobiaStop();
      } else {
        runTextPhobia();
      }
    });
  } else {
    // Fallback if menu commands aren't available
    runTextPhobia();
  }
})();
