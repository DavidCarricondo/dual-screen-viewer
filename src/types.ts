export type LayerType = 'image' | 'grid' | 'fog';

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0.0–1.0
  zIndex: number;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;       // asset URL from convertFileSrc
  filePath: string;   // original absolute path for persistence
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // radians, around image center
  naturalWidth: number;
  naturalHeight: number;
}

export interface GridLayer extends BaseLayer {
  type: 'grid';
  cellSizePx: number;
  color: string;
  lineWidth: number;
}

export interface FogLayer extends BaseLayer {
  type: 'fog';
  erasedStrokes: ErasedStroke[];
}

export interface ErasedStroke {
  points: Array<{ x: number; y: number }>;
  radius: number;
}

export type Layer = ImageLayer | GridLayer | FogLayer;

export interface MeasurementState {
  active: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface Viewport {
  zoom: number;  // scale factor applied to all layers, 1.0 = 100%
  panX: number;  // pan offset in scene space (pixels)
  panY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

export interface SessionState {
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  measurement: MeasurementState | null;
  viewport: Viewport;
}

export type RenderMode = 'primary' | 'secondary';

export type ToolMode = 'select' | 'fog-brush' | 'measure' | 'pan';

export interface AppState {
  session: SessionState;
  selectedLayerId: string | null;
  activeTool: ToolMode;
  fogBrushRadius: number;
}
