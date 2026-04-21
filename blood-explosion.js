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
  // Threshold of 6 keeps them separate while still grouping same-sprite entries.
  const CLUSTER_THRESHOLD = 6;

  let overlayCanvas = null;
  let overlayCtx = null;
  let gameCanvas = null;
  let particles = [];
  let flashes = [];
  let rafId = null;
  let drawHistory = [];
  // Suppress the game's built-in despawn (matrix-rain) animation after agent close.
  // xr() draws it using fillRect(x, y, zoom, zoom) — tiny squares, no other render path uses them.
  let despawnSuppressUntil = 0;

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

    interceptDrawImage();
    startLoop();
    console.log('[blood-explosion] Mod loaded — agents die violently now.');
  }

  // --- canvas intercepts ---

  function interceptDrawImage() {
    const origDraw = CanvasRenderingContext2D.prototype.drawImage;
    const origFillRect = CanvasRenderingContext2D.prototype.fillRect;

    // Suppress the game's despawn (matrix-rain) animation.
    // xr() renders it as fillRect(x, y, a, a) where a=zoom (≤8px). No other path uses sub-16px squares.
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.canvas !== overlayCanvas && w === h && w < 16 && Date.now() < despawnSuppressUntil) {
        return;
      }
      return origFillRect.apply(this, arguments);
    };

    // Track all non-mirrored 2:1 sprite drawImages.
    // Characters in Cr() are always drawn non-mirrored: drawImage(sprite, x, y) with non-zero y.
    // Mirrored furniture uses translate+scale+drawImage(img,0,0) — excluded by dx===0&&dy===0 guard.
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = origDraw.apply(this, args);
      if (this.canvas === overlayCanvas) return result;

      if (args.length === 3) {
        const img = args[0];
        const dw = img.width || img.naturalWidth || 0;
        const dh = img.height || img.naturalHeight || 0;
        const dx = args[1], dy = args[2];

        // 2:1 sprites only (characters and tall furniture). dx===0&&dy===0 excluded (mirrored furniture).
        if (dh === dw * 2 && dw > 4 && (dx !== 0 || dy !== 0)) {
          drawHistory.push({ x: dx + dw * 0.5, y: dy + dh * 0.5 });
          if (drawHistory.length > 300) drawHistory.shift();
        }
      }
      return result;
    };
  }

  // Cluster drawHistory entries by spatial proximity.
  // CLUSTER_THRESHOLD must be < 8px (the gap between character and desk sprite centers at zoom=4).
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

  // Find which cluster in `before` has no spatial match in `after`.
  // When multiple clusters vanish (last agent closed), picks lowest Y — the character sprite,
  // which sits above its desk (character center Y = seatRow*64-8, desk center Y = seatRow*64).
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

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life--;
        if (f.life <= 0) { flashes.splice(i, 1); continue; }
        overlayCtx.globalAlpha = (f.life / f.maxLife) * 0.35;
        overlayCtx.fillStyle = '#ff0000';
        overlayCtx.fillRect(0, 0, w, h);
      }

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
        overlayCtx.fillRect(Math.round(p.x - p.size * 0.5), Math.round(p.y - p.size * 0.5), p.size, p.size);
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
            // Flash immediately + suppress the game's matrix-rain despawn for 350ms.
            flashes.push({ life: FLASH_FRAMES, maxLife: FLASH_FRAMES });
            despawnSuppressUntil = Date.now() + 350;

            const clustersBefore = clusterPositions(drawHistory);

            if (clustersBefore.length === 0) {
              // No sprite data — fall back to canvas center.
              const c = getCanvas();
              spawnExplosion(c ? c.width * 0.5 : 200, c ? c.height * 0.5 : 200);
            } else {
              // Fire synchronously at the character cluster (lowest Y = above desk).
              // This runs in the message handler before any RAF re-render, so coordinates
              // are valid even when the game re-pans after the last agent is removed.
              const charCluster = clustersBefore.reduce((a, b) => b.y < a.y ? b : a);
              spawnExplosion(charCluster.x, charCluster.y);

              // For multi-agent: also diff to fire at the actual closed agent if it's
              // a different position than the one we just fired at.
              drawHistory = [];
              let waited = 0;
              const check = () => {
                waited++;
                const clustersAfter = clusterPositions(drawHistory);
                if (clustersAfter.length === 0) {
                  if (waited < 3) { requestAnimationFrame(check); return; }
                  return; // last agent — already handled by synchronous fire above
                }
                const missing = clustersAfter.length < clustersBefore.length
                  ? findMissingCluster(clustersBefore, clustersAfter)
                  : null;
                if (!missing && waited < 12) { requestAnimationFrame(check); return; }
                if (missing) {
                  // Only fire a second explosion if diff found a meaningfully different position
                  // (i.e. a non-topmost agent closed in a multi-agent scenario).
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
