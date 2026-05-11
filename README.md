
**Project structure** — 12 source files across Rust and TypeScript:

| File | Purpose |
|---|---|
| lib.rs | Rust backend: monitor detection, secondary window creation, session save/load, fog PNG I/O, event broadcasting |
| tauri.conf.json | Dual-window config, CSP with asset URLs, dialog + fs plugins |
| types.ts | All TypeScript types: `ImageLayer`, `GridLayer`, `FogLayer`, `SessionState`, `MeasurementState` |
| store.ts | Centralized `StateStore` singleton with subscriber pattern |
| events.ts | Tauri event wrappers for `scene:update` and `fog:delta` broadcasts |
| renderer.ts | Canvas renderer: draws layers, grid, fog, measurement overlay, selection handles |
| fog.ts | `FogSystem` — OffscreenCanvas with `destination-out` erasing, PNG export |
| grid.ts | Grid line renderer |
| handles.ts | Transform handles: drag to move, corner drag to scale with Shift for aspect lock |
| measurement.ts | Measurement tool: persistent line, distance in feet (1 square = 5 ft) |
| LayerPanel.ts | Layer panel UI: drag reorder, visibility/lock/opacity/delete controls |
| main.ts | Primary window entry: toolbar, canvas interaction, keyboard shortcuts, save/load |
| secondary.ts | Secondary window: listens for scene updates, renders independently with live fog deltas |

**To build on Windows**, install [Tauri prerequisites](https://tauri.app/start/prerequisites/) then:
```bash
npm install
npm run tauri dev     # development
npm run tauri build   # production .exe
```

**Keyboard shortcuts:** `V`=Select, `F`=Fog brush, `M`=Measure, `G`=Toggle grid, `Escape`=Cancel/clear measurement, `Ctrl+Z`=Undo fog stroke, `Ctrl+S`=Save, `Delete`=Remove selected layer.

## Testing

To test the Dual Screen Viewer project, you'll need Windows with the Tauri prerequisites installed. Here's a comprehensive testing guide:

## Prerequisites (Windows 10/11)

1. **Install system dependencies:**
   - Node.js 18+ (or via nvm)
   - Rust toolchain (`rustup`)
   - WebView2 runtime (pre-installed on Win11, most Win10 machines)

2. **Install Tauri CLI:**
   ```bash
   npm install
   ```

## Running in Development

```bash
npm run tauri dev
```

This launches:
- **Primary window** (GM Control Panel) on your main monitor
- **Vite dev server** at `http://localhost:1420` with hot reload

## Testing Checklist

### Phase 1: Basic Functionality
- [ ] Primary window opens with toolbar and empty layer panel
- [ ] "Player Display" button opens secondary window on second monitor (or offset if one monitor)
- [ ] Canvas preview shows dark background with grid overlay

### Phase 2: Layer Management
- [ ] **Add Image**: Click "Image" button → file dialog opens → select PNG/JPG → appears in layers panel and canvas
- [ ] **Visibility toggle**: Click eye icon on layer → image hides/shows on both windows
- [ ] **Opacity slider**: Drag slider → image fades in real-time on both screens
- [ ] **Lock toggle**: Click lock icon → prevents dragging/scaling
- [ ] **Delete**: Click ✕ button → layer removed
- [ ] **Drag to reorder**: Drag layer rows → changes render order on both screens

### Phase 3: Grid Layer
- [ ] **Add Grid**: Click "Grid" button → grid overlay appears
- [ ] **Configure cell size**: Change input → grid squares update in real-time
- [ ] Grid renders at correct opacity and color on both screens

### Phase 4: Image Transforms
- [ ] **Select image**: Click on image in canvas → bounding box + 8 handles appear
- [ ] **Move**: Drag center of bounding box → image moves, secondary shows live update
- [ ] **Scale**: Drag corner handle → image scales, opposite corner anchors
- [ ] **Scale with Shift**: Hold Shift while dragging corner → maintains aspect ratio
- [ ] Transforms don't work if layer is locked

### Phase 5: Fog of War
- [ ] **Add Fog**: Click "Fog" button → solid black fog covers entire canvas
- [ ] **GM preview**: Fog is 40% transparent on primary (GM sees map), 100% opaque on secondary
- [ ] **Activate brush**: Press F or click "Fog Brush" tool → cursor changes
- [ ] **Brush size**: Slider controls radius (5–200px)
- [ ] **Paint erase**: Draw on preview canvas → fog erases in real-time on secondary
- [ ] **Smooth strokes**: Connected brush circles create smooth lines
- [ ] **Undo**: Press `Ctrl+Z` → last stroke replay is removed, fog resets
- [ ] **Persistent**: Erased areas remain until undone or session closed

### Phase 6: Measurement Tool
- [ ] **Activate**: Press M or click "Measure" tool
- [ ] **Draw line**: Mousedown → drag → mousemove updates line on both screens
- [ ] **Distance calculation**: Line labeled in feet (using grid cell size × 5 ft per square)
- [ ] **Persistent**: Line stays on screen after release until tool deactivated or Escape pressed
- [ ] **Clear**: Press Escape → measurement disappears

### Phase 7: Persistence
- [ ] **Save**: Press `Ctrl+S` → file dialog → saves `session.json` + `fog.png`
- [ ] **Load**: Click "Load" → file dialog → loads session, restores all layers + fog state
- [ ] **Session data**: JSON contains canvas size, layer list, layer transforms, fog strokes
- [ ] **Fog restoration**: Load session → fog erased areas match saved state

### Phase 8: Keyboard Shortcuts
- [ ] `V` → Select tool (default)
- [ ] `F` → Fog brush tool
- [ ] `M` → Measurement tool
- [ ] `G` → Toggle grid visibility
- [ ] `Escape` → Cancel active tool, clear measurement
- [ ] `Ctrl+Z` → Undo last fog stroke
- [ ] `Ctrl+S` → Save session
- [ ] `Delete` → Remove selected image layer

### Phase 9: Dual Monitor Setup
- [ ] **Two monitors**: Primary window appears on main monitor, Player Display on secondary
- [ ] **One monitor**: Player Display opens as separate window (offset from primary)
- [ ] **Fullscreen mode**: Manually move Player Display window to fullscreen on secondary
- [ ] **Resolution independence**: Preview canvas scales correctly regardless of monitor resolutions

### Phase 10: Edge Cases
- [ ] **Rapid clicks**: Add/remove layers quickly → no crashes
- [ ] **Large images**: Load 4K image → performance acceptable, no memory spike
- [ ] **Many strokes**: Paint fog 100+ strokes → undo works, playback smooth
- [ ] **Close windows**: Closing Player Display → primary stays open (can reopen)
- [ ] **Minimal data**: Save empty session → loads cleanly

## Performance Targets
- **Startup time**: <2 seconds
- **Memory baseline**: <150 MB (primary + secondary)
- **Canvas render**: 60 FPS when static, 30+ FPS when painting fog
- **Fog undo**: <100ms per stroke

## Troubleshooting

| Issue | Solution |
|---|---|
| WebView2 not found error | Download from https://developer.microsoft.com/microsoft-edge/webview2/ |
| Secondary window doesn't open | Check system has at least one monitor; fallback should open offset |
| Images don't load | Verify file path is readable; check browser console for asset URL errors |
| Fog not erasing smoothly | Check canvas resolution < 2560×1440; reduce brush radius if needed |
| Session won't load | Ensure JSON is valid; fog PNG file exists next to session.json |

## Testing with Test Images

Create a simple test scene:
1. Add an image layer (use a map image, e.g., D&D battle map)
2. Add a grid with 50px cells
3. Add fog layer
4. Paint fog over part of map
5. Draw measurement line across a few squares
6. Save session
7. Reload and verify everything restored

---

**Pro tip**: Open browser dev tools in primary window (`Ctrl+Shift+I`) to see console logs and catch any errors. Check the "secondary" window renderer performance via the secondary's dev tools if needed.