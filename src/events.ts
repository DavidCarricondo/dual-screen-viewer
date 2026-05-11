import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SessionState } from './types';

// Broadcast scene state from primary to secondary via Rust backend
export async function broadcastSceneUpdate(session: SessionState): Promise<void> {
  try {
    await invoke('broadcast_to_secondary', {
      event: 'scene:update',
      payload: JSON.stringify(session),
    });
  } catch (e) {
    // Secondary window may not be open yet
    console.warn('Failed to broadcast:', e);
  }
}

// Listen for scene updates (used by secondary window)
export function onSceneUpdate(callback: (session: SessionState) => void): Promise<() => void> {
  return listen<string>('scene:update', (event) => {
    try {
      const session = JSON.parse(event.payload) as SessionState;
      callback(session);
    } catch (e) {
      console.error('Failed to parse scene update:', e);
    }
  });
}

// Broadcast fog delta during active brush stroke (lightweight)
export async function broadcastFogDelta(delta: { points: Array<{ x: number; y: number }>; radius: number }): Promise<void> {
  try {
    await invoke('broadcast_to_secondary', {
      event: 'fog:delta',
      payload: JSON.stringify(delta),
    });
  } catch {
    // ignore
  }
}

export function onFogDelta(callback: (delta: { points: Array<{ x: number; y: number }>; radius: number }) => void): Promise<() => void> {
  return listen<string>('fog:delta', (event) => {
    try {
      callback(JSON.parse(event.payload));
    } catch {
      // ignore
    }
  });
}
