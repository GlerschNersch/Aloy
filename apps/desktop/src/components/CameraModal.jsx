import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, Check, UserCheck, Trash2, Upload } from 'lucide-react';
import { LocalFaceRecognitionEngine } from '../services/facerecognition';

export default function CameraModal({ isOpen, onClose, onCapture, onEnrollSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [enrolledStatus, setEnrolledStatus] = useState(null);
  const [enrollName, setEnrollName] = useState('User');
  const [enrolledFaces, setEnrolledFaces] = useState([]);
  const faceEngineRef = useRef(new LocalFaceRecognitionEngine());
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      startCamera();
      setEnrolledFaces(faceEngineRef.current.loadEnrolledFaces());
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  const startCamera = async () => {
    setErrorMsg(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error('Webcam access error:', err);
      setErrorMsg('Could not access webcam. Please allow camera permissions in your browser.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraActive(false);
  };

  const handleTakeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onCapture(dataUrl);
    stopCamera();
    onClose();
  };

  const handleEnrollFace = async () => {
    if (!videoRef.current || !enrollName.trim()) return;
    setEnrolledStatus('Enrolling...');
    const faceData = await faceEngineRef.current.enrollCurrentFace(videoRef.current, enrollName.trim());
    if (!faceData) {
      setEnrolledStatus('No face detected — try again with better lighting/framing.');
      setTimeout(() => setEnrolledStatus(null), 3000);
      return;
    }
    setEnrolledFaces(faceEngineRef.current.enrolledFaces);
    setEnrolledStatus(`"${faceData.label}" Enrolled Successfully!`);
    if (onEnrollSuccess) onEnrollSuccess(faceData);
    setTimeout(() => setEnrolledStatus(null), 3000);
  };

  const handleRemoveFace = (label) => {
    faceEngineRef.current.removeEnrolledFace(label);
    setEnrolledFaces(faceEngineRef.current.enrolledFaces);
  };

  // Enroll from an existing photo file instead of a live webcam capture —
  // useful for people who aren't sitting in front of the camera right now
  // (e.g. enrolling family members from photos on disk). Shares the same
  // enrollFromImageDataUrl core as the live-capture path.
  const handlePhotoFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file || !enrollName.trim()) return;
    setEnrolledStatus('Enrolling...');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const faceData = await faceEngineRef.current.enrollFromImageDataUrl(dataUrl, enrollName.trim());
    if (!faceData) {
      setEnrolledStatus('No face detected in that photo — try a clearer, more front-facing one.');
      setTimeout(() => setEnrolledStatus(null), 3000);
      return;
    }
    setEnrolledFaces(faceEngineRef.current.enrolledFaces);
    setEnrolledStatus(`"${faceData.label}" Enrolled Successfully!`);
    if (onEnrollSuccess) onEnrollSuccess(faceData);
    setTimeout(() => setEnrolledStatus(null), 3000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(5, 8, 14, 0.85)',
        backdropFilter: 'blur(14px)'
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            width: '100%',
            maxWidth: '640px',
            background: 'rgba(15, 21, 35, 0.95)',
            border: '1px solid rgba(0, 242, 254, 0.3)',
            borderRadius: '24px',
            padding: '1.5rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Camera size={22} color="#00f2fe" />
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                Webcam & ML Face Enrollment
              </span>
            </div>
            <button
              onClick={() => { stopCamera(); onClose(); }}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Video Preview Canvas */}
          <div style={{
            position: 'relative',
            width: '100%',
            height: '360px',
            borderRadius: '16px',
            overflow: 'hidden',
            background: '#10141f',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {errorMsg ? (
              <div style={{ color: '#ef4444', textAlign: 'center', padding: '1rem', fontSize: '0.9rem' }}>
                {errorMsg}
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Enrolled Success Overlay */}
            {enrolledStatus && (
              <div style={{
                position: 'absolute',
                top: '1rem',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(34, 197, 94, 0.9)',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 0 20px rgba(34, 197, 94, 0.5)'
              }}>
                <Check size={16} /> {enrolledStatus}
              </div>
            )}
          </div>

          {/* Enrolled Faces Roster — grouped by label since a person can now
              have multiple reference vectors (multiple enrolled photos), not
              just one; removing still clears all of a person's vectors. */}
          {enrolledFaces.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {Object.entries(
                enrolledFaces.reduce((acc, f) => ({ ...acc, [f.label]: (acc[f.label] || 0) + 1 }), {})
              ).map(([label, count]) => (
                <div key={label} className="glass-panel" style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '0.3rem 0.6rem', borderRadius: '999px', fontSize: '0.78rem', color: '#f1f5f9'
                }}>
                  <UserCheck size={12} color="#c084fc" /> {label}{count > 1 ? ` (${count})` : ''}
                  <button
                    onClick={() => handleRemoveFace(label)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    title={`Remove ${label}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Control Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={enrollName}
              onChange={(e) => setEnrollName(e.target.value)}
              placeholder="Name to enroll"
              className="glass-input"
              style={{ padding: '0.6rem 0.85rem', borderRadius: '10px', fontSize: '0.85rem', width: '160px' }}
            />

            <button
              onClick={handleEnrollFace}
              disabled={!isCameraActive || !enrollName.trim()}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#c084fc',
                cursor: (isCameraActive && enrollName.trim()) ? 'pointer' : 'not-allowed',
                fontWeight: 700,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <UserCheck size={16} /> Enroll This Face
            </button>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoFileSelected}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={!enrollName.trim()}
              title="Enroll from an existing photo instead of the webcam"
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                background: 'rgba(0, 242, 254, 0.08)',
                color: '#00f2fe',
                cursor: enrollName.trim() ? 'pointer' : 'not-allowed',
                fontWeight: 700,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Upload size={16} /> Upload Photo to Enroll
            </button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleTakeSnapshot}
              disabled={!isCameraActive}
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '12px',
                border: 'none',
                background: isCameraActive ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'rgba(255,255,255,0.1)',
                color: isCameraActive ? '#000' : '#64748b',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: isCameraActive ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: isCameraActive ? '0 0 20px rgba(0, 242, 254, 0.3)' : 'none'
              }}
            >
              <Camera size={16} /> Take Snapshot & Ask AI
            </motion.button>
          </div>
        </motion.div>
      </div>
      )}
    </AnimatePresence>
  );
}
