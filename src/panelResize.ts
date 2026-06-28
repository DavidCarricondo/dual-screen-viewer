// Lets the user drag the separator on the left edge of the layers panel to
// widen or narrow it — handy for reading long layer names in full.

const MIN_WIDTH = 220;
const MAX_WIDTH = 600;
// Always leave at least this much room for the preview canvas.
const MIN_PREVIEW_WIDTH = 320;

export function setupLayerPanelResize(onResize: () => void): void {
  const resizer = document.getElementById('layer-panel-resizer');
  const panel = document.getElementById('layer-panel-container');
  if (!resizer || !panel) return;

  let dragging = false;

  function applyWidth(clientX: number): void {
    // Panel is flush against the window's right edge, so its width is the
    // distance from the cursor to that edge.
    const desired = window.innerWidth - clientX;
    const maxAllowed = Math.min(MAX_WIDTH, window.innerWidth - MIN_PREVIEW_WIDTH);
    const clamped = Math.max(MIN_WIDTH, Math.min(maxAllowed, desired));
    panel!.style.width = `${clamped}px`;
    onResize();
  }

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    applyWidth(e.clientX);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
  });
}
