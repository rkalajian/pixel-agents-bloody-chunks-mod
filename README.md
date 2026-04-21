# pixel-agents — Bloody Chunks Mod

Replaces the default agent-close animation in the [pixel-agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) VS Code extension with a blood-and-bone particle explosion.

When an agent is dispatched, it explodes into bloody pixel chunks instead of quietly glitching out. Chunks fly with gravity and drag; blood splatters pool on the ground. The built-in matrix-rain despawn animation is suppressed so only the explosion shows.

## Requirements

- VS Code with [pixel-agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) installed (tested on v1.3.0)

## Installation

**Note:** This mod edits files inside the installed extension. You will need to re-apply it after every pixel-agents update.

### Scripted (recommended)

```bash
./install.sh
```

The script:
1. Backs up the extension's `index.html` to `index.html.bak`
2. Copies `blood-explosion.js` into the extension's assets directory
3. Injects the `<script>` tag before the main bundle

Then reload VS Code: **Cmd+Shift+P** → `Developer: Reload Window`

The mod is active when you see this in the webview developer console:

```
[blood-explosion] Mod loaded — agents die violently now.
```

### Manual

#### 1. Find your pixel-agents extension directory

```bash
ls ~/.vscode/extensions/ | grep pixel-agents
```

The directory will be something like `pablodelucca.pixel-agents-1.3.0`. The full path is:

```
~/.vscode/extensions/pablodelucca.pixel-agents-1.3.0/dist/webview/
```

#### 2. Copy the script

```bash
cp blood-explosion.js ~/.vscode/extensions/pablodelucca.pixel-agents-1.3.0/dist/webview/assets/
```

Replace `1.3.0` with your installed version.

#### 3. Inject the script tag

Edit `~/.vscode/extensions/pablodelucca.pixel-agents-1.3.0/dist/webview/index.html` and add one line inside `<head>`, **before** the main `index-*.js` script:

```html
<head>
  ...
  <script src="./assets/blood-explosion.js"></script>   <!-- add this line -->
  <script type="module" crossorigin src="./assets/index-BUrEakFE.js"></script>
  ...
</head>
```

#### 4. Reload the extension

In VS Code: **Ctrl+Shift+P** (or **Cmd+Shift+P**) → `Developer: Reload Window`

## Uninstalling

### Scripted

```bash
./uninstall.sh
```

Restores the original `index.html` from the backup and removes the mod script. Reload VS Code to deactivate.

### Manual

Remove the `<script>` line you added from `index.html`. You can leave the JS file in place or delete it.

## Customisation

Edit `blood-explosion.js` before installing. Constants at the top of the file:

| Constant | Default | Effect |
|---|---|---|
| `PARTICLE_COUNT` | `48` | Flying chunks per explosion |
| `CHUNK_LIFETIME` | `150` | Chunk lifespan (frames at ~60fps ≈ 2.5s) |
| `SPLAT_COUNT` | `12` | Blood splat marks left on the ground |
| `GRAVITY` | `0.35` | Downward acceleration on chunks |
| `DRAG` | `0.975` | Horizontal drag on chunks |
| `FLASH_FRAMES` | `8` | White flash duration at explosion origin |
| `CLUSTER_THRESHOLD` | `6` | Max px spread to group draw calls into one agent position |
| `SNAPSHOT_FADEOUT_MS` | `300` | Fade duration (ms) after snapshot releases |

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
