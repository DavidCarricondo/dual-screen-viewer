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
} | null;

let dragState: DragState = null;

export function getHandleCursor(handle: string | null): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'move': return 'move';
    default: return 'default';
  }
}

export function handleTransformMouseDown(
  canvasX: number,
  canvasY: number,
  sceneToCanvasScale: number,
): boolean {
  const selected = store.getSelectedLayer();
  if (!selected || selected.type !== 'image' || selected.locked) return false;

  // Convert canvas coords to scene coords
  const sceneX = canvasX / sceneToCanvasScale;
  const sceneY = canvasY / sceneToCanvasScale;

  const handle = getHandleAtPoint(selected as ImageLayer, sceneX, sceneY);
  if (!handle) return false;

  const layer = selected as ImageLayer;
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
  };

  return true;
}

export function handleTransformMouseMove(
  canvasX: number,
  canvasY: number,
  sceneToCanvasScale: number,
  shiftKey: boolean,
): boolean {
  if (!dragState || !dragState.active) return false;

  const sceneX = canvasX / sceneToCanvasScale;
  const sceneY = canvasY / sceneToCanvasScale;
  const dx = sceneX - dragState.startMouseX;
  const dy = sceneY - dragState.startMouseY;

  const layer = store.getLayer(dragState.layerId) as ImageLayer;
  if (!layer) return false;

  if (dragState.handle === 'move') {
    store.updateLayer(dragState.layerId, {
      x: dragState.startLayerX + dx,
      y: dragState.startLayerY + dy,
    });
  } else {
    // Scale handles
    let newScaleX = dragState.startScaleX;
    let newScaleY = dragState.startScaleY;
    let newX = dragState.startLayerX;
    let newY = dragState.startLayerY;

    const handle = dragState.handle;

    if (handle.includes('e')) {
      newScaleX = dragState.startScaleX + dx / layer.naturalWidth;
    }
    if (handle.includes('w')) {
      newScaleX = dragState.startScaleX - dx / layer.naturalWidth;
      newX = dragState.startLayerX + dx;
    }
    if (handle.includes('s')) {
      newScaleY = dragState.startScaleY + dy / layer.naturalHeight;
    }
    if (handle.includes('n')) {
      newScaleY = dragState.startScaleY - dy / layer.naturalHeight;
      newY = dragState.startLayerY + dy;
    }

    // Lock aspect ratio with shift
    if (shiftKey) {
      const avgScale = (newScaleX + newScaleY) / 2;
      newScaleX = avgScale;
      newScaleY = avgScale;
    }

    // Prevent negative scale
    newScaleX = Math.max(0.01, newScaleX);
    newScaleY = Math.max(0.01, newScaleY);

    store.updateLayer(dragState.layerId, {
      x: newX,
      y: newY,
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
