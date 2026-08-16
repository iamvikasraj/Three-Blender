# 3D Model Viewer — Boilerplate

A minimal [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) starter for viewing 3D models.
Drop in a **glTF / GLB** file (the standard Blender export), point one config line at it, and it just works —
the model is auto-centered, scaled to a sensible size, seated on the floor, framed by the camera, and any
animations auto-play.

## Quick start

```bash
# Install dependencies (first time only)
npm install

# Run the local dev server (http://localhost:5173)
npm run dev

# Build for production into ../dist
npm run build
```

## Load your own model

1. **Export from Blender:** `File → Export → glTF 2.0`. Choose `.glb` (single file) or `.gltf` (separate files).
   Enable *Apply Modifiers*; include animations if you want them.
2. **Drop it in:** put the file(s) under `static/models/<YourModel>/`.
3. **Point at it:** open `src/script.js` and edit the `CONFIG` block at the top:

   ```js
   const CONFIG = {
       model: {
           path: '/models/YourModel/scene.glb', // ← your file
           autoScale: true,
           targetSize: 2,   // desired height in world units
       },
       // ...
   }
   ```

4. Reload — that's it.

> Paths are relative to `static/`. `static/models/YourModel/scene.glb` is referenced as `/models/YourModel/scene.glb`.

## Config reference (`src/script.js`)

| Key | What it does |
| --- | --- |
| `model.path` | Path to the glTF/GLB file to load. |
| `model.autoScale` | Fit the model's largest dimension to `targetSize`. |
| `model.targetSize` | Target size (world units) when `autoScale` is on. |
| `model.scale` | Manual scale multiplier when `autoScale` is off. |
| `model.autoCenter` | Center the model and rest it on the floor. |
| `animation.autoPlay` | Auto-play a clip if the model has animations. |
| `animation.clip` | Which clip to play by default — index (`0`) or name (`"Run"`). |
| `scene.background` / `showFloor` / `showGrid` / `autoRotate` | Scene appearance defaults. |
| `camera.fov` / `camera.autoFrame` | Camera field of view and auto-framing. |

## On-screen controls

- **Drag** to orbit, **scroll** to zoom, **right-drag** to pan.
- The **GUI panel** (top-right) toggles floor/grid/auto-rotate, changes background, adjusts lighting,
  and switches between animation clips.

## Draco-compressed models

Draco support is wired up already (decoder in `static/draco/`). Export from Blender with
*Compression* enabled, or compress with `gltf-transform`, and it loads with no code changes.

## Adding FBX / OBJ (optional)

This boilerplate is glTF/GLB-first because that's the native Blender export. If you need other formats:

```js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
```

Then branch on the file extension inside `loadModel()`. Note: OBJ carries no animation, and FBX materials
can be inconsistent — glTF remains the recommended path.

## Tech

- **three** — WebGL rendering
- **vite** — dev server / bundler
- **lil-gui** — debug controls

## Credits

Bootstrapped from a [Three.js Journey](https://threejs-journey.com/) exercise. Sample models (Fox, Duck,
FlightHelmet) are from the [glTF sample assets](https://github.com/KhronosGroup/glTF-Sample-Assets).
