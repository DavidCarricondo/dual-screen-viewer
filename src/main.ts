import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { store } from './store';
import { broadcastSceneUpdate, broadcastFogDelta } from './events';
import { renderScene, clearImageCache } from './renderer';
import { FogSystem } from './fog';
import { createLayerPanel } from './LayerPanel';
import { handleTransformMouseDown, handleTransformMouseMove, handleTransformMouseUp, getHandleCursor } from './handles';
import { handleMeasureMouseDown, handleMeasureMouseMove, handleMeasureMouseUp } from './measurement';
import { ImageLayer, GridLayer, FogLayer, Layer } from './types';
import { getHandleAtPoint } from './renderer';
import './styles.css';

let fogSystem: FogSystem | null = null;
let previewCanvas: HTMLCanvasElement;
let previewCtx: CanvasRenderingContext2D;
let renderDirty = true;
let layerPanel: { update: () => void };

// Fog brush state
let fogBrushing = false;
let currentFogStroke: Array<{ x: number; y: number }> = [];
let lastSessionPath: string | null = null;

function getSceneToCanvasScale(): number {
  const session = store.getSession();
  return Math.min(
    previewCanvas.width / session.canvasWidth,
    previewCanvas.height / session.canvasHeight,
  );
}

function canvasToScene(cx: number, cy: number): { x: number; y: number } {
  const scale = getSceneToCanvasScale();
  return { x: cx / scale, y: cy / scale };
}

function scheduleRender(): void {
  renderDirty = true;
}

function renderLoop(): void {
  if (renderDirty) {
    renderDirty = false;
    const session = store.getSession();
    const state = store.getState();

    // Scale canvas to fit preview area while maintaining scene aspect ratio
    const scale = getSceneToCanvasScale();
    previewCtx.save();
    previewCtx.scale(scale, scale);

    renderScene(
      previewCtx,
      session.layers,
      session.canvasWidth,
      session.canvasHeight,
      'primary',
      fogSystem,
      session.measurement,
      state.selectedLayerId,
    );

    previewCtx.restore();

    // Broadcast to secondary
    broadcastSceneUpdate(session);
  }
  requestAnimationFrame(renderLoop);
}

// Hit test for layer selection (reverse zIndex order)
function hitTestLayers(sceneX: number, sceneY: number): Layer | null {
  const layers = store.getLayers().reverse(); // top first
  for (const layer of layers) {
    if (!layer.visible || layer.locked) continue;
    if (layer.type === 'image') {
      const img = layer as ImageLayer;
      const w = img.naturalWidth * img.scaleX;
      const h = img.naturalHeight * img.scaleY;
      if (sceneX >= img.x && sceneX <= img.x + w && sceneY >= img.y && sceneY <= img.y + h) {
        return layer;
      }
    }
  }
  return null;
}

async function addImageLayer(): Promise<void> {
  try {
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });

    if (!filePath) return;

    // open() may return a string or an object with a path property
    const pathStr = typeof filePath === 'string' ? filePath : (filePath as unknown as { path: string }).path;

    const assetUrl = convertFileSrc(pathStr);
    console.log('[addImageLayer] filePath:', pathStr, 'assetUrl:', assetUrl);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = assetUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
    });

    const layer: ImageLayer = {
      id: crypto.randomUUID(),
      name: pathStr.split(/[\\/]/).pop() || 'Image',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 0,
      src: assetUrl,
      filePath: pathStr,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };

    store.addLayer(layer);
    store.selectLayer(layer.id);
  } catch (err) {
    console.error('[addImageLayer] Error:', err);
  }
}

function addGridLayer(): void {
  // Check if grid layer already exists
  if (store.getLayers().some(l => l.type === 'grid')) {
    alert('A grid layer already exists. Remove it first to add a new one.');
    return;
  }

  const layer: GridLayer = {
    id: crypto.randomUUID(),
    name: 'Grid',
    type: 'grid',
    visible: true,
    locked: false,
    opacity: 0.5,
    zIndex: 0,
    cellSizePx: 50,
    color: 'rgba(255, 255, 255, 0.4)',
    lineWidth: 1,
  };

  store.addLayer(layer);
}

function addFogLayer(): void {
  if (store.getLayers().some(l => l.type === 'fog')) {
    alert('A fog layer already exists. Remove it first to add a new one.');
    return;
  }

  const session = store.getSession();
  fogSystem = new FogSystem(session.canvasWidth, session.canvasHeight);

  const layer: FogLayer = {
    id: crypto.randomUUID(),
    name: 'Fog of War',
    type: 'fog',
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 0,
    erasedStrokes: [],
  };

  store.addLayer(layer);
}

async function saveSession(): Promise<void> {
  let path = lastSessionPath;
  if (!path) {
    const selected = await save({
      filters: [{ name: 'Session', extensions: ['json'] }],
      defaultPath: 'session.json',
    });
    if (!selected) return;
    path = selected;
  }

  const session = store.getSession();
  const json = JSON.stringify(session, null, 2);

  await invoke('save_session', { path, data: json });
  lastSessionPath = path;

  // Save fog PNG alongside
  if (fogSystem) {
    const fogPath = path.replace(/\.json$/, '_fog.png');
    const pngBytes = await fogSystem.toPngBytes();
    await invoke('save_fog_png', { path: fogPath, data: Array.from(pngBytes) });
  }
}

async function loadSession(): Promise<void> {
  const filePath = await open({
    multiple: false,
    filters: [{ name: 'Session', extensions: ['json'] }],
  });

  if (!filePath) return;

  const data = await invoke<string>('load_session', { path: filePath });
  const session = JSON.parse(data);

  // Restore image asset URLs
  for (const layer of session.layers) {
    if (layer.type === 'image' && layer.filePath) {
      layer.src = convertFileSrc(layer.filePath);
    }
  }

  store.loadSession(session);
  lastSessionPath = filePath;

  // Restore fog
  const fogLayer = session.layers.find((l: Layer) => l.type === 'fog');
  if (fogLayer) {
    fogSystem = new FogSystem(session.canvasWidth, session.canvasHeight);
    // Try to load fog PNG
    const fogPath = filePath.replace(/\.json$/, '_fog.png');
    try {
      const pngBytes = await invoke<number[]>('load_fog_png', { path: fogPath });
      const uint8 = new Uint8Array(pngBytes);
      const blob = new Blob([uint8], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve) => { img.onload = () => resolve(); });
      const ctx = fogSystem.getCanvas().getContext('2d')!;
      ctx.clearRect(0, 0, session.canvasWidth, session.canvasHeight);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    } catch {
      // If no fog file, replay strokes
      if (fogLayer.erasedStrokes?.length) {
        fogSystem.replayStrokes(fogLayer.erasedStrokes);
      }
    }
  }

  scheduleRender();
}

async function toggleSecondaryWindow(): Promise<void> {
  // If secondary is already open, close it
  const isOpen = await invoke<boolean>('is_secondary_open');
  if (isOpen) {
    await invoke('close_secondary_window');
    return;
  }

  const monitors = await invoke<Array<{ name: string; x: number; y: number; width: number; height: number }>>('get_monitors');

  if (monitors.length < 2) {
    // Fallback: open on same screen offset to the right
    const session = store.getSession();
    await invoke('open_secondary_window', {
      x: 100,
      y: 100,
      width: Math.min(session.canvasWidth, 1280),
      height: Math.min(session.canvasHeight, 720),
    });
    return;
  }

  // Use second monitor
  const secondary = monitors[1];
  await invoke('open_secondary_window', {
    x: secondary.x,
    y: secondary.y,
    width: secondary.width,
    height: secondary.height,
  });
}

function setupCanvasInteraction(): void {
  previewCanvas.addEventListener('mousedown', (e) => {
    const rect = previewCanvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (previewCanvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (previewCanvas.height / rect.height);
    const scene = canvasToScene(cx, cy);
    const tool = store.getState().activeTool;

    if (tool === 'fog-brush') {
      const fogLayer = store.getLayers().find(l => l.type === 'fog');
      if (fogLayer && fogSystem) {
        fogBrushing = true;
        currentFogStroke = [{ x: scene.x, y: scene.y }];
        fogSystem.erasePoints([{ x: scene.x, y: scene.y }], store.getState().fogBrushRadius);
        broadcastFogDelta({ points: [{ x: scene.x, y: scene.y }], radius: store.getState().fogBrushRadius });
        scheduleRender();
      }
      return;
    }

    if (tool === 'measure') {
      handleMeasureMouseDown(scene.x, scene.y);
      scheduleRender();
      return;
    }

    // Select tool
    const scale = getSceneToCanvasScale();
    if (handleTransformMouseDown(cx, cy, scale)) {
      scheduleRender();
      return;
    }

    // Hit test for selection
    const hit = hitTestLayers(scene.x, scene.y);
    store.selectLayer(hit?.id ?? null);
    if (hit) {
      handleTransformMouseDown(cx, cy, scale);
    }
    scheduleRender();
  });

  previewCanvas.addEventListener('mousemove', (e) => {
    const rect = previewCanvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (previewCanvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (previewCanvas.height / rect.height);
    const scene = canvasToScene(cx, cy);
    const tool = store.getState().activeTool;

    if (tool === 'fog-brush' && fogBrushing && fogSystem) {
      currentFogStroke.push({ x: scene.x, y: scene.y });
      fogSystem.erasePoints([currentFogStroke[currentFogStroke.length - 2], { x: scene.x, y: scene.y }], store.getState().fogBrushRadius);
      broadcastFogDelta({ points: [currentFogStroke[currentFogStroke.length - 2], { x: scene.x, y: scene.y }], radius: store.getState().fogBrushRadius });
      scheduleRender();
      return;
    }

    if (tool === 'measure') {
      handleMeasureMouseMove(scene.x, scene.y);
      scheduleRender();
      return;
    }

    // Transform handle drag
    const scale = getSceneToCanvasScale();
    if (handleTransformMouseMove(cx, cy, scale, e.shiftKey)) {
      scheduleRender();
      return;
    }

    // Update cursor based on hover
    const activeTool = store.getState().activeTool;
    const selected = store.getSelectedLayer();
    if (activeTool === 'fog-brush') {
      previewCanvas.style.cursor = 'crosshair';
    } else if (activeTool === 'measure') {
      previewCanvas.style.cursor = 'crosshair';
    } else if (selected && selected.type === 'image' && !selected.locked) {
      const handle = getHandleAtPoint(selected as ImageLayer, scene.x, scene.y);
      previewCanvas.style.cursor = getHandleCursor(handle);
    } else {
      previewCanvas.style.cursor = 'default';
    }
  });

  previewCanvas.addEventListener('mouseup', () => {
    const tool = store.getState().activeTool;

    if (tool === 'fog-brush' && fogBrushing) {
      fogBrushing = false;
      // Save stroke to fog layer
      const fogLayer = store.getLayers().find(l => l.type === 'fog') as FogLayer | undefined;
      if (fogLayer && currentFogStroke.length > 0) {
        fogLayer.erasedStrokes.push({
          points: [...currentFogStroke],
          radius: store.getState().fogBrushRadius,
        });
        store.updateLayer(fogLayer.id, { erasedStrokes: [...fogLayer.erasedStrokes] });
      }
      currentFogStroke = [];
      scheduleRender();
      return;
    }

    if (tool === 'measure') {
      handleMeasureMouseUp();
      return;
    }

    handleTransformMouseUp();
    scheduleRender();
  });

  previewCanvas.addEventListener('mouseleave', () => {
    if (fogBrushing) {
      fogBrushing = false;
      currentFogStroke = [];
    }
  });
}

function setupToolbar(): void {
  const toolbar = document.getElementById('toolbar')!;

  toolbar.querySelector('#btn-add-image')!.addEventListener('click', addImageLayer);
  toolbar.querySelector('#btn-add-grid')!.addEventListener('click', addGridLayer);
  toolbar.querySelector('#btn-add-fog')!.addEventListener('click', addFogLayer);
  toolbar.querySelector('#btn-open-secondary')!.addEventListener('click', toggleSecondaryWindow);
  toolbar.querySelector('#btn-save')!.addEventListener('click', saveSession);
  toolbar.querySelector('#btn-load')!.addEventListener('click', loadSession);

  // Tool buttons
  toolbar.querySelector('#btn-tool-select')!.addEventListener('click', () => {
    store.setTool('select');
    updateToolbarActiveState();
  });
  toolbar.querySelector('#btn-tool-fog')!.addEventListener('click', () => {
    store.setTool('fog-brush');
    updateToolbarActiveState();
  });
  toolbar.querySelector('#btn-tool-measure')!.addEventListener('click', () => {
    store.setTool('measure');
    updateToolbarActiveState();
  });

  // Fog brush size slider
  const brushSlider = toolbar.querySelector('#fog-brush-size') as HTMLInputElement;
  const brushLabel = toolbar.querySelector('#fog-brush-label') as HTMLSpanElement;
  brushSlider.addEventListener('input', () => {
    store.setFogBrushRadius(parseInt(brushSlider.value));
    brushLabel.textContent = brushSlider.value;
  });

  // Grid config
  const gridSizeInput = toolbar.querySelector('#grid-cell-size') as HTMLInputElement;
  gridSizeInput.addEventListener('change', () => {
    const gridLayer = store.getLayers().find(l => l.type === 'grid');
    if (gridLayer) {
      store.updateLayer(gridLayer.id, { cellSizePx: parseInt(gridSizeInput.value) || 50 });
    }
  });
}

function updateToolbarActiveState(): void {
  const tool = store.getState().activeTool;
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`btn-tool-${tool === 'fog-brush' ? 'fog' : tool}`)?.classList.add('active');

  // Show/hide fog controls
  const fogControls = document.getElementById('fog-controls')!;
  fogControls.style.display = tool === 'fog-brush' ? 'flex' : 'none';
}

function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // Don't capture when typing in inputs
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    switch (e.key) {
      case 'Escape':
        store.clearMeasurement();
        store.setTool('select');
        updateToolbarActiveState();
        scheduleRender();
        break;
      case 'm':
      case 'M':
        store.setTool('measure');
        updateToolbarActiveState();
        break;
      case 'g':
      case 'G':
        const gridLayer = store.getLayers().find(l => l.type === 'grid');
        if (gridLayer) {
          store.updateLayer(gridLayer.id, { visible: !gridLayer.visible });
          scheduleRender();
        }
        break;
      case 'f':
      case 'F':
        store.setTool('fog-brush');
        updateToolbarActiveState();
        break;
      case 'v':
      case 'V':
        store.setTool('select');
        updateToolbarActiveState();
        break;
      case 'z':
      case 'Z':
        if (e.ctrlKey) {
          // Undo last fog stroke
          e.preventDefault();
          const fogLayer = store.getLayers().find(l => l.type === 'fog') as FogLayer | undefined;
          if (fogLayer && fogSystem && fogLayer.erasedStrokes.length > 0) {
            fogLayer.erasedStrokes.pop();
            store.updateLayer(fogLayer.id, { erasedStrokes: [...fogLayer.erasedStrokes] });
            fogSystem.replayStrokes(fogLayer.erasedStrokes);
            scheduleRender();
          }
        }
        break;
      case 's':
      case 'S':
        if (e.ctrlKey) {
          e.preventDefault();
          saveSession();
        }
        break;
      case 'Delete':
      case 'Backspace':
        const selected = store.getSelectedLayer();
        if (selected) {
          if (selected.type === 'image') clearImageCache(selected.id);
          store.removeLayer(selected.id);
          scheduleRender();
        }
        break;
    }
  });
}

function resizePreviewCanvas(): void {
  const container = document.getElementById('preview-container')!;
  const ratio = store.getSession().canvasWidth / store.getSession().canvasHeight;
  const maxW = container.clientWidth;
  const maxH = container.clientHeight;

  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }

  previewCanvas.width = w;
  previewCanvas.height = h;
  scheduleRender();
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
  previewCtx = previewCanvas.getContext('2d')!;

  // Setup layer panel
  const layerPanelContainer = document.getElementById('layer-panel-container')!;
  layerPanel = createLayerPanel(layerPanelContainer);

  // Subscribe store to re-render
  store.subscribe(() => {
    scheduleRender();
    layerPanel.update();
  });

  setupToolbar();
  setupCanvasInteraction();
  setupKeyboardShortcuts();

  // Resize canvas on window resize
  window.addEventListener('resize', resizePreviewCanvas);
  resizePreviewCanvas();

  // Initial render
  layerPanel.update();
  renderLoop();
});
