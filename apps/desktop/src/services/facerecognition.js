// Local face recognition — face detection + embedding runs via a local
// InsightFace (ArcFace) server (services/faceembedding.js, face_server.py),
// not in-browser. This class just manages enrollment storage and matching
// (cosine similarity over 512-d ArcFace embeddings) against multiple named
// enrolled faces.
import { getFaceEmbedding } from './faceembedding';

const STORAGE_KEY = 'ollama_pro_enrolled_faces';
const LEGACY_STORAGE_KEY = 'ollama_pro_enrolled_face';
const EMBEDDING_ENGINE = 'arcface-v1';

// Cosine similarity threshold for ArcFace embeddings. Same-person pairs
// typically score well above this and different people well below it, but
// this is a reasonable default rather than a precisely tuned value — adjust
// if real-world testing shows too many false matches/misses.
const MATCH_THRESHOLD = 0.42;

function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class LocalFaceRecognitionEngine {
  constructor() {
    this.enrolledFaces = this.loadEnrolledFaces();
  }

  loadEnrolledFaces() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // Older enrollments used a completely different (brightness-heuristic)
      // vector format that isn't comparable to ArcFace embeddings — drop
      // anything not tagged with the current engine rather than let it sit
      // there silently failing to ever match.
      const parsed = JSON.parse(saved);
      return parsed.filter(f => f.engine === EMBEDDING_ENGINE);
    }
    if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return [];
  }

  saveEnrolledFaces(faces) {
    this.enrolledFaces = faces;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(faces));
  }

  removeEnrolledFace(label) {
    this.saveEnrolledFaces(this.enrolledFaces.filter(f => f.label !== label));
  }

  captureFrameAsDataUrl(videoElement) {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 320;
    canvas.height = videoElement.videoHeight || 240;
    canvas.getContext('2d').drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  // Core enrollment primitive — takes any image data URL, not just a live
  // webcam frame, so a person can also be enrolled from an existing photo
  // (enrollCurrentFace below is now a thin wrapper over this for the
  // webcam case). Appends rather than replaces same-label entries: multiple
  // reference photos per person (different angle/lighting/expression) make
  // recognizeFace's best-match-across-all-vectors loop meaningfully more
  // robust than a single reference vector, especially for distinguishing
  // similar-looking family members. removeEnrolledFace still clears every
  // vector for a label in one shot.
  async enrollFromImageDataUrl(dataUrl, label) {
    const result = await getFaceEmbedding(dataUrl);
    if (!result || !result.faceDetected || !result.embedding) return null;

    const faceData = {
      label,
      vector: result.embedding,
      engine: EMBEDDING_ENGINE,
      enrolledAt: new Date().toISOString()
    };
    this.saveEnrolledFaces([...this.enrolledFaces, faceData]);
    return faceData;
  }

  async enrollCurrentFace(videoElement, label) {
    return this.enrollFromImageDataUrl(this.captureFrameAsDataUrl(videoElement), label);
  }

  async recognizeFace(videoElement) {
    // Re-read from storage each call: a different engine instance (e.g.
    // CameraModal's) may have enrolled/removed a face since this instance
    // was built, and this poll only runs a few times a minute.
    this.enrolledFaces = this.loadEnrolledFaces();

    if (!videoElement) {
      return { isEnrolled: false, isMatch: false, confidence: 0, label: 'Away / No Camera' };
    }

    const result = await getFaceEmbedding(this.captureFrameAsDataUrl(videoElement));

    if (!result) {
      return { isEnrolled: this.enrolledFaces.length > 0, isMatch: false, confidence: 0, label: 'Face Server Offline' };
    }
    if (!result.faceDetected) {
      return { isEnrolled: this.enrolledFaces.length > 0, isMatch: false, confidence: 0, label: 'Away / Empty Room' };
    }
    if (this.enrolledFaces.length === 0) {
      return { isEnrolled: false, isMatch: false, confidence: 0, label: 'Unknown Person (Not Enrolled)' };
    }

    let best = null;
    for (const face of this.enrolledFaces) {
      const similarity = cosineSimilarity(result.embedding, face.vector);
      if (!best || similarity > best.similarity) best = { label: face.label, similarity };
    }

    const isMatch = best.similarity >= MATCH_THRESHOLD;
    return {
      isEnrolled: true,
      isMatch,
      confidence: isMatch ? Math.round(best.similarity * 100) : 0,
      label: isMatch ? best.label : 'Unknown Person'
    };
  }
}
