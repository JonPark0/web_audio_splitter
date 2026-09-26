import React, { useState } from 'react';
import { uploadFile, youtubeInfo, youtubeDownload, SEPARATION_MODELS } from '../api';
import RecoveryControls from './RecoveryControls';
import ErrorBanner from './ErrorBanner';
import Split from './Split';
import Field from './Field';
import TextButton from './TextButton';
import WordToggle from './WordToggle';

const INPUT_MODES = [
  { value: 'file', label: 'File' },
  { value: 'youtube', label: 'YouTube' },
];

export default function UploadScreen({ setStep, setTaskId, setYtMeta, setRecoveryState }) {
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'youtube'
  const [file, setFile] = useState(null);
  const [model, setModel] = useState('htdemucs');
  const [recover, setRecover] = useState(false);
  const [recoveryModel, setRecoveryModel] = useState('apollo');
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [ytLoading, setYtLoading] = useState(false);
  const [error, setError] = useState('');

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
    setError('');

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      setFile(droppedFile);
    } else {
      setError('Please drop an audio file.');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      const res = await uploadFile({ file, model, recover, recoveryModel });
      setTaskId(res.data.task_id);
      setRecoveryState({ recover, recoveryModel });
      setStep('processing');
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.detail || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl.trim()) return;
    setYtLoading(true);
    setError('');

    try {
      const infoRes = await youtubeInfo(youtubeUrl);
      const dlRes = await youtubeDownload({ url: youtubeUrl, model, recover, recoveryModel });

      setTaskId(dlRes.data.task_id);
      setYtMeta(infoRes.data);
      setRecoveryState({ recover, recoveryModel });
      setStep('youtube_confirm');
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to process YouTube URL.');
    } finally {
      setYtLoading(false);
    }
  };

  const submitting = inputMode === 'file' ? uploading : ytLoading;
  const canSubmit = inputMode === 'file' ? !!file && !uploading : !!youtubeUrl.trim() && !ytLoading;
  const submitLabel =
    inputMode === 'file'
      ? submitting
        ? 'Uploading...'
        : 'Start Separation'
      : submitting
      ? 'Fetching...'
      : 'Fetch from YouTube';

  const dropLabel = file ? file.name : 'Drop an audio file';

  return (
    <Split title="Upload">
      <div className="flex flex-col gap-6">
        <p className="m-0 text-muted">Split into stems, then optionally restore lost frequency detail.</p>

        <Field label="Source">
          <WordToggle name="input-mode" options={INPUT_MODES} value={inputMode} onChange={setInputMode} />
        </Field>

        <ErrorBanner message={error} onDismiss={() => setError('')} />

        {inputMode === 'file' && (
          // Drop target without a box (Palnarium's text-only "Add New Image"
          // upload): the words are the control. Hovering or dragging a file
          // over it raises the weight like a link; the drag also lays down
          // the one hover fill, wash, so the target area is visible.
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`group -mx-4 px-4 py-8 text-center transition-colors duration-140 ${isDragging ? 'bg-wash' : ''}`}
          >
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                setError('');
                setFile(e.target.files[0]);
              }}
              className="peer sr-only"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="flex cursor-pointer flex-col items-center gap-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ink"
            >
              <span
                data-label={dropLabel}
                className={`link max-w-full break-all text-h3 group-hover:[--_w:400] ${isDragging ? '[--_w:400]' : ''}`}
              >
                {dropLabel}
              </span>
              <span className="text-caption text-muted">
                {file
                  ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · click to choose another`
                  : 'or click to browse'}
              </span>
            </label>
          </div>
        )}

        {inputMode === 'youtube' && (
          <Field label="YouTube URL" htmlFor="youtube-url">
            <input
              id="youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
              className="ainput"
            />
          </Field>
        )}

        <Field label="Separation model" htmlFor="model-select">
          <select id="model-select" value={model} onChange={(e) => setModel(e.target.value)} className="ainput">
            {SEPARATION_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <RecoveryControls
          recover={recover}
          setRecover={setRecover}
          recoveryModel={recoveryModel}
          setRecoveryModel={setRecoveryModel}
        />

        <div className="pt-2 text-center">
          <TextButton
            onClick={inputMode === 'file' ? handleUpload : handleYoutubeSubmit}
            disabled={!canSubmit}
            className="text-h3"
          >
            {submitLabel}
          </TextButton>
        </div>
      </div>
    </Split>
  );
}
