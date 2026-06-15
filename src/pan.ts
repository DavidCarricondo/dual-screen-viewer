import { store } from './store';

// Pan ("hand") tool: drag to move all layers at once by shifting the viewport.
// Works in canvas-display space so the scene tracks the cursor 1:1 regardless
// of the current zoom level. `panDelta = canvasPixelDelta / sceneToCanvasScale`.

type PanDragState = {
  startCanvasX: number;
  startCanvasY: number;
  startPanX: number;
  startPanY: number;
  scale: number;
} | null;

let panDragState: PanDragState = null;

export function handlePanMouseDown(canvasX: number, canvasY: number, sceneToCanvasScale: number): boolean {
  const { panX, panY } = store.getViewport();
  panDragState = {
    startCanvasX: canvasX,
    startCanvasY: canvasY,
    startPanX: panX,
    startPanY: panY,
    scale: sceneToCanvasScale,
  };
  return true;
}

export function handlePanMouseMove(canvasX: number, canvasY: number): boolean {
  if (!panDragState) return false;
  const dx = (canvasX - panDragState.startCanvasX) / panDragState.scale;
  const dy = (canvasY - panDragState.startCanvasY) / panDragState.scale;
  store.setPan(panDragState.startPanX + dx, panDragState.startPanY + dy);
  return true;
}

export function handlePanMouseUp(): boolean {
  if (!panDragState) return false;
  panDragState = null;
  return true;
}

export function isPanning(): boolean {
  return panDragState !== null;
}
