import React, { useState, useEffect } from 'react';
import { ImageOff } from 'lucide-react';
import { apiFetch } from '../../services/aloyApi.js';

/**
 * An <img> for images served by Aloy's own API, which requires a Bearer token.
 *
 * A plain <img src="http://localhost:7890/api/..."> cannot work: the browser
 * will not attach an Authorization header to an image request, so every load
 * 401s. That is how the security snapshot route ended up registered ABOVE
 * requireAuth with the comment "Public snapshot route for <img> tags" — the
 * images were made to load by making the route public, which meant anyone able
 * to reach the port could pull camera footage of the house by walking the
 * predictable {camera}_{timestamp}.jpg filenames.
 *
 * Fetching through apiFetch and rendering the result as a blob: URL keeps the
 * route authenticated and still gets pixels on screen. Object URLs are revoked
 * on unmount and whenever src changes, so a long-lived polling feed does not
 * leak them.
 *
 * On failure this renders a visible placeholder rather than hiding itself. A
 * hidden broken image is indistinguishable from "the camera saw nothing",
 * which on a security surface is the wrong thing to be ambiguous about.
 */
export default function AuthedImage({
  src,
  alt = '',
  style = {},
  fallbackLabel = 'Snapshot unavailable',
  ...rest
}) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!src) {
      setObjectUrl(null);
      setError('No image');
      return undefined;
    }

    let cancelled = false;
    let createdUrl = null;
    setError(null);

    apiFetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        // Logged, not swallowed: a snapshot that stops loading is the first
        // sign the ingestion path has broken.
        console.warn('[AuthedImage] failed to load', src, err?.message || err);
        setError(err?.message || 'Load failed');
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  if (error || !objectUrl) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          color: '#475569',
          background: 'rgba(2, 6, 16, 0.6)',
          fontSize: '0.7rem',
          ...style
        }}
      >
        {error ? (
          <>
            <ImageOff size={20} />
            <span>{fallbackLabel}</span>
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>Loading…</span>
        )}
      </div>
    );
  }

  return <img src={objectUrl} alt={alt} style={style} {...rest} />;
}
