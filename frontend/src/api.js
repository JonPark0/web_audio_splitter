import axios from 'axios';

const API_BASE = '/api';

export const RECOVERY_MODELS = [
  { value: 'apollo', label: 'Apollo', hint: 'Fast, CPU-friendly. Best for restoring lossy/compressed sources.' },
  { value: 'audiosr', label: 'AudioSR', hint: 'Full any→48kHz super-resolution. Much slower; GPU recommended.' },
  { value: 'flashsr', label: 'FlashSR', hint: 'Fastest (single-step). Unproven on music specifically, no stated license.' },
];

export const SEPARATION_MODELS = [
  { value: 'htdemucs', label: 'htdemucs (Default)' },
  { value: 'htdemucs_ft', label: 'htdemucs_ft (Fine-tuned)' },
  { value: 'htdemucs_6s', label: 'htdemucs_6s (6 stems)' },
  { value: 'hdemucs_mmi', label: 'hdemucs_mmi' },
  { value: 'mdx', label: 'mdx' },
  { value: 'mdx_extra', label: 'mdx_extra' },
  { value: 'mdx_q', label: 'mdx_q (Quantized)' },
  { value: 'mdx_extra_q', label: 'mdx_extra_q (Quantized)' },
  { value: 'SIG', label: 'SIG' },
  { value: 'bs_roformer', label: 'BS-Roformer (6-stem, higher SDR)' },
];

export function uploadFile({ file, model, recover, recoveryModel }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', model);
  formData.append('recover', String(recover));
  formData.append('recovery_model', recoveryModel);
  return axios.post(`${API_BASE}/upload`, formData);
}

export function youtubeInfo(url) {
  return axios.post(`${API_BASE}/youtube/info`, new URLSearchParams({ url }));
}

export function youtubeDownload({ url, model, recover, recoveryModel }) {
  return axios.post(
    `${API_BASE}/youtube/download`,
    new URLSearchParams({
      url,
      model,
      recover: String(recover),
      recovery_model: recoveryModel,
    })
  );
}

export function youtubeConfirm(taskId) {
  return axios.post(`${API_BASE}/youtube/confirm/${taskId}`);
}

export function getStatus(taskId) {
  return axios.get(`${API_BASE}/status/${taskId}`);
}

// Task state lives in the backend's memory, so a restart forgets every task
// and /status answers 404 from then on — polling can never recover from that.
export function isTaskGone(err) {
  return err?.response?.status === 404;
}

export function getResult(taskId) {
  return axios.get(`${API_BASE}/result/${taskId}`);
}

export function youtubePreviewUrl(taskId) {
  return `${API_BASE}/youtube/preview/${taskId}`;
}

export function trackUrl(taskId, trackName, variant = 'original') {
  return `${API_BASE}/download/${taskId}/${trackName}?variant=${variant}`;
}

export function spectrogramUrl(taskId, trackName, variant = 'original') {
  return `${API_BASE}/spectrogram/${taskId}/${trackName}?variant=${variant}`;
}
