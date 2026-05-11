import { GridLayer } from './types';

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  layer: GridLayer,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!layer.visible) return;

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = layer.lineWidth;

  const cellSize = layer.cellSizePx;
  if (cellSize <= 0) {
    ctx.restore();
    return;
  }

  ctx.beginPath();

  // Vertical lines
  for (let x = 0; x <= canvasWidth; x += cellSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
  }

  // Horizontal lines
  for (let y = 0; y <= canvasHeight; y += cellSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
  }

  ctx.stroke();
  ctx.restore();
}
