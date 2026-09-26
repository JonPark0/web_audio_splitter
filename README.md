# AI Audio Splitter (Demucs + Recovery)

**Language:** English | [한국어](README_ko.md)

A web application to separate audio files into individual tracks (Vocals, Drums, Bass, and Other) using the Meta Demucs AI model — with an optional **frequency recovery** stage to restore mid/high-frequency detail that lossy sources and separation itself tend to smear or attenuate.

## Features
- **Easy Upload:** Drag and drop or select your audio file, or paste a YouTube URL.
- **AI Powered Separation:** Uses Meta's `htdemucs` model (and several alternatives, including BS-Roformer) for high-quality separation.
- **Split & Recover:** Opt-in per job — after separation, each stem can be run through a restoration model:
  - **Apollo** — band-sequence restoration purpose-built for lossy/compressed music. Fast enough for CPU.
  - **AudioSR** — general any→48kHz super-resolution. More powerful, diffusion-based, GPU recommended, but slow (~15-35s/stem on a 15s clip plus ~30s model load per job, measured on an RTX 4070 SUPER at default settings).
  - **FlashSR** — single-step diffusion-distilled, much faster than AudioSR. Unproven on music specifically and has no stated license — offered as an option, not a default.
  - Original stems are always kept, so you can A/B compare original vs. recovered per track.
- **Advanced Mixer:**
  - Visualized waveforms for each track.
  - Synchronized playback and seeking.
  - Per-track volume, mute, and solo controls.
  - Per-track spectrogram view to see the recovered high-frequency content, not just hear it.
  - Export/Download each track separately (original or recovered).
- **Staged Progress:** Real progress through Separating → Restoring, not just a spinner.
- **GPU Support:** Optional NVIDIA GPU acceleration via Docker.

## Quick Start

### 1. Prerequisites
- [Docker](https://www.docker.com/products/docker-desktop/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.

### 2. Configuration
Create(`cp .env.example .env`) or edit the `.env` file in the root directory:
```env
USE_GPU=false
DEMUCS_SHIFTS=0
AUDIOSR_DDIM_STEPS=50
AUDIOSR_GUIDANCE_SCALE=3.5
AUDIOSR_MODEL_NAME=basic
```
- `DEMUCS_SHIFTS`: Controls separation quality (higher values = better quality but slower processing):
  - `0`: Default, fastest (recommended for CPU)
  - `1-5`: Higher quality, slower processing (recommended for GPU)
- `AUDIOSR_DDIM_STEPS` / `AUDIOSR_GUIDANCE_SCALE` / `AUDIOSR_MODEL_NAME`: Only apply when the AudioSR recovery model is selected in the UI; see [Recovery Models](#recovery-models) below.

> **First build note:** the backend image now clones [JusperLee/Apollo](https://github.com/JusperLee/Apollo) and prefetches its checkpoint at build time, so `docker compose ... up --build` will take noticeably longer and produce a larger image the first time.

### 3. Run the Application
Open your terminal in the project folder and run the appropriate compose file for your environment:

**CPU only (default):**
```bash
docker compose -f docker-compose.cpu.yml up --build
```

**GPU (NVIDIA):**
Requires [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on your host. Set `USE_GPU=true` in your `.env` file.
```bash
docker compose -f docker-compose.gpu.yml up --build
```

### 4. Access the UI
Once the build is complete:
- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:8000](http://localhost:8000)

## How to Use
1. **Upload:** Select an audio file (or paste a YouTube URL) on the main page. Optionally enable "Restore missing frequencies" and pick a recovery model.
2. **Process:** Wait for the AI to process the file — the progress bar shows Separating, then Restoring if recovery is on.
3. **Result:** Use the play button to listen to all tracks. Adjust volumes, mute/solo individual stems, toggle Original vs. Recovered per track, view each stem's spectrogram, and download the tracks you want.

## Separation Models

Alongside the full Demucs family, **BS-Roformer** ([openmirlab/bs-roformer-infer](https://github.com/openmirlab/bs-roformer-infer)) is available as a higher-quality alternative — it benchmarks meaningfully better than htdemucs (~11.99 dB SDR vs. ~9.00 dB) and won the Sound Demixing Challenge 2023. It produces the same 6-stem set as `htdemucs_6s` (vocals/drums/bass/guitar/piano/other), plus a bonus `*_instrumental.wav`.

## Recovery Models

There is no single production-ready model that both separates *and* restores audio — this app runs a two-stage pipeline: a separation model splits the stems, then (if enabled) a restoration model recovers frequency detail per stem.

| Model | Approach | Speed | Best for |
|-------|----------|-------|----------|
| **Apollo** (default) | Band-sequence modeling ([JusperLee/Apollo](https://github.com/JusperLee/Apollo)) | Fast, CPU-tolerable | Lossy/compressed sources (MP3, YouTube) — the most common cause of "missing" highs in split stems |
| **AudioSR** | Diffusion-based any→48kHz super-resolution, 10-50 iterative DDIM steps ([haoheliu/versatile_audio_super_resolution](https://github.com/haoheliu/versatile_audio_super_resolution)) | Slow (~15-35s/stem on a 15s clip plus ~30s model load per job, measured on an RTX 4070 SUPER at default settings), GPU recommended | General bandwidth extension when a hard sample-rate/frequency ceiling is the issue |
| **FlashSR** | Single-step diffusion-distilled any→48kHz ([jakeoneijk/FlashSR_Inference](https://github.com/jakeoneijk/FlashSR_Inference)) | Fast — one forward pass per window instead of AudioSR's iterative loop | When AudioSR-style bandwidth extension is wanted but AudioSR's speed isn't acceptable |

Recovery is **opt-in per job** and keeps the original stems, so you can always compare.

> **Notes:**
> - AudioSR downmixes its output to mono, even for stereo input stems — a constraint of the upstream tool, not this integration. Apollo and FlashSR preserve the original channel count.
> - **FlashSR has no stated license** in its repository. It's offered as an option so you can evaluate it, but verify licensing terms yourself before relying on it beyond experimentation. Its architecture lineage (HierSpeech++) is speech-oriented, so its quality on music specifically hasn't been independently verified here either.

### Investigated but not included

A few models came up in research (via Gemini and independently) that looked promising on paper but had no usable public release at the time of writing — **AudioLBM** (NeurIPS 2025, Latent Bridge Models) and **SAGA-SR** (KAIST) for recovery, and a music-specific **"BigWavGAN"** paper (distinct from NVIDIA's BigVGAN vocoder, which is a different tool entirely and not applicable to this pipeline). Worth revisiting if/when their authors publish code.

## Technology Stack

### Backend
- **Python 3.11** - Core programming language
- **FastAPI** - Modern web framework for building APIs
- **Demucs** - Meta's state-of-the-art music source separation AI model
- **BS-Roformer** - Alternative separation model, higher SDR than Demucs
- **Apollo** - Band-sequence audio restoration for lossy/compressed music
- **AudioSR** - Versatile any→48kHz audio super-resolution
- **FlashSR** - Single-step distilled any→48kHz audio super-resolution
- **PyTorch** - Deep learning framework (CPU/GPU support)
- **Uvicorn** - ASGI server

### Frontend
- **React 18** - UI framework
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** - Utility-first styling / design system
- **WaveSurfer.js** - Audio waveform visualization
- **Axios** - HTTP client for API requests
- **React Icons** - Icon library

### Infrastructure
- **Docker & Docker Compose** - Containerization and orchestration
- **NVIDIA Container Toolkit** - GPU acceleration support (optional)

## Project Structure
```
web_audio_splitter/
├── backend/
│   ├── main.py              # FastAPI application entry point (pipeline + endpoints)
│   ├── separate.py          # Separation dispatch (Demucs family / BS-Roformer)
│   ├── restore.py           # Recovery dispatch (Apollo / AudioSR / FlashSR)
│   ├── apollo_infer.py      # Standalone Apollo inference wrapper (chunked, CPU/GPU)
│   ├── flashsr_infer.py     # Standalone FlashSR inference wrapper (chunked, CPU/GPU)
│   ├── audiosr_infer.py     # Standalone AudioSR inference wrapper
│   ├── infer_cli.py         # Shared batch/progress plumbing for the wrappers (model loaded once per job)
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Backend container configuration (vendors Apollo + FlashSR)
│   └── media/               # Uploaded, separated, recovered audio + cached spectrograms
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Top-level shell / step router
│   │   ├── api.js           # Centralized backend API calls
│   │   ├── components/      # UploadScreen, Mixer, TrackRow, ProgressStages, etc.
│   │   └── main.jsx         # Application entry point
│   ├── tailwind.config.js   # Design tokens (colors, shadows, animation)
│   ├── package.json         # Node.js dependencies
│   ├── vite.config.js       # Vite configuration
│   └── Dockerfile           # Frontend container configuration
├── docker-compose.cpu.yml   # Docker Compose for CPU environment
├── docker-compose.gpu.yml   # Docker Compose for GPU environment (NVIDIA)
├── .env.example             # Environment variables template
└── README.md                # This file
```

## Advanced Configuration

### Processing Quality vs Speed
The `DEMUCS_SHIFTS` parameter controls the number of random shifts used during separation:
- **0 shifts (default)**: Fastest processing, good quality
- **1-5 shifts**: Progressively better quality, but significantly slower
- **Recommendation**: Use 0 for CPU, 1-2 for GPU

### GPU Acceleration
To enable GPU acceleration:
1. Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
2. Set `USE_GPU=true` in [.env](.env)
3. Run with the GPU compose file: `docker compose -f docker-compose.gpu.yml up --build`

### Supported Audio Formats
- MP3, WAV, FLAC, OGG, M4A, WMA
- Maximum file size: Limited by available disk space
- Recommended: High-quality source files for best separation results

## Troubleshooting

### Common Issues

**Issue: "Docker daemon not running"**
- Solution: Start Docker Desktop or Docker service on your system

**Issue: "Port 3000 or 8000 already in use"**
- Solution: Stop other applications using these ports or modify ports in your docker-compose file
- Change `"3000:3000"` to `"3001:3000"` for frontend
- Change `"8000:8000"` to `"8001:8000"` for backend

**Issue: "Out of memory during processing"**
- Solution: Close other applications or use a shorter audio file
- For CPU: Reduce `DEMUCS_SHIFTS` to 0
- For GPU: Monitor GPU memory usage

**Issue: "GPU not detected"**
- Solution: Verify NVIDIA drivers and Container Toolkit installation
- Check: `docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi`

**Issue: "Separation quality is poor"**
- Solution:
  - Use high-quality source audio (320kbps MP3 or lossless formats)
  - Increase `DEMUCS_SHIFTS` if using GPU
  - Try different Demucs models, or BS-Roformer, from the model selector

**Issue: recovery hangs for minutes then fails with a Hugging Face 401/429/"cannot find the requested files in the local cache" error**
- Cause: the `demucs_cache` Docker volume (mounted at `/root/.cache`, holding Apollo/AudioSR/FlashSR/BS-Roformer's downloaded checkpoints) is a **named volume** — Docker only seeds it from the image once, the first time it's created. If that volume already existed from before a model was added to the image (e.g. you built once, then pulled a newer version of this project with a new model), the container keeps using the old, incomplete volume instead of the new image's baked-in cache, and falls back to a slow/rate-limited runtime download instead of using the pre-warmed one.
- Solution: `docker compose rm -sf backend && docker volume rm web_audio_splitter_demucs_cache` (adjust the volume name to your project folder's prefix if different), then `docker compose up -d backend` to let it reseed fresh from the current image.

### Performance Tips
- **CPU Processing**: Expect 2-5 minutes for a 3-minute song
- **GPU Processing**: Expect 30-90 seconds for a 3-minute song
- First run downloads the Demucs model (approximately 2GB), subsequent runs are faster

## Development

### Local Development (Without Docker)

#### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `USE_GPU` | `false` | Enable NVIDIA GPU acceleration (also selects the recovery stage's device) |
| `DEMUCS_SHIFTS` | `0` | Number of random shifts for separation quality |
| `AUDIOSR_DDIM_STEPS` | `50` | AudioSR sampling steps (higher = slower, generally better) |
| `AUDIOSR_GUIDANCE_SCALE` | `3.5` | AudioSR guidance scale |
| `AUDIOSR_MODEL_NAME` | `basic` | AudioSR model variant: `basic` (music/general) or `speech` |

### API Endpoints
- `POST /upload` - Upload an audio file (`file`, `model`, `recover`, `recovery_model`) → `{task_id}`
- `POST /youtube/info` - Validate a YouTube URL and return metadata
- `POST /youtube/download` - Start a background YouTube download (`url`, `model`, `recover`, `recovery_model`) → `{task_id}`
- `POST /youtube/confirm/{task_id}` - Confirm the downloaded audio and start processing
- `GET /youtube/preview/{task_id}` - Preview the downloaded YouTube audio
- `GET /status/{task_id}` - Poll job status, including `step` (`separating`/`restoring`) and progress
- `GET /result/{task_id}` - List available tracks and recovered variants
- `GET /download/{task_id}/{track_name}?variant=original|recovered` - Download a stem
- `GET /spectrogram/{task_id}/{track_name}?variant=original|recovered` - Rendered (and cached) spectrogram PNG

## Credits

### Open Source Libraries
- [Meta Demucs](https://github.com/facebookresearch/demucs) - Music source separation AI model
- [BS-Roformer](https://github.com/openmirlab/bs-roformer-infer) - Alternative separation model, higher SDR
- [Apollo](https://github.com/JusperLee/Apollo) - Band-sequence audio restoration
- [AudioSR](https://github.com/haoheliu/versatile_audio_super_resolution) - Versatile audio super-resolution
- [FlashSR](https://github.com/jakeoneijk/FlashSR_Inference) - Single-step distilled audio super-resolution (no stated license — see note above)
- [FastAPI](https://fastapi.tiangolo.com/) - Backend framework
- [React](https://react.dev/) - Frontend framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [WaveSurfer.js](https://wavesurfer-js.org/) - Audio visualization

## License
This project is for educational and personal use. Please respect the licenses of the underlying technologies:
- Demucs and BS-Roformer (`bs-roformer-infer`) are released under the MIT license
- FlashSR has **no stated license** — verify acceptable use yourself before relying on it beyond experimentation
- Commercial use of separated audio may require permission from original copyright holders

## Contributing
Contributions are welcome! Please feel free to submit issues or pull requests.

## Support
If you encounter any problems or have questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review existing [GitHub Issues](../../issues)
3. Create a new issue with detailed information about your problem