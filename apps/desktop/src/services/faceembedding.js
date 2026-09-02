// 100% Local InsightFace (ArcFace) face detection + embedding service.
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { sidecarAuthHeaders } from './sidecarAuth.js';

const FACE_SERVER_URL = 'http://localhost:8891';

export async function checkFaceServerStatus() {
  try {
    const r = await fetchWithTimeout(`${FACE_SERVER_URL}/health`, { method: 'GET', headers: await sidecarAuthHeaders() }, 5000);
    return r.ok;
  } catch {
    return false;
  }
}

// Returns { faceDetected: boolean, embedding: number[] | null } or null on
// a hard failure (server unreachable) — the caller decides how to treat that.
export async function getFaceEmbedding(imageDataUrl) {
  try {
    const res = await fetchWithTimeout(`${FACE_SERVER_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await sidecarAuthHeaders()) },
      body: JSON.stringify({ image: imageDataUrl })
    }, 20000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;
    return { faceDetected: !!data.faceDetected, embedding: data.embedding || null };
  } catch (err) {
    console.error('Face embedding request error:', err);
    return null;
  }
}
