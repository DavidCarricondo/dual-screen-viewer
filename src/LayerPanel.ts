import { store } from './store';
import { Layer } from './types';
import { clearImageCache } from './renderer';

export function createLayerPanel(container: HTMLElement): { update: () => void } {
  container.innerHTML = `
    <div class="layer-panel">
      <div class="layer-panel-header">
        <h3>Layers</h3>
      </div>
      <div class="layer-list" id="layer-list"></div>
    </div>
  `;

  const listEl = container.querySelector('#layer-list') as HTMLElement;

  function update(): void {
    const layers = store.getLayers().reverse(); // top-most first in UI
    const selectedId = store.getState().selectedLayerId;

    listEl.innerHTML = '';
    for (const layer of layers) {
      const row = createLayerRow(layer, layer.id === selectedId);
      listEl.appendChild(row);
    }
  }

  // Drag and drop reorder
  let draggedId: string | null = null;

  function createLayerRow(layer: Layer, selected: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `layer-row ${selected ? 'selected' : ''} ${layer.locked ? 'locked' : ''}`;
    row.dataset.layerId = layer.id;
    row.draggable = true;

    const icon = layer.type === 'image' ? '🖼' : layer.type === 'grid' ? '⊞' : '🌫';

    row.innerHTML = `
      <span class="layer-icon">${icon}</span>
      <span class="layer-name">${escapeHtml(layer.name)}</span>
      <div class="layer-controls">
        <button class="layer-btn vis-btn" title="${layer.visible ? 'Hide' : 'Show'}">${layer.visible ? '👁' : '—'}</button>
        <button class="layer-btn lock-btn" title="${layer.locked ? 'Unlock' : 'Lock'}">${layer.locked ? '🔒' : '🔓'}</button>
        <input type="range" class="opacity-slider" min="0" max="100" value="${Math.round(layer.opacity * 100)}" title="Opacity">
        <button class="layer-btn del-btn" title="Delete">✕</button>
      </div>
    `;

    // Click to select
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.layer-controls')) return;
      store.selectLayer(layer.id);
    });

    // Visibility toggle
    row.querySelector('.vis-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      store.updateLayer(layer.id, { visible: !layer.visible });
    });

    // Lock toggle
    row.querySelector('.lock-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      store.updateLayer(layer.id, { locked: !layer.locked });
    });

    // Opacity slider
    const slider = row.querySelector('.opacity-slider') as HTMLInputElement;
    slider.addEventListener('input', (e) => {
      e.stopPropagation();
      store.updateLayer(layer.id, { opacity: parseInt(slider.value) / 100 });
    });

    // Delete
    row.querySelector('.del-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (layer.type === 'image') clearImageCache(layer.id);
      store.removeLayer(layer.id);
    });

    // Drag start
    row.addEventListener('dragstart', (e) => {
      draggedId = layer.id;
      row.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      draggedId = null;
      row.classList.remove('dragging');
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedId || draggedId === layer.id) return;

      // Reorder: get current layer order from DOM
      const rows = Array.from(listEl.querySelectorAll('.layer-row'));
      const ids = rows.map(r => (r as HTMLElement).dataset.layerId!);

      // Remove dragged from current position
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(layer.id);
      if (fromIdx === -1 || toIdx === -1) return;

      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);

      // Reverse because UI is top-first but zIndex is bottom-first
      store.reorderLayers([...ids].reverse());
    });

    return row;
  }

  return { update };
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
