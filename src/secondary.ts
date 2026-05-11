import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { SessionState, ImageLayer, GridLayer, FogLayer, ErasedStroke } from './types';
import { renderGrid } from './grid';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let currentSession: SessionState | null = null;

// Secondary window maintains its own fog OffscreenCanvas
let fogCanvas: OffscreenCanvas | null = null;
let fogCtx: OffscreenCanvasRenderingContext2D | null = null;
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
  if (fogWidth === width && fogHeight === height && fogCanvas) return;
  fogWidth = width;
  fogHeight = height;
  fogCanvas = new OffscreenCanvas(width, height);
  fogCtx = fogCanvas.getContext('2d')!;
  fogCtx.fillStyle = 'rgba(0,0,0,1)';
  fogCtx.fillRect(0, 0, width, height);
  appliedStrokeCount = 0;
}

function applyFogStrokes(strokes: ErasedStroke[]): void {
  if (!fogCtx || !fogCanvas) return;

  // Only apply new strokes since last applied
  const newStrokes = strokes.slice(appliedStrokeCount);
  if (newStrokes.length === 0 && appliedStrokeCount === strokes.length) return;

  // If strokes were removed (undo), rebuild from scratch
  if (strokes.length < appliedStrokeCount) {
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.fillStyle = 'rgba(0,0,0,1)';
    fogCtx.fillRect(0, 0, fogWidth, fogHeight);
    appliedStrokeCount = 0;
    for (const stroke of strokes) {
      eraseStroke(stroke);
    }
    appliedStrokeCount = strokes.length;
    return;
  }

  for (const stroke of newStrokes) {
    eraseStroke(stroke);
  }
  appliedStrokeCount = strokes.length;
}

function eraseStroke(stroke: ErasedStroke): void {
  if (!fogCtx) return;
  fogCtx.globalCompositeOperation = 'destination-out';
  fogCtx.fillStyle = 'rgba(0,0,0,1)';

  for (const point of stroke.points) {
    fogCtx.beginPath();
    fogCtx.arc(point.x, point.y, stroke.radius, 0, Math.PI * 2);
    fogCtx.fill();
  }

  if (stroke.points.length > 1) {
    fogCtx.lineWidth = stroke.radius * 2;
    fogCtx.lineCap = 'round';
    fogCtx.lineJoin = 'round';
    fogCtx.beginPath();
    fogCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      fogCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    fogCtx.stroke();
  }

  fogCtx.globalCompositeOperation = 'source-over';
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

  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sorted) {
    if (!layer.visible) continue;

    switch (layer.type) {
      case 'image': {
        const imgLayer = layer as ImageLayer;
        const img = getOrLoadImage(imgLayer);
        if (img) {
          ctx.save();
          ctx.globalAlpha = imgLayer.opacity;
          ctx.drawImage(
            img,
            imgLayer.x, imgLayer.y,
            imgLayer.naturalWidth * imgLayer.scaleX,
            imgLayer.naturalHeight * imgLayer.scaleY,
          );
          ctx.restore();
        }
        break;
      }
      case 'grid':
        renderGrid(ctx, layer as GridLayer, canvasWidth, canvasHeight);
        break;
      case 'fog': {
        const fogLayer = layer as FogLayer;
        initFog(canvasWidth, canvasHeight);
        applyFogStrokes(fogLayer.erasedStrokes || []);
        if (fogCanvas) {
          ctx.save();
          ctx.globalAlpha = fogLayer.opacity; // Full opacity for players
          ctx.drawImage(fogCanvas, 0, 0);
          ctx.restore();
        }
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
}

// Listen for scene updates from primary window
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;

  // Initial black canvas render so it's never white
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  listen<string>('scene:update', (event) => {
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
  listen<string>('fog:delta', (event) => {
    try {
      const delta = JSON.parse(event.payload) as { points: Array<{ x: number; y: number }>; radius: number };
      if (fogCtx && fogCanvas) {
        fogCtx.globalCompositeOperation = 'destination-out';
        fogCtx.fillStyle = 'rgba(0,0,0,1)';

        for (const point of delta.points) {
          fogCtx.beginPath();
          fogCtx.arc(point.x, point.y, delta.radius, 0, Math.PI * 2);
          fogCtx.fill();
        }

        if (delta.points.length > 1) {
          fogCtx.lineWidth = delta.radius * 2;
          fogCtx.lineCap = 'round';
          fogCtx.lineJoin = 'round';
          fogCtx.beginPath();
          fogCtx.moveTo(delta.points[0].x, delta.points[0].y);
          for (let i = 1; i < delta.points.length; i++) {
            fogCtx.lineTo(delta.points[i].x, delta.points[i].y);
          }
          fogCtx.stroke();
        }

        fogCtx.globalCompositeOperation = 'source-over';
        renderCurrentScene();
      }
    } catch {
      // ignore
    }
  });
});