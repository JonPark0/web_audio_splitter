"""
Standalone Apollo inference wrapper.

Vendors JusperLee/Apollo (https://github.com/JusperLee/Apollo), cloned into
/app/apollo at Docker build time (see backend/Dockerfile), and runs it as a
*subprocess* so the FastAPI process never has to import `look2hear` (and its
pinned pytorch-lightning / hydra stack) directly.

The upstream demo `inference.py` calls:

    model = look2hear.models.BaseModel.from_pretrain(
        "JusperLee/Apollo", sr=44100, win=20, feature_dim=256, layer=6
    ).cuda()

which reads as if "JusperLee/Apollo" were a Hugging Face repo id. It isn't:
`BaseModel.from_pretrain(path, ...)` (look2hear/models/base_model.py) does
`torch.load(path, ...)` directly on its first argument and expects a dict
with "model_name" and "state_dict" keys — i.e. it wants an already-downloaded
*local checkpoint file*, not a repo id. Running the demo verbatim fails with
`FileNotFoundError: 'JusperLee/Apollo'` (confirmed by actually building this
image and hitting that exact error). So this wrapper does the missing step
explicitly: `huggingface_hub.hf_hub_download(repo_id, filename)` first, then
passes the resulting local path to `from_pretrain`.

Also, unlike the demo:
  - `.cuda()` is replaced with `.to(device)` / `--device` so this can run on
    CPU, which is this project's default.
  - Long stems (minutes, not the demo's ~1s clip) are processed in
    overlapping chunks with a linear crossfade to bound memory use.
  - All of a job's stems are restored in one process, loading the model
    once (see infer_cli.py).

The look2hear/ package is vendored inside the Apollo repo itself (confirmed
via the repo's file tree) — no separate `look2hear` package to install.
"""
import sys

import numpy as np
import soundfile as sf
import torch

import infer_cli

# Apollo (and the look2hear package vendored inside it) is cloned to
# /app/apollo at Docker build time (see backend/Dockerfile) and put on
# PYTHONPATH there; this sys.path entry mirrors that so the script also
# works when run outside the container during development.
sys.path.insert(0, "/app/apollo")

import look2hear.models  # noqa: E402

SAMPLE_RATE = 44100
CHUNK_SECONDS = 10
OVERLAP_SECONDS = 1
DEFAULT_REPO_ID = "JusperLee/Apollo"
DEFAULT_CKPT_FILENAME = "pytorch_model.bin"


def build_model(repo_id: str, ckpt_filename: str, device: str) -> torch.nn.Module:
    from huggingface_hub import hf_hub_download

    # Resolves from the local HF cache if already downloaded (warmed at
    # Docker build time, see backend/Dockerfile); otherwise downloads once.
    ckpt_path = hf_hub_download(repo_id=repo_id, filename=ckpt_filename)

    # Hyperparameters match the config Apollo's own inference.py loads with:
    # 44.1kHz, 20ms window, 256-dim features, 6 layers.
    model = look2hear.models.BaseModel.from_pretrain(
        ckpt_path, sr=SAMPLE_RATE, win=20, feature_dim=256, layer=6
    )
    model.to(device)
    model.eval()
    return model


def _run_chunk(model: torch.nn.Module, piece: np.ndarray, device: str) -> np.ndarray:
    """piece: (channels, samples). The model expects a batch dim, matching
    upstream's `audio.unsqueeze(0)` — feeding it 2D would fail at the
    forward call."""
    with torch.no_grad():
        tensor = torch.from_numpy(piece).float().unsqueeze(0).to(device)  # (1, C, T)
        restored = model(tensor)
        return restored.squeeze(0).cpu().numpy()


def restore(model: torch.nn.Module, audio: np.ndarray, sr: int, device: str) -> np.ndarray:
    """audio: (channels, samples) float32 array."""
    if sr != SAMPLE_RATE:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE, axis=-1)

    if audio.ndim == 1:
        audio = audio[None, :]

    total_len = audio.shape[-1]
    chunk = CHUNK_SECONDS * SAMPLE_RATE
    overlap = OVERLAP_SECONDS * SAMPLE_RATE

    if total_len <= chunk:
        return _run_chunk(model, audio, device)

    out = np.zeros_like(audio)
    weight = np.zeros(total_len, dtype=np.float64)
    fade = np.linspace(0.0, 1.0, overlap)

    start = 0
    while start < total_len:
        end = min(start + chunk, total_len)
        restored = _run_chunk(model, audio[:, start:end], device)

        seg_len = end - start
        w = np.ones(seg_len, dtype=np.float64)
        if start > 0:
            w[: min(overlap, seg_len)] = fade[: min(overlap, seg_len)]
        if end < total_len:
            w[-min(overlap, seg_len):] = fade[::-1][: min(overlap, seg_len)]

        out[:, start:end] += restored * w
        weight[start:end] += w
        start += chunk - overlap

    weight[weight == 0] = 1.0
    return out / weight


def main():
    parser = infer_cli.build_parser("Restore audio stems with Apollo (model loaded once for all stems).")
    parser.add_argument("--repo_id", default=DEFAULT_REPO_ID)
    parser.add_argument("--ckpt_filename", default=DEFAULT_CKPT_FILENAME)
    args = parser.parse_args()

    device = args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu"
    model = build_model(args.repo_id, args.ckpt_filename, device)

    def restore_one(in_wav: str, out_wav: str) -> None:
        audio, sr = sf.read(in_wav, always_2d=False, dtype="float32")
        audio = audio.T if audio.ndim == 2 else audio  # soundfile gives (T, C); model wants (C, T)
        restored = restore(model, audio, sr, device)
        out = restored.T if restored.ndim == 2 else restored  # back to (T, C) for soundfile
        sf.write(out_wav, out, SAMPLE_RATE)

    infer_cli.run_batch(args.in_wav, args.out_wav, restore_one)


if __name__ == "__main__":
    main()
