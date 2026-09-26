"""
Standalone FlashSR inference wrapper.

Vendors jakeoneijk/FlashSR_Inference (https://github.com/jakeoneijk/FlashSR_Inference),
cloned into /app/flashsr at Docker build time (see backend/Dockerfile), and
runs it as a *subprocess* — same isolation rationale as apollo_infer.py.

Written against a confirmed real usage example (a community fork's
Example.py, since the official README's own snippet omits some details):

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    flashsr = FlashSR(student_ldm_ckpt, sr_vocoder_ckpt, vae_ckpt).to(device)
    audio, sr = UtilAudio.read(path, sample_rate=48000)     # [channels, time]
    audio = UtilData.fix_length(audio, 245760).to(device)   # exactly 5.12s
    pred_hr_audio = flashsr(audio, lowpass_input=False)

Two things this wrapper does differently from that example, both necessary
for real (multi-minute) stems rather than a single 5.12s clip:
  - FlashSR's window is a hard model constraint, not a preference (unlike
    Apollo's 10s chunk size, which was just a memory/compute choice) — every
    call must be exactly WINDOW_SAMPLES long. Shorter chunks (including the
    final one) are zero-padded up to that length, then trimmed back down
    after inference, before overlap-add.
  - Long audio is processed in overlapping WINDOW_SAMPLES-sized chunks with
    a linear crossfade, mirroring apollo_infer.py's approach.
  - All of a job's stems are restored in one process, loading the model
    once (see infer_cli.py).
  - Note also the input has NO batch dimension ([channels, time], not
    [1, channels, time] like Apollo) — confirmed from the real example, not
    guessed.

NOTE: the `FlashSR(...)` constructor signature and padding convention were
inferred from a community example, then verified by an end-to-end run of
the built image (BS-Roformer + FlashSR on GPU, all stems restored).
"""
import sys

import numpy as np
import soundfile as sf
import torch

import infer_cli

# FlashSR is cloned to /app/flashsr at Docker build time (see
# backend/Dockerfile) and put on PYTHONPATH there; this sys.path entry
# mirrors that so the script also works when run outside the container.
sys.path.insert(0, "/app/flashsr")

from FlashSR.FlashSR import FlashSR  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

SAMPLE_RATE = 48000
WINDOW_SAMPLES = 245760  # fixed 5.12s window FlashSR requires per call
OVERLAP_SAMPLES = 24576  # ~0.5s crossfade between windows
DEFAULT_REPO_ID = "jakeoneijk/FlashSR_weights"


def build_model(repo_id: str, device: str):
    # This is a Hugging Face *dataset* repo (huggingface.co/datasets/...),
    # not a model repo — hf_hub_download defaults to repo_type="model" and
    # 401s ("Repository Not Found") without this, confirmed by an actual
    # failed build.
    student_ldm = hf_hub_download(repo_id=repo_id, filename="student_ldm.pth", repo_type="dataset")
    sr_vocoder = hf_hub_download(repo_id=repo_id, filename="sr_vocoder.pth", repo_type="dataset")
    vae = hf_hub_download(repo_id=repo_id, filename="vae.pth", repo_type="dataset")

    model = FlashSR(student_ldm, sr_vocoder, vae)
    model.to(device)
    if hasattr(model, "eval"):
        model.eval()
    return model


def _run_window(model, chunk: np.ndarray, device: str) -> np.ndarray:
    """chunk: (channels, WINDOW_SAMPLES) exactly — no batch dimension."""
    with torch.no_grad():
        tensor = torch.from_numpy(chunk).float().to(device)
        restored = model(tensor, lowpass_input=False)
        return restored.cpu().numpy()


def restore(model, audio: np.ndarray, sr: int, device: str) -> np.ndarray:
    """audio: (channels, samples) float32 array."""
    if sr != SAMPLE_RATE:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE, axis=-1)

    if audio.ndim == 1:
        audio = audio[None, :]

    channels, total_len = audio.shape
    out = np.zeros_like(audio)
    weight = np.zeros(total_len, dtype=np.float64)
    fade = np.linspace(0.0, 1.0, OVERLAP_SAMPLES)

    start = 0
    while start < total_len:
        end = min(start + WINDOW_SAMPLES, total_len)
        seg_len = end - start

        piece = audio[:, start:end]
        if seg_len < WINDOW_SAMPLES:
            pad = np.zeros((channels, WINDOW_SAMPLES - seg_len), dtype=audio.dtype)
            piece = np.concatenate([piece, pad], axis=-1)

        restored = _run_window(model, piece, device)[:, :seg_len]  # trim padding back off

        w = np.ones(seg_len, dtype=np.float64)
        if start > 0:
            w[: min(OVERLAP_SAMPLES, seg_len)] = fade[: min(OVERLAP_SAMPLES, seg_len)]
        if end < total_len:
            w[-min(OVERLAP_SAMPLES, seg_len):] = fade[::-1][: min(OVERLAP_SAMPLES, seg_len)]

        out[:, start:end] += restored * w
        weight[start:end] += w
        start += WINDOW_SAMPLES - OVERLAP_SAMPLES

    weight[weight == 0] = 1.0
    return out / weight


def main():
    parser = infer_cli.build_parser("Restore audio stems with FlashSR (model loaded once for all stems).")
    parser.add_argument("--repo_id", default=DEFAULT_REPO_ID)
    args = parser.parse_args()

    device = args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu"
    model = build_model(args.repo_id, device)

    def restore_one(in_wav: str, out_wav: str) -> None:
        audio, sr = sf.read(in_wav, always_2d=False, dtype="float32")
        audio = audio.T if audio.ndim == 2 else audio  # soundfile gives (T, C); model wants (C, T)
        restored = restore(model, audio, sr, device)
        out = restored.T if restored.ndim == 2 else restored
        sf.write(out_wav, out, SAMPLE_RATE)

    infer_cli.run_batch(args.in_wav, args.out_wav, restore_one)


if __name__ == "__main__":
    main()
