import { AppState, SessionState, Layer, ImageLayer, ToolMode, Viewport, DEFAULT_VIEWPORT } from './types';

type Listener = () => void;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

function generateId(): string {
  return crypto.randomUUID();
}

function createDefaultSession(): SessionState {
  return {
    canvasWidth: 1920,
    canvasHeight: 1080,
    layers: [],
    measurement: null,
    viewport: { ...DEFAULT_VIEWPORT },
  };
}

class StateStore {
  private state: AppState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = {
      session: createDefaultSession(),
      selectedLayerId: null,
      activeTool: 'select',
      fogBrushRadius: 30,
    };
  }

  getState(): AppState {
    return this.state;
  }

  getSession(): SessionState {
    return this.state.session;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // Layer mutations
  addLayer(layer: Layer): void {
    const maxZ = this.state.session.layers.reduce((max, l) => Math.max(max, l.zIndex), -1);
    layer.zIndex = maxZ + 1;
    layer.id = layer.id || generateId();
    this.state.session.layers.push(layer);
    this.notify();
  }

  removeLayer(id: string): void {
    this.state.session.layers = this.state.session.layers.filter(l => l.id !== id);
    if (this.state.selectedLayerId === id) {
      this.state.selectedLayerId = null;
    }
    this.notify();
  }

  updateLayer(id: string, updates: Partial<Layer>): void {
    const layer = this.state.session.layers.find(l => l.id === id);
    if (layer) {
      Object.assign(layer, updates);
      this.notify();
    }
  }

  getLayer(id: string): Layer | undefined {
    return this.state.session.layers.find(l => l.id === id);
  }

  getLayers(): Layer[] {
    return [...this.state.session.layers].sort((a, b) => a.zIndex - b.zIndex);
  }

  reorderLayers(orderedIds: string[]): void {
    for (let i = 0; i < orderedIds.length; i++) {
      const layer = this.state.session.layers.find(l => l.id === orderedIds[i]);
      if (layer) {
        layer.zIndex = i;
      }
    }
    this.notify();
  }

  // Move a layer forward (+1) or backward (-1) in the stacking order
  moveLayer(id: string, delta: 1 | -1): void {
    const ordered = this.getLayers(); // bottom-first
    const idx = ordered.findIndex(l => l.id === id);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= ordered.length) return;
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    ordered.forEach((layer, i) => { layer.zIndex = i; });
    this.notify();
  }

  // Selection
  selectLayer(id: string | null): void {
    this.state.selectedLayerId = id;
    this.notify();
  }

  getSelectedLayer(): Layer | undefined {
    if (!this.state.selectedLayerId) return undefined;
    return this.getLayer(this.state.selectedLayerId);
  }

  // Tool mode
  setTool(tool: ToolMode): void {
    this.state.activeTool = tool;
    if (tool !== 'measure') {
      this.state.session.measurement = null;
    }
    this.notify();
  }

  // Measurement
  setMeasurement(startX: number, startY: number, endX: number, endY: number): void {
    this.state.session.measurement = { active: true, startX, startY, endX, endY };
    this.notify();
  }

  clearMeasurement(): void {
    this.state.session.measurement = null;
    this.notify();
  }

  // Fog brush
  setFogBrushRadius(radius: number): void {
    this.state.fogBrushRadius = Math.max(5, Math.min(200, radius));
    this.notify();
  }

  // Viewport (zoom / pan) — shared transform applied to all layers
  getViewport(): Viewport {
    return this.state.session.viewport;
  }

  setZoom(zoom: number): void {
    this.state.session.viewport.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this.notify();
  }

  setPan(panX: number, panY: number): void {
    this.state.session.viewport.panX = panX;
    this.state.session.viewport.panY = panY;
    this.notify();
  }

  // Set zoom and pan together (used by cursor-anchored wheel zoom)
  setViewport(zoom: number, panX: number, panY: number): void {
    this.state.session.viewport.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this.state.session.viewport.panX = panX;
    this.state.session.viewport.panY = panY;
    this.notify();
  }

  resetViewport(): void {
    this.state.session.viewport = { ...DEFAULT_VIEWPORT };
    this.notify();
  }

  // Session load/replace
  loadSession(session: SessionState): void {
    // Back-compat: older sessions may not include a viewport
    if (!session.viewport) {
      session.viewport = { ...DEFAULT_VIEWPORT };
    }
    // Back-compat: older image layers may not include lockAspectRatio
    for (const layer of session.layers) {
      if (layer.type === 'image' && (layer as ImageLayer).lockAspectRatio === undefined) {
        (layer as ImageLayer).lockAspectRatio = true;
      }
    }
    this.state.session = session;
    this.state.selectedLayerId = null;
    this.state.activeTool = 'select';
    this.notify();
  }

  // Canvas size
  setCanvasSize(width: number, height: number): void {
    this.state.session.canvasWidth = width;
    this.state.session.canvasHeight = height;
    this.notify();
  }
}

export const store = new StateStore();
