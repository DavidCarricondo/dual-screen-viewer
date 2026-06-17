import { ErasedStroke, FogLayer, RenderMode, Viewport } from './types';

// Fills the visible region outside the scene rectangle [0,sceneW] x [0,sceneH]
// with solid fog, so fog extends across the whole viewport when zoomed/panned.
// Uses 4 non-overlapping bands to avoid alpha-overlap seams. The caller is
// responsible for setting globalAlpha; the fill colour matches the fog canvas.
export function fillOuterFog(
  ctx: CanvasRenderingContext2D,
  sceneW: number,
  sceneH: number,
  viewport: Viewport,
): void {
  const vx0 = (0 - viewport.panX) / viewport.zoom;
  const vy0 = (0 - viewport.panY) / viewport.zoom;
  const vx1 = (sceneW - viewport.panX) / viewport.zoom;
  const vy1 = (sceneH - viewport.panY) / viewport.zoom;

  ctx.fillStyle = 'rgba(0,0,0,1)';

  // Top band (full width)
  if (vy0 < 0) ctx.fillRect(vx0, vy0, vx1 - vx0, -vy0);
  // Bottom band (full width)
  if (vy1 > sceneH) ctx.fillRect(vx0, sceneH, vx1 - vx0, vy1 - sceneH);

  // Middle row, clamped vertically to the scene rect to avoid overlap
  const midTop = Math.max(vy0, 0);
  const midBottom = Math.min(vy1, sceneH);
  if (midBottom > midTop) {
    // Left band
    if (vx0 < 0) ctx.fillRect(vx0, midTop, -vx0, midBottom - midTop);
    // Right band
    if (vx1 > sceneW) ctx.fillRect(sceneW, midTop, vx1 - sceneW, midBottom - midTop);
  }
}

export class FogSystem {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
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

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d')!;
    this.reset();
  }

  erasePoints(points: Array<{ x: number; y: number }>, radius: number): void {
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = 'rgba(0,0,0,1)';

    for (const point of points) {
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw connecting lines between points for smooth stroke
    if (points.length > 1) {
      this.ctx.lineWidth = radius * 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        this.ctx.lineTo(points[i].x, points[i].y);
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
  ): void {
    if (!layer.visible) return;

    targetCtx.save();
    // GM sees through fog at 40% opacity; players see full fog
    targetCtx.globalAlpha = mode === 'primary' ? 0.4 : layer.opacity;
    fillOuterFog(targetCtx, this.width, this.height, viewport);
    targetCtx.drawImage(this.canvas, 0, 0);
    targetCtx.restore();
  }

  async toPngBase64(): Promise<string> {
    const blob = await this.canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip data:image/png;base64, prefix
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async toPngBytes(): Promise<Uint8Array> {
    const blob = await this.canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async loadFromPngBase64(base64: string): Promise<void> {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
    });
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(img, 0, 0);
  }

  getCanvas(): OffscreenCanvas {
    return this.canvas;
  }
}
