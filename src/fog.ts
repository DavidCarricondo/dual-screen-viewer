import { ErasedStroke, FogLayer, RenderMode, Viewport } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// When the erasable raster has to grow, expand it by this much extra on each
// side so we don't reallocate on every nearby brush stroke.
const GROW_MARGIN = 512;

// Fills the visible region outside the fog raster rectangle with solid fog, so
// fog extends across the whole viewport when zoomed/panned. Uses 4
// non-overlapping bands to avoid alpha-overlap seams. The caller is responsible
// for setting globalAlpha; the fill colour matches the fog canvas.
//
// `rect` is the raster's placement in scene coordinates (it may not start at the
// origin once the raster has grown). `surfaceW`/`surfaceH` describe the drawing
// surface so we know how far the visible region extends.
export function fillOuterFog(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  surfaceW: number,
  surfaceH: number,
  viewport: Viewport,
): void {
  const rLeft = rect.x;
  const rTop = rect.y;
  const rRight = rect.x + rect.w;
  const rBottom = rect.y + rect.h;

  const vx0 = (0 - viewport.panX) / viewport.zoom;
  const vy0 = (0 - viewport.panY) / viewport.zoom;
  const vx1 = (surfaceW - viewport.panX) / viewport.zoom;
  const vy1 = (surfaceH - viewport.panY) / viewport.zoom;

  ctx.fillStyle = 'rgba(0,0,0,1)';

  // Top band (full width)
  if (vy0 < rTop) ctx.fillRect(vx0, vy0, vx1 - vx0, rTop - vy0);
  // Bottom band (full width)
  if (vy1 > rBottom) ctx.fillRect(vx0, rBottom, vx1 - vx0, vy1 - rBottom);

  // Middle row, clamped vertically to the raster rect to avoid overlap
  const midTop = Math.max(vy0, rTop);
  const midBottom = Math.min(vy1, rBottom);
  if (midBottom > midTop) {
    // Left band
    if (vx0 < rLeft) ctx.fillRect(vx0, midTop, rLeft - vx0, midBottom - midTop);
    // Right band
    if (vx1 > rRight) ctx.fillRect(rRight, midTop, vx1 - rRight, midBottom - midTop);
  }
}

export class FogSystem {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  // Scene-space position of raster pixel (0,0). Moves negative as the raster
  // grows to cover area left/above the original scene rectangle.
  private originX = 0;
  private originY = 0;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d')!;
    this.reset();
  }

  reset(): void {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = 'rgba(0,0,0,1)';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // Grow the raster (preserving existing fog/holes) so it covers the given
  // scene-space bounding box. Newly added area is filled with solid fog.
  private ensureCovers(minX: number, minY: number, maxX: number, maxY: number): void {
    const curMinX = this.originX;
    const curMinY = this.originY;
    const curMaxX = this.originX + this.width;
    const curMaxY = this.originY + this.height;

    if (minX >= curMinX && minY >= curMinY && maxX <= curMaxX && maxY <= curMaxY) {
      return;
    }

    // Only extend the sides that actually fall short, each by a margin so we
    // amortise reallocations; leave the other sides exactly where they are.
    const newMinX = minX < curMinX ? Math.floor(minX - GROW_MARGIN) : curMinX;
    const newMinY = minY < curMinY ? Math.floor(minY - GROW_MARGIN) : curMinY;
    const newMaxX = maxX > curMaxX ? Math.ceil(maxX + GROW_MARGIN) : curMaxX;
    const newMaxY = maxY > curMaxY ? Math.ceil(maxY + GROW_MARGIN) : curMaxY;
    const newW = newMaxX - newMinX;
    const newH = newMaxY - newMinY;

    const newCanvas = new OffscreenCanvas(newW, newH);
    const newCtx = newCanvas.getContext('2d')!;

    // Old raster's position within the new (larger) raster, in pixels.
    const ox = curMinX - newMinX;
    const oy = curMinY - newMinY;

    // Fill only the freshly added border with solid fog, then copy the old
    // raster (with its erased holes intact) into place.
    newCtx.fillStyle = 'rgba(0,0,0,1)';
    if (oy > 0) newCtx.fillRect(0, 0, newW, oy);
    if (oy + this.height < newH) newCtx.fillRect(0, oy + this.height, newW, newH - (oy + this.height));
    if (ox > 0) newCtx.fillRect(0, oy, ox, this.height);
    if (ox + this.width < newW) newCtx.fillRect(ox + this.width, oy, newW - (ox + this.width), this.height);
    newCtx.drawImage(this.canvas, ox, oy);

    this.canvas = newCanvas;
    this.ctx = newCtx;
    this.originX = newMinX;
    this.originY = newMinY;
    this.width = newW;
    this.height = newH;
  }

  erasePoints(points: Array<{ x: number; y: number }>, radius: number): void {
    if (points.length === 0) return;

    // Grow the raster if the stroke reaches outside the current bounds.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.ensureCovers(minX - radius, minY - radius, maxX + radius, maxY + radius);

    const ox = this.originX;
    const oy = this.originY;

    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = 'rgba(0,0,0,1)';

    for (const point of points) {
      this.ctx.beginPath();
      this.ctx.arc(point.x - ox, point.y - oy, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw connecting lines between points for smooth stroke
    if (points.length > 1) {
      this.ctx.lineWidth = radius * 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(points[0].x - ox, points[0].y - oy);
      for (let i = 1; i < points.length; i++) {
        this.ctx.lineTo(points[i].x - ox, points[i].y - oy);
      }
      this.ctx.stroke();
    }

    this.ctx.globalCompositeOperation = 'source-over';
  }

  replayStrokes(strokes: ErasedStroke[]): void {
    this.reset();
    for (const stroke of strokes) {
      this.erasePoints(stroke.points, stroke.radius);
    }
  }

  draw(
    targetCtx: CanvasRenderingContext2D,
    layer: FogLayer,
    mode: RenderMode,
    viewport: Viewport,
    surfaceW: number,
    surfaceH: number,
  ): void {
    if (!layer.visible) return;

    targetCtx.save();
    // GM sees through fog at 40% opacity; players see full fog
    targetCtx.globalAlpha = mode === 'primary' ? 0.4 : layer.opacity;
    fillOuterFog(
      targetCtx,
      { x: this.originX, y: this.originY, w: this.width, h: this.height },
      surfaceW,
      surfaceH,
      viewport,
    );
    targetCtx.drawImage(this.canvas, this.originX, this.originY);
    targetCtx.restore();
  }

  getCanvas(): OffscreenCanvas {
    return this.canvas;
  }
}
