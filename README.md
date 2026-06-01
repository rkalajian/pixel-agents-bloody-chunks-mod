# pixel-agents — Bloody Chunks Mod

Replaces the default agent-close animation in the [pixel-agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) VS Code extension with a blood-and-bone particle explosion.

When an agent is dispatched, it explodes into bloody pixel chunks instead of quietly glitching out. Chunks fly with gravity and drag; blood splatters pool on the ground. The built-in matrix-rain despawn animation is suppressed so only the explosion shows.

## Requirements

- VS Code with [pixel-agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) installed (tested on v1.3.0)

## Installation

Clone or copy this repository to pixel-agents' mods directory:

```bash
git clone https://github.com/rkalajian/pixel-agents-bloody-chunks-mod \
  ~/.pixel-agents/mods/pixel-agents-bloody-chunks-mod
```

pixel-agents' built-in mod loader scans `~/.pixel-agents/mods/` on startup, reads `manifest.json`, and injects the listed scripts into the webview automatically. No further steps required.

Then reload VS Code: **Cmd+Shift+P** → `Developer: Reload Window`

The mod is active when you see this in the webview developer console:

```
[blood-explosion] Mod loaded — agents die violently now.
```

### Manual injection (fallback)

If your pixel-agents version doesn't support the built-in mod loader, use the included script to patch the extension directly:

```bash
./install.sh
```

The script:
1. Locates your pixel-agents extension (any installed version)
2. Backs up the extension's `index.html` to `index.html.bak`
3. Copies `blood-explosion.js` into the extension's assets directory
4. Injects the `<script>` tag before the main bundle

**Note:** Manual injection must be re-applied after every pixel-agents update.

## Uninstalling

If installed via the built-in mod loader, remove the directory:

```bash
rm -rf ~/.pixel-agents/mods/pixel-agents-bloody-chunks-mod
```

If installed via manual injection:

```bash
./uninstall.sh
```

Restores the original `index.html` from the backup and removes the mod script.

## Customisation

Edit `blood-explosion.js` before installing. Constants at the top of the file:

| Constant | Default | Effect |
|---|---|---|
| `PARTICLE_COUNT` | `48` | Flying chunks per explosion |
| `CHUNK_LIFETIME` | `150` | Chunk lifespan (frames at ~60fps ≈ 2.5s) |
| `SPLAT_COUNT` | `18` | Blood splat marks left on the ground |
| `GRAVITY` | `0.35` | Downward acceleration on chunks |
| `DRAG` | `0.975` | Horizontal drag on chunks |
| `FLASH_FRAMES` | `8` | White flash duration at explosion origin |
| `CLUSTER_THRESHOLD` | `6` | Max px spread to group draw calls into one agent position |
| `SNAPSHOT_FADEOUT_MS` | `300` | Fade duration (ms) after snapshot releases |

## Mod compatibility

### bathroom-break

When the [bathroom-break mod](../bathroom-break) is also installed and an agent is deleted while sitting on a toilet, the explosion uses **brown chunk and blood stain colors** instead of red — representing the, uh, mixed biological material. The flash tint also shifts to brown. No configuration needed; detection is automatic via `window.__bathroomBreakMod.isAgentOnToilet()`.

## How it works

The mod injects into the webview before the React bundle loads. It:

1. **Intercepts three canvas methods** — `drawImage`, `fillRect`, and `setTransform`:
   - `drawImage`: tracks 2:1-ratio sprites (character height = 2× width) each frame to locate agents.
   - `fillRect`: suppresses the built-in matrix-rain despawn animation for 350ms after a close.
   - `setTransform`: records camera position (`e`/`f` translation components) every frame so particle world-anchoring can compensate for camera pans.

2. **On `agentClosed` message**, captures a canvas snapshot synchronously, then defers the explosion check up to 12 animation frames. Each deferred frame clusters current sprite positions and diffs against the pre-close snapshot to identify which cluster disappeared — that's the closed agent.

3. **Camera-pan compensation** — if the camera moves >4px while particles are alive, particle positions are offset each frame by the delta from their spawn camera position, keeping them anchored to the world rather than drifting with the view.

4. **Snapshot hold** — a frozen copy of the game canvas renders behind the particles. For mid-session closes (camera stable) it fades linearly over 700ms. For last-agent closes or any close where the camera pans, the snapshot holds at full opacity until every particle dies, then fades over 300ms. This prevents the game from snapping to an empty room mid-explosion.

5. **Last-agent detection** — when all sprites vanish after a close (no clusters in the diff's "after" frame), the mod targets the lowest-Y cluster from the pre-close snapshot (the character sprite, which sits above its desk). A voting-based pan estimator compares pre- and post-close cluster positions to correct for any camera jump before pinning the explosion origin.

Position detection uses spatial clustering with a 6px threshold — tight enough to separate a sitting character from the desk sprite behind it (which differs by only ~8px in Y at default zoom).
