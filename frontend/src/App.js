import React, { useRef, useState } from 'react';
import './App.css';
import TestLog from './TestLog';
const API = 'http://127.0.0.1:5000';
const W = 400;
const H = 300;

// The backend reads these two 40x40 regions of the 400x300 image.
const REF_BOX = { left: 50 / W, top: 130 / H, width: 40 / W, height: 40 / H };
const TEST_BOX = { left: 240 / W, top: 130 / H, width: 40 / W, height: 40 / H };

const boxStyle = (b, color) => ({
  position: 'absolute',
  left: `${b.left * 100}%`,
  top: `${b.top * 100}%`,
  width: `${b.width * 100}%`,
  height: `${b.height * 100}%`,
  border: `2px solid ${color}`,
  boxSizing: 'border-box'
});

const labelStyle = {
  position: 'absolute',
  top: '-20px',
  left: 0,
  fontSize: '11px',
  color: '#fff',
  background: 'rgba(0,0,0,0.65)',
  padding: '1px 4px',
  whiteSpace: 'nowrap'
};

const resultColor = (c) => {
  if (c === 'Positive') return '#c62828';
  if (c === 'Negative') return '#2e7d32';
  return '#ef6c00';
};

const buttonStyle = {
  padding: '0.6rem 1rem',
  marginRight: '0.5rem',
  marginTop: '0.5rem',
  fontSize: '1rem'
};

function Capture() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const [operatorId, setOperatorId] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  const startCamera = async () => {
    setStatus('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera needs a secure connection (https or localhost). Use "Upload image" for testing.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraOn(true);
    } catch (err) {
      setStatus('Could not open camera: ' + err.message);
    }
  };

  const captureGps = () => {
    setGps(null);
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
      (err) => setGpsError('Location unavailable: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Center-crop any image/video frame to 4:3, resize to 400x300, keep as JPEG.
  const processSource = (source, srcW, srcH) => {
    const targetRatio = W / H;
    let sw = srcW;
    let sh = srcH;
    if (srcW / srcH > targetRatio) {
      sw = srcH * targetRatio;
    } else {
      sh = srcW / targetRatio;
    }
    const sx = (srcW - sw) / 2;
    const sy = (srcH - sh) / 2;
    const canvas = canvasRef.current;
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
    canvas.toBlob(
      (blob) => {
        setPhotoBlob(blob);
        setPhotoUrl(URL.createObjectURL(blob));
        setResult(null);
        captureGps();
      },
      'image/jpeg',
      0.92
    );
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setStatus('Camera is not ready yet. Try again in a moment.');
      return;
    }
    processSource(video, video.videoWidth, video.videoHeight);
    stopCamera();
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      stopCamera();
      processSource(img, img.naturalWidth, img.naturalHeight);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  };

  const reset = () => {
    setPhotoBlob(null);
    setPhotoUrl(null);
    setResult(null);
    setGps(null);
    setGpsError('');
    setStatus('');
  };

  const submitTest = async () => {
    if (!operatorId.trim()) {
      setStatus('Enter the operator ID first.');
      return;
    }
    if (!photoBlob) {
      setStatus('Capture a photo first.');
      return;
    }
    if (!gps) {
      setStatus('Waiting for GPS location. Allow location access in the browser, then try again.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const form = new FormData();
      form.append('image', photoBlob, 'capture.jpg');
      form.append('operator_id', operatorId.trim());
      form.append('lat', gps.lat);
      form.append('lon', gps.lon);
      const res = await fetch(`${API}/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
    } catch (err) {
      setStatus('Upload failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '1rem', fontFamily: 'Arial', maxWidth: '520px', margin: '0 auto' }}>
      <h2>Field Test Recorder</h2>
      <p style={{ fontSize: '0.85rem', color: '#b71c1c', background: '#fdecea', padding: '0.5rem', borderRadius: 6 }}>
        Presumptive field-test result only. This does not replace laboratory confirmatory testing.
      </p>

      <label style={{ display: 'block', marginBottom: '0.75rem' }}>
        <strong>Operator ID</strong>
        <br />
        <input
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          placeholder="e.g. officer123"
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem', boxSizing: 'border-box' }}
        />
      </label>

      <p style={{ fontSize: '0.9rem' }}>
        Put the <strong>grey reference card</strong> inside the yellow box and the <strong>test patch</strong> inside the cyan box, in even lighting.
      </p>

      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#222', borderRadius: 8, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: photoUrl ? 'none' : 'block' }}
        />
        {photoUrl && (
          <img src={photoUrl} alt="Captured test" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <div style={boxStyle(REF_BOX, '#ffeb3b')}>
          <span style={labelStyle}>Reference card</span>
        </div>
        <div style={boxStyle(TEST_BOX, '#00e5ff')}>
          <span style={labelStyle}>Test patch</span>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />

      <div>
        {!photoUrl && !cameraOn && (
          <button style={buttonStyle} onClick={startCamera}>Start camera</button>
        )}
        {!photoUrl && cameraOn && (
          <button style={buttonStyle} onClick={capturePhoto}>Capture photo</button>
        )}
        {!photoUrl && (
          <button style={buttonStyle} onClick={() => fileInputRef.current && fileInputRef.current.click()}>
            Upload image (testing only)
          </button>
        )}
        {photoUrl && !result && (
          <button
            style={{ ...buttonStyle, background: '#1565c0', color: '#fff' }}
            onClick={submitTest}
            disabled={busy}
          >
            {busy ? 'Saving...' : 'Submit test record'}
          </button>
        )}
        {photoUrl && (
          <button style={buttonStyle} onClick={reset}>{result ? 'New test' : 'Retake'}</button>
        )}
      </div>

      {photoUrl && (
        <p style={{ fontSize: '0.85rem' }}>
          {gps
            ? `Location: ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)} (±${Math.round(gps.accuracy)} m)`
            : gpsError || 'Getting location...'}
        </p>
      )}

      {status && <p style={{ color: '#b71c1c' }}>{status}</p>}

      {result && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid #ccc', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>
            Result: <span style={{ color: resultColor(result.classification) }}>{result.classification}</span>
          </h3>
          <p>Record #{result.id} saved to the tamper-evident log.</p>
          <p style={{ fontSize: '0.85rem' }}>Time: {result.timestamp}</p>
          <p style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
            Image hash (SHA-256): {result.image_hash}
          </p>
          <p style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
            Record signature: {result.record_hash}
          </p>
          <p style={{ fontSize: '0.8rem', color: '#b71c1c' }}>
            Presumptive result only. Laboratory confirmation is required.
          </p>
        </div>
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState('capture');

  const tabStyle = (name) => ({
    padding: '0.5rem 1rem',
    fontSize: '1rem',
    border: '1px solid #1565c0',
    borderRadius: 6,
    cursor: 'pointer',
    background: view === name ? '#1565c0' : '#fff',
    color: view === name ? '#fff' : '#1565c0'
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem 0', maxWidth: '520px', margin: '0 auto' }}>
        <button style={tabStyle('capture')} onClick={() => setView('capture')}>New Test</button>
        <button style={tabStyle('log')} onClick={() => setView('log')}>Test Log</button>
      </div>
      <div style={{ display: view === 'capture' ? 'block' : 'none' }}>
        <Capture />
      </div>
      {view === 'log' && <TestLog />}
    </div>
  );
}

export default App;