import { GridLayer, Viewport } from './types';

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  layer: GridLayer,
  canvasWidth: number,
  canvasHeight: number,
  viewport: Viewport,
): void {
  if (!layer.visible) return;

  const cellSize = layer.cellSizePx;
  if (cellSize <= 0) return;

  // Hide the grid once cells become too small on screen to be distinguishable.
  if (cellSize * viewport.zoom < 3) return;

  // Visible region in the grid's local (pre-viewport) coordinate space.
  // The drawing surface spans 0..canvasWidth x 0..canvasHeight before the
  // shared translate(pan) + scale(zoom) transform is applied.
  const vx0 = (0 - viewport.panX) / viewport.zoom;
  const vy0 = (0 - viewport.panY) / viewport.zoom;
  const vx1 = (canvasWidth - viewport.panX) / viewport.zoom;
  const vy1 = (canvasHeight - viewport.panY) / viewport.zoom;

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = layer.lineWidth;

  ctx.beginPath();

  // Vertical lines
  const startX = Math.floor(vx0 / cellSize) * cellSize;
  for (let x = startX; x <= vx1; x += cellSize) {
    ctx.moveTo(x, vy0);
    ctx.lineTo(x, vy1);
  }

  // Horizontal lines
  const startY = Math.floor(vy0 / cellSize) * cellSize;
  for (let y = startY; y <= vy1; y += cellSize) {
    ctx.moveTo(vx0, y);
    ctx.lineTo(vx1, y);
  }

  ctx.stroke();
  ctx.restore();
}

