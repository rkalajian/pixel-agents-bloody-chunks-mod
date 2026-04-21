(function () {
  'use strict';

  // blood-explosion mod for pixel-agents
  // When an agent is closed, it explodes into bloody pixel chunks instead of vanishing.

  const PARTICLE_COUNT = 48;
  const CHUNK_LIFETIME = 150;
  const GRAVITY = 0.35;
  const DRAG = 0.975;
  const BLOOD_COLORS = ['#cc0000', '#880000', '#ff1111', '#aa0000', '#660000', '#ff3333', '#8b0000', '#b30000'];
  const BONE_COLORS = ['#e8e0c8', '#d4cbb0', '#f0ead8'];
  const CHUNK_SIZES = [2, 2, 3, 3, 4, 5];
  const SPLAT_COUNT = 12;
  const FLASH_FRAMES = 8;

  // Spatial tolerance for clustering (px). Must be < gap between character and desk sprite centers.
  // At zoom=4: character center Y = seatRow*64-8, desk center Y = seatRow*64 → 8px gap.
  const CLUSTER_THRESHOLD = 6;

  // Each agent contributes ~2 sprite clusters (character + desk). Used to decide
  // whether a diff check is worth running after close.
  const SPRITES_PER_AGENT = 2;

  let overlayCanvas = null;
  let overlayCtx = null;
  let gameCanvas = null;
  let particles = [];
  let flashes = [];
  let drawHistory = [];
  let despawnSuppressUntil = 0;
  let lastAgentClosedAt = 0;

  // Snapshot of the game canvas captured synchronously on agentClosed.
  // snapshotHold=true: keep at opacity 1 until all particles die (last-agent case, camera pans).
  // snapshotHold=false: linear fade over snapshotFadeMs (multi-agent, camera stays).
  let snapshot = null;
  let snapshotStart = 0;
  let snapshotFadeMs = 700;
  let snapshotHold = false;
  let snapshotFadeOutStart = 0;
  const SNAPSHOT_FADEOUT_MS = 300;

  // Camera transform tracking — updated every frame via setTransform intercept.
  // Used to pan particles with the camera so they stay anchored to world space.
  let currentCameraE  = 0;
  let currentCameraF  = 0;
  let snapshotCameraE = 0;
  let snapshotCameraF = 0;

  // --- overlay setup ---

  function getCanvas() { return document.querySelector('canvas'); }

  function syncOverlay() {
    if (!gameCanvas || !overlayCanvas) return;
    const r  = gameCanvas.getBoundingClientRect();
    const pr = gameCanvas.parentElement.getBoundingClientRect();
    overlayCanvas.width  = gameCanvas.width;
    overlayCanvas.height = gameCanvas.height;
    overlayCanvas.style.width  = r.width  + 'px';
    overlayCanvas.style.height = r.height + 'px';
    overlayCanvas.style.left   = (r.left - pr.left) + 'px';
    overlayCanvas.style.top    = (r.top  - pr.top)  + 'px';
  }

  function initOverlay() {
    gameCanvas = getCanvas();
    if (!gameCanvas) { setTimeout(initOverlay, 300); return; }

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;pointer-events:none;z-index:9999;image-rendering:pixelated;';
    const parent = gameCanvas.parentElement;
    if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext('2d');
    overlayCtx.imageSmoothingEnabled = false;

    syncOverlay();
    new ResizeObserver(syncOverlay).observe(gameCanvas);
    interceptCanvas();
    startLoop();
    console.log('[blood-explosion] Mod loaded — agents die violently now.');
  }

  // --- canvas intercepts ---

  function interceptCanvas() {
    const origDraw         = CanvasRenderingContext2D.prototype.drawImage;
    const origFillRect     = CanvasRenderingContext2D.prototype.fillRect;
    const origSetTransform = CanvasRenderingContext2D.prototype.setTransform;

    CanvasRenderingContext2D.prototype.setTransform = function (a, b, c, d, e, f) {
      if (this.canvas !== overlayCanvas && typeof a === 'number' && a > 1) {
        currentCameraE = e;
        currentCameraF = f;
      }
      return origSetTransform.apply(this, arguments);
    };

    // Suppress the game's despawn (matrix-rain) animation.
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.canvas !== overlayCanvas && w === h && w < 16 && Date.now() < despawnSuppressUntil) return;
      return origFillRect.apply(this, arguments);
    };

    // Track 2:1 sprites to detect agent positions (game canvas only).
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = origDraw.apply(this, args);
      if (this.canvas !== gameCanvas) return result;
      if (args.length === 3) {
        const img = args[0];
        const dw = img.width || img.naturalWidth || 0;
        const dh = img.height || img.naturalHeight || 0;
        const dx = args[1], dy = args[2];
        if (dh === dw * 2 && dw > 4 && (dx !== 0 || dy !== 0)) {
          drawHistory.push({ x: dx + dw * 0.5, y: dy + dh * 0.5 });
          if (drawHistory.length > 300) drawHistory.shift();
        }
      }
      return result;
    };
  }

  function captureSnapshot() {
    if (!gameCanvas) return;
    const cvs = document.createElement('canvas');
    cvs.width  = gameCanvas.width;
    cvs.height = gameCanvas.height;
    cvs.getContext('2d').drawImage(gameCanvas, 0, 0);
    snapshot           = cvs;
    snapshotStart      = Date.now();
    snapshotFadeMs     = 700;
    snapshotHold       = false;
    snapshotFadeOutStart = 0;
    snapshotCameraE    = currentCameraE;
    snapshotCameraF    = currentCameraF;
  }

  function clusterPositions(history) {
    const clusters = [];
    for (const p of history) {
      const c = clusters.find(c => Math.abs(c.x - p.x) < CLUSTER_THRESHOLD && Math.abs(c.y - p.y) < CLUSTER_THRESHOLD);
      if (c) { c.count++; c.x += (p.x - c.x) / c.count; c.y += (p.y - c.y) / c.count; }
      else clusters.push({ x: p.x, y: p.y, count: 1 });
    }
    return clusters;
  }

  function findMissingCluster(before, after) {
    const missing = [];
    for (const b of before) {
      if (!after.some(a => Math.abs(a.x - b.x) < CLUSTER_THRESHOLD && Math.abs(a.y - b.y) < CLUSTER_THRESHOLD))
        missing.push(b);
    }
    if (!missing.length) return null;
    return missing.reduce((a, b) => b.y < a.y ? b : a);
  }

  // --- particle spawn ---

  function spawnExplosion(x, y, withSplats = true) {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const isBone = Math.random() < 0.18;
      const speed  = 1.5 + Math.random() * 7;
      const size   = CHUNK_SIZES[Math.floor(Math.random() * CHUNK_SIZES.length)];
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (1 + Math.random() * 3),
        color: isBone
          ? BONE_COLORS[Math.floor(Math.random() * BONE_COLORS.length)]
          : BLOOD_COLORS[Math.floor(Math.random() * BLOOD_COLORS.length)],
        size,
        life: CHUNK_LIFETIME + Math.floor(Math.random() * 25),
        maxLife: CHUNK_LIFETIME + 25,
      });
    }

    if (withSplats) {
      for (let i = 0; i < SPLAT_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = 2 + Math.random() * 22;
        particles.push({
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist + 10,
          vx: 0, vy: 0,
          color: BLOOD_COLORS[Math.floor(Math.random() * 3)],
          size: 1 + Math.floor(Math.random() * 4),
          life: CHUNK_LIFETIME * 4,
          maxLife: CHUNK_LIFETIME * 4,
          splat: true,
        });
      }
    }
  }

  // --- render loop ---

  function startLoop() {
    function loop() {
      requestAnimationFrame(loop);
      if (!overlayCtx) return;

      const w = overlayCanvas.width, h = overlayCanvas.height;
      overlayCtx.clearRect(0, 0, w, h);
      overlayCtx.imageSmoothingEnabled = false;

      if (snapshot) {
        if (snapshotHold) {
          if (particles.length > 0) {
            // Hold at full opacity while particles are alive. This keeps the frozen
            // pre-close frame as the background so particles always render against the
            // correct view regardless of how the game camera re-pans underneath.
            overlayCtx.globalAlpha = 1;
            overlayCtx.drawImage(snapshot, 0, 0);
            overlayCtx.globalAlpha = 1;
          } else {
            // All particles gone — fade out the snapshot quickly.
            if (!snapshotFadeOutStart) snapshotFadeOutStart = Date.now();
            const t = (Date.now() - snapshotFadeOutStart) / SNAPSHOT_FADEOUT_MS;
            if (t < 1) {
              overlayCtx.globalAlpha = 1 - t;
              overlayCtx.drawImage(snapshot, 0, 0);
              overlayCtx.globalAlpha = 1;
            } else {
              snapshot = null;
            }
          }
        } else {
          const elapsed = Date.now() - snapshotStart;
          if (elapsed < snapshotFadeMs) {
            overlayCtx.globalAlpha = 1 - elapsed / snapshotFadeMs;
            overlayCtx.drawImage(snapshot, 0, 0);
            overlayCtx.globalAlpha = 1;
          } else {
            snapshot = null;
          }
        }
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        if (--f.life <= 0) { flashes.splice(i, 1); continue; }
        overlayCtx.globalAlpha = (f.life / f.maxLife) * 0.35;
        overlayCtx.fillStyle = '#ff0000';
        overlayCtx.fillRect(0, 0, w, h);
      }

      // Camera pan delta since snapshot — keeps particles anchored to world space.
      const panX = currentCameraE - snapshotCameraE;
      const panY = currentCameraF - snapshotCameraF;
      if (!snapshotHold && snapshot && particles.length > 0 && (Math.abs(panX) > 4 || Math.abs(panY) > 4)) {
        snapshotHold = true;
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (--p.life <= 0) { particles.splice(i, 1); continue; }
        if (!p.splat) { p.x += p.vx; p.y += p.vy; p.vy += GRAVITY; p.vx *= DRAG; }
        const t = p.life / p.maxLife;
        overlayCtx.globalAlpha = p.splat ? Math.min(1, t * 3) : t;
        overlayCtx.fillStyle = p.color;
        overlayCtx.fillRect(Math.round(p.x + panX - p.size * 0.5), Math.round(p.y + panY - p.size * 0.5), p.size, p.size);
      }

      overlayCtx.globalAlpha = 1;
    }
    loop();
  }

  // --- message intercept ---

  const _addEvt = window.addEventListener.bind(window);
  window.addEventListener = function (type, listener, options) {
    if (type === 'message') {
      const wrapped = function (event) {
        try {
          const d = event.data;
          if (d && d.type === 'agentClosed') {
            // Guard against the game having multiple message listeners — each would
            // process agentClosed independently, causing duplicate explosions and
            // overwriting snapshotHold via the second captureSnapshot() call.
            const now = Date.now();
            if (now - lastAgentClosedAt < 100) return listener.call(this, event);
            lastAgentClosedAt = now;

            flashes.push({ life: FLASH_FRAMES, maxLife: FLASH_FRAMES });
            despawnSuppressUntil = Date.now() + 350;
            captureSnapshot();

            const clustersBefore = clusterPositions(drawHistory);
            console.log('[blood-explosion] agentClosed — clusters:', clustersBefore.length, clustersBefore.map(c => `(${Math.round(c.x)},${Math.round(c.y)})`).join(' '), '| cameraE:', Math.round(currentCameraE), 'F:', Math.round(currentCameraF));

            if (clustersBefore.length === 0) {
              // No draw history — fire at canvas center, hold snapshot.
              snapshotHold = true;
              const c = getCanvas();
              spawnExplosion(c ? c.width * 0.5 : 200, c ? c.height * 0.5 : 200, false);
              return listener.call(this, event);
            }

            // Defer explosion: diff before/after to find exact agent position.
            // snapshotHold=true keeps snapshot frozen while we wait and while particles live.
            snapshotHold = true;
            drawHistory = [];
            let waited = 0;
            const check = () => {
              waited++;
              const clustersAfter = clusterPositions(drawHistory);

              if (clustersAfter.length === 0) {
                if (waited < 5) { requestAnimationFrame(check); return; }
                // Nothing rendered — fire at nearest-to-center visible pre-close cluster.
                const c = getCanvas();
                const w = c ? c.width : 400, h = c ? c.height : 400;
                const cx = w * 0.5, cy = h * 0.5;
                const vis = clustersBefore.filter(cl => cl.x >= 0 && cl.x <= w && cl.y >= 0 && cl.y <= h);
                const tgt = vis.length
                  ? vis.reduce((a, b) => Math.hypot(b.x - cx, b.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? b : a)
                  : { x: cx, y: cy };
                spawnExplosion(tgt.x, tgt.y, false);
                return;
              }

              const cameraPanned = Math.abs(currentCameraE - snapshotCameraE) > 4 ||
                                   Math.abs(currentCameraF - snapshotCameraF) > 4;
              const cameraShifted = cameraPanned || clustersAfter.some(a =>
                !clustersBefore.some(b =>
                  Math.abs(a.x - b.x) < CLUSTER_THRESHOLD * 2 &&
                  Math.abs(a.y - b.y) < CLUSTER_THRESHOLD * 2
                )
              );
              console.log('[blood-explosion] check waited:', waited, '| clustersAfter:', clustersAfter.length, '| cameraShifted:', cameraShifted);

              if (cameraShifted) {
                // Last agent — estimate pan via voting, then find the missing cluster.
                const Q = CLUSTER_THRESHOLD * 2;
                const votes = new Map();
                for (const a of clustersAfter)
                  for (const b of clustersBefore) {
                    const key = `${Math.round((a.x - b.x) / Q) * Q},${Math.round((a.y - b.y) / Q) * Q}`;
                    votes.set(key, (votes.get(key) || 0) + 1);
                  }
                const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
                const [estPanX, estPanY] = sorted.length ? sorted[0][0].split(',').map(Number) : [0, 0];
                const missing = clustersBefore.find(b =>
                  !clustersAfter.some(a =>
                    Math.abs(a.x - (b.x + estPanX)) < CLUSTER_THRESHOLD * 3 &&
                    Math.abs(a.y - (b.y + estPanY)) < CLUSTER_THRESHOLD * 3
                  )
                );
                console.log('[blood-explosion] last-agent pan:', Math.round(estPanX), Math.round(estPanY), '| missing:', missing ? `(${Math.round(missing.x)},${Math.round(missing.y)})` : 'none');
                if (missing) {
                  spawnExplosion(missing.x, missing.y, false);
                } else {
                  const c = getCanvas();
                  spawnExplosion(c ? c.width * 0.5 : 200, c ? c.height * 0.5 : 200, false);
                }
                return; // snapshotHold stays true
              }

              // Camera stable → agents remain; find which one disappeared.
              const missing = clustersAfter.length < clustersBefore.length
                ? findMissingCluster(clustersBefore, clustersAfter) : null;
              if (!missing && waited < 12) { requestAnimationFrame(check); return; }
              if (missing) {
                console.log('[blood-explosion] burst at', Math.round(missing.x), Math.round(missing.y));
                snapshotHold = false;
                snapshotStart = Date.now();
                spawnExplosion(missing.x, missing.y);
              }
            };
            requestAnimationFrame(check);
          }
        } catch (e) { console.error('[blood-explosion] error:', e); }
        return listener.call(this, event);
      };
      return _addEvt(type, wrapped, options);
    }
    return _addEvt(type, listener, options);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOverlay);
  } else {
    setTimeout(initOverlay, 50);
  }
})();
