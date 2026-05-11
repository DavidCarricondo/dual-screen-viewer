import { store } from './store';

let measuring = false;

export function handleMeasureMouseDown(sceneX: number, sceneY: number): void {
  measuring = true;
  store.setMeasurement(sceneX, sceneY, sceneX, sceneY);
}

export function handleMeasureMouseMove(sceneX: number, sceneY: number): void {
  if (!measuring) return;
  const m = store.getState().session.measurement;
  if (!m) return;
  store.setMeasurement(m.startX, m.startY, sceneX, sceneY);
}

export function handleMeasureMouseUp(): void {
  measuring = false;
  // Measurement persists on canvas until cleared
}

export function isMeasuring(): boolean {
  return measuring;
}
