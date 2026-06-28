import { listen, emit } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SessionState, ImageLayer, GridLayer, FogLayer, ErasedStroke } from './types';
import { renderGrid } from './grid';
import { FogSystem } from './fog';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let currentSession: SessionState | null = null;

// Secondary window maintains its own fog raster, mirrored from the primary
let fog: FogSystem | null = null;
let fogWidth = 0;
let fogHeight = 0;
let appliedStrokeCount = 0;

// Image cache
const imageCache = new Map<string, HTMLImageElement>();

function getOrLoadImage(layer: ImageLayer): HTMLImageElement | null {
  const cached = imageCache.get(layer.id);
  if (cached && cached.complete) return cached;
  if (!cached) {
    const img = new Image();
    img.src = layer.src;
    img.onload = () => renderCurrentScene();
    imageCache.set(layer.id, img);
  }
  return null;
}

function initFog(width: number, height: number): void {
  if (fogWidth === width && fogHeight === height && fog) return;
  fogWidth = width;
  fogHeight = height;
  fog = new FogSystem(width, height);
  appliedStrokeCount = 0;
}

function applyFogStrokes(strokes: ErasedStroke[]): void {
  if (!fog) return;

  // If strokes were removed (undo), rebuild from scratch
  if (strokes.length < appliedStrokeCount) {
    fog.replayStrokes(strokes);
    appliedStrokeCount = strokes.length;
    return;
  }

  // Otherwise apply only the strokes added since last time
  for (const stroke of strokes.slice(appliedStrokeCount)) {
    fog.erasePoints(stroke.points, stroke.radius);
  }
  appliedStrokeCount = strokes.length;
}

function renderCurrentScene(): void {
  if (!currentSession || !ctx) return;

  const { canvasWidth, canvasHeight, layers, measurement } = currentSession;

  // Set canvas to scene size
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Apply shared viewport transform (zoom + pan) mirrored from the primary window
  const viewport = currentSession.viewport ?? { zoom: 1, panX: 0, panY: 0 };
  ctx.save();
  ctx.translate(viewport.panX, viewport.panY);
  ctx.scale(viewport.zoom, viewport.zoom);

  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sorted) {
    if (!layer.visible) continue;

    switch (layer.type) {
      case 'image': {
        const imgLayer = layer as ImageLayer;
        const img = getOrLoadImage(imgLayer);
        if (img) {
          const w = imgLayer.naturalWidth * imgLayer.scaleX;
          const h = imgLayer.naturalHeight * imgLayer.scaleY;
          ctx.save();
          ctx.globalAlpha = imgLayer.opacity;
          ctx.translate(imgLayer.x + w / 2, imgLayer.y + h / 2);
          ctx.rotate(imgLayer.rotation || 0);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.restore();
        }
        break;
      }
      case 'grid':
        renderGrid(ctx, layer as GridLayer, canvasWidth, canvasHeight, viewport);
        break;
      case 'fog': {
        const fogLayer = layer as FogLayer;
        initFog(canvasWidth, canvasHeight);
        applyFogStrokes(fogLayer.erasedStrokes || []);
        fog?.draw(ctx, fogLayer, 'secondary', viewport, canvasWidth, canvasHeight);
        break;
      }
    }
  }

  // Measurement overlay
  if (measurement && measurement.active) {
    const gridLayer = layers.find(l => l.type === 'grid' && l.visible) as GridLayer | undefined;

    ctx.save();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(measurement.startX, measurement.startY);
    ctx.lineTo(measurement.endX, measurement.endY);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = '#ffcc00';
    for (const [x, y] of [[measurement.startX, measurement.startY], [measurement.endX, measurement.endY]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const dx = measurement.endX - measurement.startX;
    const dy = measurement.endY - measurement.startY;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    let label: string;
    if (gridLayer && gridLayer.cellSizePx > 0) {
      label = `${((pixelDist / gridLayer.cellSizePx) * 5).toFixed(1)} ft`;
    } else {
      label = `${pixelDist.toFixed(0)} px`;
    }

    const midX = (measurement.startX + measurement.endX) / 2;
    const midY = (measurement.startY + measurement.endY) / 2;

    ctx.font = 'bold 20px sans-serif';
    const tm = ctx.measureText(label);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(midX - tm.width / 2 - 8, midY - 16, tm.width + 16, 32);
    ctx.fillStyle = '#ffcc00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);

    ctx.restore();
  }

  ctx.restore();
}

// Listen for scene updates from primary window
window.addEventListener('DOMContentLoaded', async () => {
  canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;

  // The window has no decorations, so allow closing it with Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      getCurrentWindow().close();
    }
  });

  // No decorations: drag anywhere to move the window,
  // double-click to toggle fullscreen
  canvas.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return;
    const win = getCurrentWindow();
    if (e.detail === 2) {
      await win.setFullscreen(!(await win.isFullscreen()));
    } else {
      await win.startDragging();
    }
  });

  // Initial black canvas render so it's never white
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    await listen<string>('scene:update', (event) => {
      try {
        const session = JSON.parse(event.payload) as SessionState;

        // Restore asset URLs for image layers
        for (const layer of session.layers) {
          if (layer.type === 'image') {
            const imgLayer = layer as ImageLayer;
            if (imgLayer.filePath && (!imgLayer.src || !imgLayer.src.startsWith('http'))) {
              imgLayer.src = convertFileSrc(imgLayer.filePath);
            }
          }
        }

        currentSession = session;
        renderCurrentScene();
      } catch (e) {
        console.error('Failed to parse scene update:', e);
      }
    });

    // Listen for live fog deltas during brush stroke
    await listen<string>('fog:delta', (event) => {
      try {
        const delta = JSON.parse(event.payload) as { points: Array<{ x: number; y: number }>; radius: number };
        fog?.erasePoints(delta.points, delta.radius);
        renderCurrentScene();
      } catch {
        // ignore
      }
    });

    // Signal to primary that listeners are ready
    await emit('secondary:ready');
  } catch (e) {
    console.error('Failed to set up secondary window listeners:', e);
  }
});