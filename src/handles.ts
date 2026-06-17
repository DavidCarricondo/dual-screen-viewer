import { ImageLayer } from './types';
import { store } from './store';
import { getHandleAtPoint } from './renderer';

type DragState = {
  active: boolean;
  handle: string;
  layerId: string;
  startMouseX: number;
  startMouseY: number;
  startLayerX: number;
  startLayerY: number;
  startScaleX: number;
  startScaleY: number;
  startRotation: number;
  startCenterX: number;
  startCenterY: number;
  startPointerAngle: number;
} | null;

let dragState: DragState = null;

export function getHandleCursor(handle: string | null): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'rotate': return 'grab';
    case 'move': return 'move';
    default: return 'default';
  }
}

export function handleTransformMouseDown(
  sceneX: number,
  sceneY: number,
): boolean {
  const selected = store.getSelectedLayer();
  if (!selected || selected.type !== 'image' || selected.locked) return false;

  const handle = getHandleAtPoint(selected as ImageLayer, sceneX, sceneY);
  if (!handle) return false;

  const layer = selected as ImageLayer;
  const centerX = layer.x + (layer.naturalWidth * layer.scaleX) / 2;
  const centerY = layer.y + (layer.naturalHeight * layer.scaleY) / 2;

  dragState = {
    active: true,
    handle,
    layerId: layer.id,
    startMouseX: sceneX,
    startMouseY: sceneY,
    startLayerX: layer.x,
    startLayerY: layer.y,
    startScaleX: layer.scaleX,
    startScaleY: layer.scaleY,
    startRotation: layer.rotation || 0,
    startCenterX: centerX,
    startCenterY: centerY,
    startPointerAngle: Math.atan2(sceneY - centerY, sceneX - centerX),
  };

  return true;
}

// Local offset (relative to image center) of the point that must stay fixed
// while dragging the given scale handle
function anchorOffset(handle: string, w: number, h: number): { x: number; y: number } {
  return {
    x: handle.includes('e') ? -w / 2 : handle.includes('w') ? w / 2 : 0,
    y: handle.includes('s') ? -h / 2 : handle.includes('n') ? h / 2 : 0,
  };
}

export function handleTransformMouseMove(
  sceneX: number,
  sceneY: number,
  shiftKey: boolean,
): boolean {
  if (!dragState || !dragState.active) return false;

  const dx = sceneX - dragState.startMouseX;
  const dy = sceneY - dragState.startMouseY;

  const layer = store.getLayer(dragState.layerId) as ImageLayer;
  if (!layer) return false;

  if (dragState.handle === 'move') {
    store.updateLayer(dragState.layerId, {
      x: dragState.startLayerX + dx,
      y: dragState.startLayerY + dy,
    });
  } else if (dragState.handle === 'rotate') {
    const angle = Math.atan2(sceneY - dragState.startCenterY, sceneX - dragState.startCenterX);
    let rotation = dragState.startRotation + (angle - dragState.startPointerAngle);

    // Snap to 15° increments with shift
    if (shiftKey) {
      const step = Math.PI / 12;
      rotation = Math.round(rotation / step) * step;
    }

    store.updateLayer(dragState.layerId, { rotation });
  } else {
    // Scale handles — work in the image's local (unrotated) frame
    const rot = dragState.startRotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    // Mouse delta rotated into local frame
    const ldx = dx * cos + dy * sin;
    const ldy = -dx * sin + dy * cos;

    const startW = layer.naturalWidth * dragState.startScaleX;
    const startH = layer.naturalHeight * dragState.startScaleY;

    const handle = dragState.handle;
    let newW = startW;
    let newH = startH;

    if (handle.includes('e')) newW = startW + ldx;
    if (handle.includes('w')) newW = startW - ldx;
    if (handle.includes('s')) newH = startH + ldy;
    if (handle.includes('n')) newH = startH - ldy;

    let newScaleX = Math.max(0.01, newW / layer.naturalWidth);
    let newScaleY = Math.max(0.01, newH / layer.naturalHeight);

    // Aspect-ratio lock applies to corner handles (those affecting both axes).
    // The per-layer setting can be temporarily inverted by holding Shift.
    const isCorner = newW !== startW && newH !== startH;
    const lockAspect = layer.lockAspectRatio !== shiftKey;
    if (isCorner && lockAspect) {
      const ratioX = newScaleX / dragState.startScaleX;
      const ratioY = newScaleY / dragState.startScaleY;
      const ratio = Math.abs(ratioX - 1) >= Math.abs(ratioY - 1) ? ratioX : ratioY;
      newScaleX = Math.max(0.01, dragState.startScaleX * ratio);
      newScaleY = Math.max(0.01, dragState.startScaleY * ratio);
    }

    newW = layer.naturalWidth * newScaleX;
    newH = layer.naturalHeight * newScaleY;

    // Keep the opposite handle anchored: its scene position must not move.
    const startAnchor = anchorOffset(handle, startW, startH);
    const anchorSceneX = dragState.startCenterX + startAnchor.x * cos - startAnchor.y * sin;
    const anchorSceneY = dragState.startCenterY + startAnchor.x * sin + startAnchor.y * cos;

    const newAnchor = anchorOffset(handle, newW, newH);
    const newCenterX = anchorSceneX - (newAnchor.x * cos - newAnchor.y * sin);
    const newCenterY = anchorSceneY - (newAnchor.x * sin + newAnchor.y * cos);

    store.updateLayer(dragState.layerId, {
      x: newCenterX - newW / 2,
      y: newCenterY - newH / 2,
      scaleX: newScaleX,
      scaleY: newScaleY,
    });
  }

  return true;
}

export function handleTransformMouseUp(): boolean {
  if (!dragState || !dragState.active) return false;
  dragState = null;
  return true;
}

export function isDragging(): boolean {
  return dragState !== null && dragState.active;
}
