import { Layer, ImageLayer, GridLayer, FogLayer, MeasurementState, RenderMode, Viewport } from './types';
import { renderGrid } from './grid';
import { FogSystem } from './fog';

// Cache decoded images to avoid re-decoding per frame
const imageCache = new Map<string, HTMLImageElement>();

function getOrLoadImage(layer: ImageLayer): HTMLImageElement | null {
  const cached = imageCache.get(layer.id);
  if (cached && cached.complete) return cached;

  if (!cached) {
    const img = new Image();
    img.src = layer.src;
    imageCache.set(layer.id, img);
  }
  return null; // not ready yet
}

export function clearImageCache(layerId: string): void {
  imageCache.delete(layerId);
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  canvasWidth: number,
  canvasHeight: number,
  mode: RenderMode,
  fogSystem: FogSystem | null,
  measurement: MeasurementState | null,
  selectedLayerId: string | null,
  viewport: Viewport,
): void {
  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Fill with dark background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Apply shared viewport transform (zoom + pan) to all layers and overlays
  ctx.save();
  ctx.translate(viewport.panX, viewport.panY);
  ctx.scale(viewport.zoom, viewport.zoom);

  // Sort by zIndex and render
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sorted) {
    if (!layer.visible) continue;

    switch (layer.type) {
      case 'image':
        renderImageLayer(ctx, layer as ImageLayer);
        break;
      case 'grid':
        renderGrid(ctx, layer as GridLayer, canvasWidth, canvasHeight, viewport);
        break;
      case 'fog':
        if (fogSystem) {
          fogSystem.draw(ctx, layer as FogLayer, mode, viewport, canvasWidth, canvasHeight);
        }
        break;
    }
  }

  // Draw measurement overlay
  if (measurement && measurement.active) {
    renderMeasurement(ctx, measurement, layers);
  }

  // Draw selection handles (only on primary)
  if (mode === 'primary' && selectedLayerId) {
    const selectedLayer = layers.find(l => l.id === selectedLayerId);
    if (selectedLayer && selectedLayer.type === 'image') {
      renderSelectionHandles(ctx, selectedLayer as ImageLayer);
    }
  }

  ctx.restore();
}

function renderImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer): void {
  const img = getOrLoadImage(layer);
  if (!img) return;

  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(layer.x + w / 2, layer.y + h / 2);
  ctx.rotate(layer.rotation || 0);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function renderMeasurement(ctx: CanvasRenderingContext2D, m: MeasurementState, layers: Layer[]): void {
  // Find grid layer for distance calculation
  const gridLayer = layers.find(l => l.type === 'grid' && l.visible) as GridLayer | undefined;

  ctx.save();
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(m.startX, m.startY);
  ctx.lineTo(m.endX, m.endY);
  ctx.stroke();

  // Draw endpoints
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffcc00';
  for (const [x, y] of [[m.startX, m.startY], [m.endX, m.endY]]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distance label
  const dx = m.endX - m.startX;
  const dy = m.endY - m.startY;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  let label: string;

  if (gridLayer && gridLayer.cellSizePx > 0) {
    const feet = (pixelDist / gridLayer.cellSizePx) * 5;
    label = `${feet.toFixed(1)} ft`;
  } else {
    label = `${pixelDist.toFixed(0)} px`;
  }

  const midX = (m.startX + m.endX) / 2;
  const midY = (m.startY + m.endY) / 2;

  ctx.font = 'bold 16px sans-serif';
  const textMetrics = ctx.measureText(label);
  const padding = 6;

  // Background for label
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(
    midX - textMetrics.width / 2 - padding,
    midY - 12 - padding,
    textMetrics.width + padding * 2,
    20 + padding * 2,
  );

  ctx.fillStyle = '#ffcc00';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, midX, midY);

  ctx.restore();
}

export const ROTATE_HANDLE_OFFSET = 30;

function renderSelectionHandles(ctx: CanvasRenderingContext2D, layer: ImageLayer): void {
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const handleSize = 8;

  ctx.save();
  // Draw in the image's local (unrotated) frame, centered on the image
  ctx.translate(layer.x + w / 2, layer.y + h / 2);
  ctx.rotate(layer.rotation || 0);

  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);

  // Bounding box
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  // Stem to rotation handle
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, -h / 2 - ROTATE_HANDLE_OFFSET);
  ctx.stroke();

  // Scale handles
  ctx.fillStyle = '#00aaff';
  const handles = [
    [-w / 2, -h / 2], [0, -h / 2], [w / 2, -h / 2],
    [-w / 2, 0], [w / 2, 0],
    [-w / 2, h / 2], [0, h / 2], [w / 2, h / 2],
  ];

  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }

  // Rotation handle (circle)
  ctx.beginPath();
  ctx.arc(0, -h / 2 - ROTATE_HANDLE_OFFSET, handleSize / 2 + 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Convert a scene point into the layer's local frame (relative to image center,
// with the image's rotation undone)
export function sceneToLayerLocal(
  layer: ImageLayer,
  px: number,
  py: number,
): { lx: number; ly: number } {
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const dx = px - (layer.x + w / 2);
  const dy = py - (layer.y + h / 2);
  const rot = layer.rotation || 0;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  return { lx: dx * cos - dy * sin, ly: dx * sin + dy * cos };
}

export function getHandleAtPoint(
  layer: ImageLayer,
  px: number,
  py: number,
): string | null {
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const tolerance = 10;

  const { lx, ly } = sceneToLayerLocal(layer, px, py);

  const handles: Array<[number, number, string]> = [
    [-w / 2, -h / 2, 'nw'], [0, -h / 2, 'n'], [w / 2, -h / 2, 'ne'],
    [-w / 2, 0, 'w'], [w / 2, 0, 'e'],
    [-w / 2, h / 2, 'sw'], [0, h / 2, 's'], [w / 2, h / 2, 'se'],
    [0, -h / 2 - ROTATE_HANDLE_OFFSET, 'rotate'],
  ];

  for (const [hx, hy, name] of handles) {
    if (Math.abs(lx - hx) <= tolerance && Math.abs(ly - hy) <= tolerance) {
      return name;
    }
  }

  // Check if inside bounding box (for move)
  if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) {
    return 'move';
  }

  return null;
}
