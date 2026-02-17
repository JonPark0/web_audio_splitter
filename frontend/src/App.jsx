import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import WaveSurfer from 'wavesurfer.js';
import { FaPlay, FaPause, FaDownload, FaRedo, FaFileUpload, FaYoutube } from 'react-icons/fa';

const API_BASE = '/api';

// Color theme for tracks
const TRACK_COLORS = {
  vocals: '#9c27b0', // Purple
  drums: '#f44336',  // Red
  bass: '#ffeb3b',   // Yellow
  other: '#4caf50',  // Green
  default: '#2196f3' // Blue
};

function App() {
  const [step, setStep] = useState('upload'); // upload, youtube_confirm, processing, result
  const [taskId, setTaskId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [ytMeta, setYtMeta] = useState(null);

  return (
    <div className="container">
      <h1>Demucs Audio Splitter</h1>

      {step === 'upload' && <UploadScreen setStep={setStep} setTaskId={setTaskId} setYtMeta={setYtMeta} />}
      {step === 'youtube_confirm' && <YouTubeConfirmScreen taskId={taskId} ytMeta={ytMeta} setStep={setStep} />}
      {step === 'processing' && <ProcessingScreen taskId={taskId} setStep={setStep} setTracks={setTracks} />}
      {step === 'result' && <ResultScreen taskId={taskId} tracks={tracks} setStep={setStep} />}
    </div>
  );
}

function UploadScreen({ setStep, setTaskId, setYtMeta }) {
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'youtube'
  const [file, setFile] = useState(null);
  const [model, setModel] = useState('htdemucs');
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState('');

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      setFile(droppedFile);
    } else {
      alert('Please drop an audio file');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);

    try {
      const res = await axios.post(`${API_BASE}/upload`, formData);
      setTaskId(res.data.task_id);
      setStep('processing');
    } catch (e) {
      console.error(e);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl.trim()) return;
    setYtLoading(true);
    setYtError('');

    try {
      // Step 1: Validate URL and get metadata
      const infoRes = await axios.post(`${API_BASE}/youtube/info`,
        new URLSearchParams({ url: youtubeUrl }));

      // Step 2: Start background download
      const dlRes = await axios.post(`${API_BASE}/youtube/download`,
        new URLSearchParams({ url: youtubeUrl, model }));

      setTaskId(dlRes.data.task_id);
      setYtMeta(infoRes.data);
      setStep('youtube_confirm');
    } catch (e) {
      const msg = e.response?.data?.detail || 'Failed to process YouTube URL';
      setYtError(msg);
    } finally {
      setYtLoading(false);
    }
  };

  return (
    <div className="card center-content">
      <h2>Upload Audio</h2>

      <div className="input-mode-tabs">
        <button
          className={inputMode === 'file' ? '' : 'secondary'}
          onClick={() => setInputMode('file')}
        >
          <FaFileUpload /> File Upload
        </button>
        <button
          className={inputMode === 'youtube' ? '' : 'secondary'}
          onClick={() => setInputMode('youtube')}
        >
          <FaYoutube /> YouTube URL
        </button>
      </div>

      {inputMode === 'file' && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${isDragging ? '#bb86fc' : '#444'}`,
            padding: '40px',
            borderRadius: '10px',
            width: '80%',
            backgroundColor: isDragging ? 'rgba(187, 134, 252, 0.1)' : 'transparent',
            transition: 'all 0.2s ease'
          }}
        >
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files[0])}
            style={{ display: 'none' }}
            id="file-upload"
          />
          <label htmlFor="file-upload" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <FaFileUpload size={50} color={isDragging ? '#bb86fc' : '#666'} />
            <span>{file ? file.name : "Click or Drag & Drop Audio File"}</span>
          </label>
        </div>
      )}

      {inputMode === 'youtube' && (
        <div className="youtube-input-section">
          <input
            type="text"
            placeholder="Paste YouTube URL here..."
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="youtube-url-input"
            onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
          />
          {ytError && <p className="error-text">{ytError}</p>}
        </div>
      )}

      <div style={{ marginTop: '20px', marginBottom: '20px' }}>
        <label htmlFor="model-select" style={{ marginRight: '10px' }}>Model:</label>
        <select
          id="model-select"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{ padding: '5px', borderRadius: '5px' }}
        >
          <option value="htdemucs">htdemucs (Default)</option>
          <option value="htdemucs_ft">htdemucs_ft (Fine-tuned)</option>
          <option value="htdemucs_6s">htdemucs_6s (6 stems)</option>
          <option value="hdemucs_mmi">hdemucs_mmi</option>
          <option value="mdx">mdx</option>
          <option value="mdx_extra">mdx_extra</option>
          <option value="mdx_q">mdx_q (Quantized)</option>
          <option value="mdx_extra_q">mdx_extra_q (Quantized)</option>
          <option value="SIG">SIG</option>
        </select>
      </div>

      {inputMode === 'file' && (
        <button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? 'Uploading...' : 'Start Separation'}
        </button>
      )}
      {inputMode === 'youtube' && (
        <button onClick={handleYoutubeSubmit} disabled={!youtubeUrl.trim() || ytLoading}>
          {ytLoading ? 'Fetching...' : 'Fetch from YouTube'}
        </button>
      )}
    </div>
  );
}

function YouTubeConfirmScreen({ taskId, ytMeta, setStep }) {
  const [downloadStatus, setDownloadStatus] = useState('downloading');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE}/status/${taskId}`);
        const status = res.data.status;
        setDownloadStatus(status);
        if (status === 'downloaded' || status === 'download_failed') {
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [taskId]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await axios.post(`${API_BASE}/youtube/confirm/${taskId}`);
      setStep('processing');
    } catch (e) {
      alert('Failed to start processing');
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    setStep('upload');
  };

  return (
    <div className="card center-content">
      <h2>Confirm Audio</h2>

      {ytMeta && (
        <div className="yt-preview">
          {ytMeta.thumbnail && (
            <img src={ytMeta.thumbnail} alt={ytMeta.title} className="yt-thumbnail" />
          )}
          <div className="yt-info">
            <h3>{ytMeta.title}</h3>
            <p>Duration: {ytMeta.duration_formatted}</p>
          </div>
        </div>
      )}

      {downloadStatus === 'downloading' && (
        <div className="loader">Downloading audio from YouTube...</div>
      )}

      {downloadStatus === 'download_failed' && (
        <div>
          <p className="error-text">Download failed. Please try again.</p>
          <button onClick={handleCancel}>Go Back</button>
        </div>
      )}

      {downloadStatus === 'downloaded' && (
        <>
          <p>Preview the audio to make sure this is the correct track:</p>
          <audio
            controls
            src={`${API_BASE}/youtube/preview/${taskId}`}
            style={{ width: '100%', maxWidth: '600px', marginTop: '10px' }}
          />
          <div className="confirm-buttons">
            <button onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Starting...' : 'Confirm & Split'}
            </button>
            <button className="secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProcessingScreen({ taskId, setStep, setTracks }) {
  const [status, setStatus] = useState('queued');

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE}/status/${taskId}`);
        setStatus(res.data.status);

        if (res.data.status === 'completed') {
          const resultRes = await axios.get(`${API_BASE}/result/${taskId}`);
          setTracks(resultRes.data.tracks);
          setStep('result');
          clearInterval(interval);
        } else if (res.data.status === 'failed') {
          alert('Processing failed');
          setStep('upload');
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [taskId]);

  return (
    <div className="card center-content">
      <h2>Processing...</h2>
      <p>Status: <span style={{ fontWeight: 'bold', color: '#bb86fc' }}>{status.toUpperCase()}</span></p>
      <div className="loader">Separating tracks with Demucs AI...</div>
    </div>
  );
}

function ResultScreen({ taskId, tracks, setStep }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // Store refs to wavesurfer instances
  const surfers = useRef({});

  // When all tracks are ready
  useEffect(() => {
    if (readyCount > 0 && readyCount === tracks.length) {
      setIsReady(true);
    }
  }, [readyCount, tracks.length]);

  const togglePlay = () => {
    if (!isReady) return;

    // Toggle play on all instances
    const playing = !isPlaying;
    setIsPlaying(playing);

    Object.values(surfers.current).forEach(ws => {
      playing ? ws.play() : ws.pause();
    });
  };

  const handleSeek = (progress) => {
    // Seek all other tracks to this progress (0 to 1)
    Object.values(surfers.current).forEach(ws => {
      const duration = ws.getDuration();
      if (duration) {
         ws.seekTo(progress);
      }
    });
  };

  const handleReady = () => {
    setReadyCount(prev => prev + 1);
  };

  return (
    <div className="card">
      <div className="mixer-controls">
        <button onClick={togglePlay} disabled={!isReady} style={{ width: '120px' }}>
          {isPlaying ? <><FaPause /> Pause</> : <><FaPlay /> Play</>}
        </button>
        <button className="secondary" onClick={() => setStep('upload')}>
          <FaRedo /> New File
        </button>
      </div>

      {!isReady && <p style={{ textAlign: 'center' }}>Loading waveforms... ({readyCount}/{tracks.length})</p>}

      <div className="tracks-container">
        {tracks.map(track => (
          <TrackRow
            key={track}
            taskId={taskId}
            trackName={track}
            surfers={surfers}
            onReady={handleReady}
            onSeek={handleSeek}
          />
        ))}
      </div>
    </div>
  );
}

function TrackRow({ taskId, trackName, surfers, onReady, onSeek }) {
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const name = trackName.replace('.wav', '');
  // Determine color based on track name (loose match)
  const colorKey = Object.keys(TRACK_COLORS).find(k => name.toLowerCase().includes(k)) || 'default';
  const color = TRACK_COLORS[colorKey];

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: '#fff', // White progress bar/cursor
      cursorColor: '#fff',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 100,
      normalize: true,
      backend: 'MediaElement', // Use HTML5 Audio
      responsive: true,
      fillParent: true,
      interact: true, // Allow clicking
    });

    ws.load(`${API_BASE}/download/${taskId}/${trackName}`);

    ws.on('ready', () => {
      wsRef.current = ws;
      surfers.current[trackName] = ws;
      onReady();
    });

    // Sync seeking
    ws.on('interaction', (newTime) => {
        // newTime is in seconds, need percentage for sync
        const duration = ws.getDuration();
        const progress = newTime / duration;
        onSeek(progress);
    });

    return () => {
      ws.destroy();
      delete surfers.current[trackName];
    };
  }, []);

  const setVolume = (val) => {
    if (wsRef.current) {
      wsRef.current.setVolume(val);
    }
  };

  return (
    <div className="track-row">
      <div className="track-controls">
        <div className="track-label" style={{ color: color }}>{name}</div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          defaultValue="1"
          className="volume-slider"
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          title="Volume"
        />
      </div>

      <div className="track-waveform" ref={containerRef}>
        {/* Wavesurfer renders here */}
      </div>

      <div className="track-actions">
        <a href={`${API_BASE}/download/${taskId}/${trackName}`} download className="icon-btn" title="Download Track">
          <FaDownload />
        </a>
      </div>
    </div>
  );
}

export default App;
