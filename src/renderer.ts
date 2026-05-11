import { Layer, ImageLayer, GridLayer, FogLayer, MeasurementState, RenderMode } from './types';
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
): void {
  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Fill with dark background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Sort by zIndex and render
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sorted) {
    if (!layer.visible) continue;

    switch (layer.type) {
      case 'image':
        renderImageLayer(ctx, layer as ImageLayer);
        break;
      case 'grid':
        renderGrid(ctx, layer as GridLayer, canvasWidth, canvasHeight);
        break;
      case 'fog':
        if (fogSystem) {
          fogSystem.draw(ctx, layer as FogLayer, mode);
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
}

function renderImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer): void {
  const img = getOrLoadImage(layer);
  if (!img) return;

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.drawImage(
    img,
    layer.x,
    layer.y,
    layer.naturalWidth * layer.scaleX,
    layer.naturalHeight * layer.scaleY,
  );
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

function renderSelectionHandles(ctx: CanvasRenderingContext2D, layer: ImageLayer): void {
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const x = layer.x;
  const y = layer.y;
  const handleSize = 8;

  ctx.save();
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);

  // Bounding box
  ctx.strokeRect(x, y, w, h);

  // Handles
  ctx.setLineDash([]);
  ctx.fillStyle = '#00aaff';
  const handles = [
    [x, y], [x + w / 2, y], [x + w, y],
    [x, y + h / 2], [x + w, y + h / 2],
    [x, y + h], [x + w / 2, y + h], [x + w, y + h],
  ];

  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }

  ctx.restore();
}

export function getHandleAtPoint(
  layer: ImageLayer,
  px: number,
  py: number,
): string | null {
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const x = layer.x;
  const y = layer.y;
  const tolerance = 10;

  const handles: Array<[number, number, string]> = [
    [x, y, 'nw'], [x + w / 2, y, 'n'], [x + w, y, 'ne'],
    [x, y + h / 2, 'w'], [x + w, y + h / 2, 'e'],
    [x, y + h, 'sw'], [x + w / 2, y + h, 's'], [x + w, y + h, 'se'],
  ];

  for (const [hx, hy, name] of handles) {
    if (Math.abs(px - hx) <= tolerance && Math.abs(py - hy) <= tolerance) {
      return name;
    }
  }

  // Check if inside bounding box (for move)
  if (px >= x && px <= x + w && py >= y && py <= y + h) {
    return 'move';
  }

  return null;
}
