// Shared Global Webcam Stream Manager
// Ensures single-owner hardware binding for Logitech Webcam C930e across
// Face Recognition, Ambient Room Observer, and Vision pipelines on Windows.

let sharedStream = null;
let sharedVideoElement = null;
let initPromise = null;

export async function initSharedWebcam({ width = 640, height = 480 } = {}) {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  if (sharedVideoElement && sharedStream && sharedStream.active) {
    return sharedVideoElement;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Find Logitech webcam or default video
      let videoDeviceId = undefined;
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        const webcam = videoInputs.find((d) => /\b(webcam|c930|logitech|camera)\b/i.test(d.label || ''));
        if (webcam && webcam.deviceId) videoDeviceId = { exact: webcam.deviceId };
      }

      sharedStream = await navigator.mediaDevices.getUserMedia({
        video: videoDeviceId
          ? { deviceId: videoDeviceId, width: { ideal: width }, height: { ideal: height } }
          : { width: { ideal: width }, height: { ideal: height } },
        audio: false
      });

      if (!sharedVideoElement) {
        sharedVideoElement = document.createElement('video');
        sharedVideoElement.muted = true;
        sharedVideoElement.playsInline = true;
        sharedVideoElement.autoplay = true;
        sharedVideoElement.style.position = 'fixed';
        sharedVideoElement.style.top = '-9999px';
        sharedVideoElement.style.left = '-9999px';
        sharedVideoElement.style.width = `${width}px`;
        sharedVideoElement.style.height = `${height}px`;
        sharedVideoElement.style.opacity = '0';
        sharedVideoElement.style.pointerEvents = 'none';
        document.body.appendChild(sharedVideoElement);
      }

      sharedVideoElement.srcObject = sharedStream;
      await sharedVideoElement.play();

      // Wait for video frame to be ready
      if (sharedVideoElement.readyState < 2 || !sharedVideoElement.videoWidth) {
        await new Promise((resolve) => {
          sharedVideoElement.onloadeddata = resolve;
          sharedVideoElement.oncanplay = resolve;
          setTimeout(resolve, 600);
        });
      }

      return sharedVideoElement;
    } catch (err) {
      console.warn('[WebcamManager] Could not initialize shared webcam:', err);
      sharedStream = null;
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export function getSharedWebcamVideo() {
  return sharedVideoElement;
}

export async function captureSharedWebcamFrame({ width = 640, height = 480, quality = 0.85 } = {}) {
  try {
    let video = sharedVideoElement;
    if (!video || !sharedStream || !sharedStream.active) {
      video = await initSharedWebcam({ width, height });
    }

    if (!video) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || width;
    canvas.height = video.videoHeight || height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return dataUrl;
  } catch (err) {
    console.warn('[WebcamManager] Error capturing shared frame:', err);
    return null;
  }
}

export function stopSharedWebcam() {
  if (sharedStream) {
    sharedStream.getTracks().forEach((track) => track.stop());
    sharedStream = null;
  }
  if (sharedVideoElement) {
    sharedVideoElement.srcObject = null;
  }
}
