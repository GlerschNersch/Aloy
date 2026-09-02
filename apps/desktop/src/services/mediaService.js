// Client service for Aloy Universal Media Dispatcher
// Uses apiJson/apiFetch from aloyApi.js to ensure authenticated communication with port 7890

import { apiJson, apiFetch } from './aloyApi.js';

export async function fetchPlaybackTargets() {
  try {
    const data = await apiJson('/api/media/targets');
    return data.targets || [];
  } catch (err) {
    console.error('Failed to fetch playback targets:', err);
    return [
      {
        id: 'local',
        type: 'local',
        name: 'This PC (Desktop)',
        status: 'online',
        icon: 'Monitor',
        description: 'Play locally in default video player'
      }
    ];
  }
}

export async function searchMediaLibrary(query = '', limit = 1500, category = 'all') {
  try {
    const params = new URLSearchParams();
    if (query) params.append('query', query);
    if (limit) params.append('limit', String(limit));
    if (category && category !== 'all') params.append('category', category);
    const data = await apiJson(`/api/media/library?${params.toString()}`);
    return data.results || [];
  } catch (err) {
    console.error('Failed to search media library:', err);
    return [];
  }
}

export async function dispatchMediaPlayback({ targetId, mediaPath, mediaTitle, itemId }) {
  try {
    const data = await apiJson('/api/media/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, mediaPath, mediaTitle, itemId }),
      timeoutMs: 12000
    });
    if (!data.success) {
      throw new Error(data.error || 'Dispatch failed');
    }
    return data;
  } catch (err) {
    console.error('Failed to dispatch media:', err);
    throw err;
  }
}
