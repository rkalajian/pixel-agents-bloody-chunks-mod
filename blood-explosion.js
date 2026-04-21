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
  const SNAPSHOT_FADE_MS = 700;

  // Spatial tolerance for clustering (px). Must be < gap between character and desk sprite centers.
  // At zoom=4: character center Y = seatRow*64-8, desk center Y = seatRow*64 → 8px gap.
  // Threshold of 6 keeps them separate while still grouping same-sprite entries.
  const CLUSTER_THRESHOLD = 6;

  let overlayCanvas = null;
  let overlayCtx = null;
  let gameCanvas = null;
  let particles = [];
  let flashes = [];
  let rafId = null;
  let drawHistory = [];
  let despawnSuppressUntil = 0;

  // Snapshot of the game canvas at close time — drawn on the overlay with a fade
  // so the pre-close view is visible behind particles during the camera pan.
  let snapshot = null;
  let snapshotStart = 0;

  // Camera offset tracked from the game's setTransform calls (a > 1 = zoom transform).
  // spawnCameraE/F are captured when the explosion fires; the delta is applied to
  // particle render positions each frame so chunks track their world position as the camera pans.
  let currentCameraE = 0;
  let currentCameraF = 0;
  let spawnCameraE = 0;
  let spawnCameraF = 0;

  // --- overlay setup ---

  function getCanvas() {
    return document.querySelector('canvas');
  }

  function syncOverlay() {
    if (!gameCanvas || !overlayCanvas) return;
    const r = gameCanvas.getBoundingClientRect();
    const pr = gameCanvas.parentElement.getBoundingClientRect();
    overlayCanvas.width = gameCanvas.width;
    overlayCanvas.height = gameCanvas.height;
    overlayCanvas.style.width = r.width + 'px';
    overlayCanvas.style.height = r.height + 'px';
    overlayCanvas.style.left = (r.left - pr.left) + 'px';
    overlayCanvas.style.top = (r.top - pr.top) + 'px';
  }

  function initOverlay() {
    gameCanvas = getCanvas();
    if (!gameCanvas) {
      setTimeout(initOverlay, 300);
      return;
    }

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;pointer-events:none;z-index:9999;image-rendering:pixelated;';
    const parent = gameCanvas.parentElement;
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.position === 'static') parent.style.position = 'relative';
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
    const origDraw = CanvasRenderingContext2D.prototype.drawImage;
    const origFillRect = CanvasRenderingContext2D.prototype.fillRect;
    const origSetTransform = CanvasRenderingContext2D.prototype.setTransform;

    // Track the game's camera transform. The game calls setTransform(zoom, 0, 0, zoom, e, f)
    // each frame; e and f are the canvas-pixel offset of the camera. We record them so we can
    // compute how far the camera has panned since the explosion was spawned and shift particles
    // by the same delta, keeping them anchored to their world position.
    CanvasRenderingContext2D.prototype.setTransform = function (a, b, c, d, e, f) {
      if (this.canvas !== overlayCanvas && a > 1) {
        currentCameraE = e;
        currentCameraF = f;
      }
      return origSetTransform.apply(this, arguments);
    };

    // Suppress the game's despawn (matrix-rain) animation.
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.canvas !== overlayCanvas && w === h && w < 16 && Date.now() < despawnSuppressUntil) {
        return;
      }
      return origFillRect.apply(this, arguments);
    };

    // Track all non-mirrored 2:1 sprite drawImages to detect which agent closed.
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = origDraw.apply(this, args);
      if (this.canvas === overlayCanvas) return result;
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
    cvs.width = gameCanvas.width;
    cvs.height = gameCanvas.height;
    cvs.getContext('2d').drawImage(gameCanvas, 0, 0);
    snapshot = cvs;
    snapshotStart = Date.now();
  }

  // Cluster drawHistory entries by spatial proximity.
  function clusterPositions(history) {
    const clusters = [];
    for (const p of history) {
      const c = clusters.find(c => Math.abs(c.x - p.x) < CLUSTER_THRESHOLD && Math.abs(c.y - p.y) < CLUSTER_THRESHOLD);
      if (c) {
        c.count++;
        c.x += (p.x - c.x) / c.count;
        c.y += (p.y - c.y) / c.count;
      } else {
        clusters.push({ x: p.x, y: p.y, count: 1 });
      }
    }
    return clusters;
  }

  // Find the cluster in `before` with no spatial match in `after`.
  // When multiple vanish (last agent), picks lowest Y = character sprite (above its desk).
  function findMissingCluster(before, after) {
    const missing = [];
    for (const b of before) {
      const matched = after.some(a => Math.abs(a.x - b.x) < CLUSTER_THRESHOLD && Math.abs(a.y - b.y) < CLUSTER_THRESHOLD);
      if (!matched) missing.push(b);
    }
    if (missing.length === 0) return null;
    return missing.reduce((a, b) => b.y < a.y ? b : a);
  }

  // --- particle spawn ---

  function spawnExplosion(x, y) {
    // Record the camera offset at spawn time. The render loop applies the delta
    // (currentCamera - spawnCamera) to particle positions every frame so they
    // stay anchored to the world position even as the camera pans.
    spawnCameraE = currentCameraE;
    spawnCameraF = currentCameraF;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const isBone = Math.random() < 0.18;
      const speed = 1.5 + Math.random() * 7;
      const size = CHUNK_SIZES[Math.floor(Math.random() * CHUNK_SIZES.length)];
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

    for (let i = 0; i < SPLAT_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * 22;
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

  // --- render loop ---

  function startLoop() {
    function loop() {
      rafId = requestAnimationFrame(loop);
      if (!overlayCtx) return;

      const w = overlayCanvas.width;
      const h = overlayCanvas.height;
      overlayCtx.clearRect(0, 0, w, h);
      overlayCtx.imageSmoothingEnabled = false;

      // Frozen game-canvas snapshot, fading out. Keeps the pre-close view visible
      // behind particles for SNAPSHOT_FADE_MS ms while the game camera re-pans.
      if (snapshot) {
        const elapsed = Date.now() - snapshotStart;
        if (elapsed < SNAPSHOT_FADE_MS) {
          overlayCtx.globalAlpha = 1 - elapsed / SNAPSHOT_FADE_MS;
          overlayCtx.drawImage(snapshot, 0, 0);
          overlayCtx.globalAlpha = 1;
        } else {
          snapshot = null;
        }
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life--;
        if (f.life <= 0) { flashes.splice(i, 1); continue; }
        overlayCtx.globalAlpha = (f.life / f.maxLife) * 0.35;
        overlayCtx.fillStyle = '#ff0000';
        overlayCtx.fillRect(0, 0, w, h);
      }

      // Camera pan delta since the explosion was spawned.
      // Applied to every particle so chunks stay anchored to their world position.
      const panX = currentCameraE - spawnCameraE;
      const panY = currentCameraF - spawnCameraF;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life--;
        if (p.life <= 0) { particles.splice(i, 1); continue; }

        if (!p.splat) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += GRAVITY;
          p.vx *= DRAG;
        }

        const t = p.life / p.maxLife;
        overlayCtx.globalAlpha = p.splat ? Math.min(1, t * 3) : t;
        overlayCtx.fillStyle = p.color;
        overlayCtx.fillRect(
          Math.round(p.x + panX - p.size * 0.5),
          Math.round(p.y + panY - p.size * 0.5),
          p.size, p.size
        );
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
            flashes.push({ life: FLASH_FRAMES, maxLife: FLASH_FRAMES });
            despawnSuppressUntil = Date.now() + 350;
            captureSnapshot();

            const clustersBefore = clusterPositions(drawHistory);

            if (clustersBefore.length === 0) {
              const c = getCanvas();
              spawnExplosion(c ? c.width * 0.5 : 200, c ? c.height * 0.5 : 200);
            } else {
              const charCluster = clustersBefore.reduce((a, b) => b.y < a.y ? b : a);
              spawnExplosion(charCluster.x, charCluster.y);

              drawHistory = [];
              let waited = 0;
              const check = () => {
                waited++;
                const clustersAfter = clusterPositions(drawHistory);
                if (clustersAfter.length === 0) {
                  if (waited < 3) { requestAnimationFrame(check); return; }
                  return;
                }
                const missing = clustersAfter.length < clustersBefore.length
                  ? findMissingCluster(clustersBefore, clustersAfter)
                  : null;
                if (!missing && waited < 12) { requestAnimationFrame(check); return; }
                if (missing) {
                  const dist = Math.hypot(missing.x - charCluster.x, missing.y - charCluster.y);
                  if (dist > CLUSTER_THRESHOLD * 4) spawnExplosion(missing.x, missing.y);
                }
              };
              requestAnimationFrame(check);
            }
          }
        } catch (e) { console.error('[blood-explosion] error:', e); }
        return listener.call(this, event);
      };
      return _addEvt(type, wrapped, options);
    }
    return _addEvt(type, listener, options);
  };

  // init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOverlay);
  } else {
    setTimeout(initOverlay, 50);
  }
})();
