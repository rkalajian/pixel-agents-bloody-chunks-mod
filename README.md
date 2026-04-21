# pixel-agents — Bloody Chunks Mod

Replaces the default agent-close animation in the [pixel-agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) VS Code extension with a blood-and-bone particle explosion.

When an agent is dispatched, it explodes into bloody pixel chunks instead of quietly glitching out. Chunks fly with gravity and drag; blood splatters pool on the ground. The built-in matrix-rain despawn animation is suppressed so only the explosion shows.

## Requirements

- VS Code with [pixel-agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) installed (tested on v1.3.0)

## Installation

**Note:** This mod edits files inside the installed extension. You will need to re-apply it after every pixel-agents update.

### 1. Find your pixel-agents extension directory

Open a terminal and run:

```bash
ls ~/.vscode/extensions/ | grep pixel-agents
```

The directory will be something like `pablodelucca.pixel-agents-1.3.0`. The full path is:

```
~/.vscode/extensions/pablodelucca.pixel-agents-1.3.0/dist/webview/
```

### 2. Copy the script

```bash
cp blood-explosion.js ~/.vscode/extensions/pablodelucca.pixel-agents-1.3.0/dist/webview/assets/
```

Replace `1.3.0` with your installed version.

### 3. Inject the script tag

Edit `~/.vscode/extensions/pablodelucca.pixel-agents-1.3.0/dist/webview/index.html` and add one line inside `<head>`, **before** the main `index-*.js` script:

```html
<head>
  ...
  <script src="./assets/blood-explosion.js"></script>   <!-- add this line -->
  <script type="module" crossorigin src="./assets/index-BUrEakFE.js"></script>
  ...
</head>
```

### 4. Reload the extension

In VS Code: **Ctrl+Shift+P** (or **Cmd+Shift+P**) → `Developer: Reload Window`

The mod is active when you see this in the webview developer console:

```
[blood-explosion] Mod loaded — agents die violently now.
```

## Uninstalling

Remove the `<script>` line you added from `index.html`. You can leave the JS file in place or delete it.

## Customisation

Edit `blood-explosion.js` before copying. Constants at the top of the file:

| Constant | Default | Effect |
|---|---|---|
| `DEBUG` | `false` | Set `true` to log spawn coordinates and draw debug crosshairs |
| `PARTICLE_COUNT` | `48` | Number of flying chunks per explosion |
| `CHUNK_LIFETIME` | `150` | How long chunks stay on screen (frames at ~60fps ≈ 2.5s) |
| `SPLAT_COUNT` | `12` | Number of blood splat marks left on the ground |
| `GRAVITY` | `0.35` | Downward acceleration on chunks |
| `DRAG` | `0.975` | Horizontal drag on chunks |

## How it works

The mod injects into the webview before the React bundle loads. It:

1. **Intercepts `CanvasRenderingContext2D.prototype.drawImage`** to track which 2:1-ratio sprites (character height = 2× width) are being drawn each frame and where.
2. **On `agentClosed` message**, snapshots those sprite positions, resets tracking, then diffs against the next few frames to identify which position disappeared — that's the closed agent.
3. **Spawns a particle explosion** at that position on a transparent overlay canvas layered above the game canvas.
4. **Suppresses the built-in despawn animation** by intercepting `fillRect` calls that match the matrix-rain effect's pixel size for 350ms after close.

The position-detection handles multiple simultaneous agents correctly by using spatial clustering with a tight 6px threshold (tight enough to separate a sitting character from the desk sprite directly behind them, which differs by only 8px in Y at the default zoom level).
