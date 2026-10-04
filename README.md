# AI Audio Splitter (Demucs + Recovery)

**Language:** English | [한국어](README_ko.md)

A web application to separate audio files into individual tracks (Vocals, Drums, Bass, and Other) using the Meta Demucs AI model — with an optional **frequency recovery** stage to restore mid/high-frequency detail that lossy sources and separation itself tend to smear or attenuate.

## Features
- **Easy Upload:** Drop or pick one or several audio (or video) files anywhere on the page — with byte progress and Cancel — or paste a YouTube URL (split automatically after the download, or review it first).
- **Job Queue:** Jobs run one at a time (two separations on one GPU tend to run out of memory) and the Split page lists them live: queue position, stage, elapsed/remaining time, search, status filter, Cancel, Retry and Delete. Every place in the app has its own URL, so refresh, Back and bookmarks keep it.
- **AI Powered Separation:** Uses Meta's `htdemucs` model (and several alternatives, including BS-Roformer) for high-quality separation.
- **Split & Recover:** Opt-in per job — after separation, each stem can be run through a restoration model:
  - **Apollo** — band-sequence restoration purpose-built for lossy/compressed music. Fast enough for CPU.
  - **AudioSR** — general any→48kHz super-resolution. More powerful, diffusion-based, GPU recommended, but slow (~15-35s/stem on a 15s clip plus ~30s model load per job, measured on an RTX 4070 SUPER at default settings).
  - **FlashSR** — single-step diffusion-distilled, much faster than AudioSR. Unproven on music specifically and has no stated license — offered as an option, not a default.
  - Original stems are always kept, so you can A/B compare original vs. recovered per track.
- **Stem Mixer:**
  - Opens instantly: waveforms come from precomputed peaks and the audio streams in short chunks (a 6-minute, 7-stem job used to download ~1 GB before it could play).
  - Sample-aligned playback on one audio clock — seeking and switching Original/Recovered never drift a stem.
  - Per-stem dB fader, mute and solo; derived stems (BS-Roformer's instrumental) start muted so instruments aren't doubled.
  - Spectrogram inside the row on the same time axis; zoom with −/+/Fit, Ctrl+wheel or pinch.
  - Download each stem, or all stems as one zip (original or recovered).
- **Staged Progress:** Real progress through Separating → Restoring, not just a spinner.
- **Sample Extraction:** Select a region on any stem (or on the mix of the stems you hear) and save it as a sample, cut sample-accurately on the server. Exact start/end fields, nudge keys, snap to zero crossings, transients or whole beats, fades, normalize, reverse, and output format (16/24/32-bit float, 44.1/48 kHz, mono).
- **Sample Library:** A dense, keyboard-driven list (↑/↓ to audition, Space, Enter, Del) with waveform thumbnails, multi-tag/key/BPM filters kept in the URL, an inspector for editing, bulk tag/re-analyze/zip download/delete, multi-file import, Camelot keys, and preview at the project tempo. BPM and key are detected automatically (tempo to within ~0.03 %); correct the BPM (×2 / ÷2, direct entry, tap tempo, fit to bars) or override the key.
- **Job History:** Jobs are stored in PostgreSQL, so past results can be reopened after a restart. Any finished job can be **retried** with another separation model or recovery setting (a new job from the same source audio; the original is kept) or **deleted** together with its files.
- **Arrangement View:** Ableton-style tracks on a bar/beat timeline — drag samples onto tracks, move/duplicate clips with snapping, trim either edge, **clip loop** (repeat the trimmed region to any length), fades, reverse, pitch (±24 semitones + cents), copy/paste, split at playhead, rubber-band selection, overlapping clips truncated like Ableton, track reorder, markers, time signature, master gain and peak meters, metronome, undo/redo, and **Export WAV** (whole song, loop region, or one WAV per track). Projects autosave to PostgreSQL; a save from another tab is detected (no silent overwrite), failed saves retry, and unsaved edits survive closing the tab.
- **BPM Sync:** Warped clips follow the project tempo. Changing the BPM time-stretches them server-side (Rubber Band, pitch preserved) and caches the result; until a render arrives the clip plays sped up/down so the change is heard immediately.
- **Mobile:** Every screen works on a phone — compact rows, a fixed bottom transport/CTA bar, bottom sheets, ≥44 px touch targets, pinch-zoom, and long-press to drag clips (a swipe scrolls).
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
POSTGRES_USER=splitter
POSTGRES_PASSWORD=splitter
POSTGRES_DB=splitter
```
- `DEMUCS_SHIFTS`: Controls separation quality (higher values = better quality but slower processing):
  - `0`: Default, fastest (recommended for CPU)
  - `1-5`: Higher quality, slower processing (recommended for GPU)
- `AUDIOSR_DDIM_STEPS` / `AUDIOSR_GUIDANCE_SCALE` / `AUDIOSR_MODEL_NAME`: Only apply when the AudioSR recovery model is selected in the UI; see [Recovery Models](#recovery-models) below.
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`: Credentials for the bundled PostgreSQL 18 service (`db`). It is only reachable inside the compose network unless you publish its port. Schema migrations run automatically when the backend starts.

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
1. **Split:** On the **Split** page, drop audio files (or paste a YouTube URL), pick a model (BS-Roformer for the best quality, htdemucs for speed) and optionally **Restore**. Jobs queue on the right with live progress; open one to follow it.
2. **Result:** Space plays/pauses. Adjust each stem's fader, mute/solo, switch Original/Recovered per stem or for all, open a stem's spectrogram, and download stems or the whole set as a zip.
3. **Extract samples:** Click **Extract** on a stem and drag across its waveform (on a phone: Set start / Set end at the playhead). Refine with the start/end fields, ←/→ (Shift = 10 ms, Alt = 1 beat) and Snap; **Loop** the selection to check it. **Save** keeps the stem's current Original/Recovered choice; **Save mix** sums the stems you hear at their current levels. Zoom with −/+/Fit, Ctrl/⌘+wheel, Z (to selection) or pinch.
4. **Library:** Browse with ↑/↓ (auditions with Auto on), Space, L (loop); edit name/tags/BPM/key in the inspector; check rows for bulk actions; **Sync** previews at the project tempo; **Add to Arrange** drops a sample into the last project.
5. **Arrange:** Create a project, set its BPM and drag samples from the browser onto tracks (on a phone: tap a sample, then a lane). Clips with a known BPM are warped to the project tempo; turn on **Loop** in the clip inspector and drag the right edge to repeat a region. Export the song, the loop region or stems from the toolbar.

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
- **PostgreSQL 18** - Job history and sample library
- **SQLAlchemy + Alembic** - ORM and schema migrations
- **librosa** - Sample tempo and key estimation
- **pedalboard (Rubber Band)** - Time-stretch / pitch-shift for BPM sync

### Frontend
- **React 18** - UI framework
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** - Utility-first styling / design system
- **Palnarium design system** - Monochrome tokens (ink/muted/paper/line/wash), Exo 2 + Pretendard (Hangul) at one weight, bare-text controls
- **Web Audio API** - Stem mixer streaming engine (chunked WAV over Range requests, one clock for all stems) and the arrangement engine
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
│   ├── samples.py           # Sample library endpoints (extract / mix / import / list / edit / render)
│   ├── analysis.py          # BPM + key estimation for samples and songs
│   ├── jobs.py              # Job queue (one at a time by default) with cancellation
│   ├── peaks.py             # Waveform peaks (cached JSON) for instant mixers and thumbnails
│   ├── songs.py             # Song-level BPM/key, analysed after separation
│   ├── db.py / models.py    # SQLAlchemy engine/session and ORM models
│   ├── task_store.py        # Job persistence (replaces the old in-memory dict)
│   ├── storage.py           # media/ layout and path helpers
│   ├── migrations/          # Alembic migrations (applied on startup)
│   ├── requirements-app.txt # App-level deps (DB), installed in a late Docker layer
│   ├── projects.py          # Arrangement projects API (whole-document save)
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Backend container configuration (vendors Apollo + FlashSR)
│   └── media/               # Uploaded, separated, recovered audio + cached spectrograms
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Shell: header, routes, error boundary
│   │   ├── router.js        # Hash routes (#/split, #/split/job/<id>, #/library?…, #/arrange/<id>)
│   │   ├── api.js           # Centralized backend API calls
│   │   ├── arrange/         # Arrangement: data model + timing (project.js), Web Audio engine (engine.js), UI (ui/)
│   │   ├── components/      # Split home + jobs (jobs/), shell (shell/), stem mixer + extract (result/), library (library/)
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
- Anything ffmpeg reads: MP3, WAV, FLAC, OGG, M4A, AIFF, WMA… and video files (the audio track is used)
- Uploads up to `MAX_UPLOAD_MB` (1 GB by default) and 30 minutes; library imports up to 10 minutes
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

**Issue: resetting the database**
- Jobs and the sample library's metadata live in the `pgdata` Docker volume (sample audio itself is under `backend/media/samples/`).
- To start over: `docker compose -f docker-compose.gpu.yml down && docker volume rm web_audio_splitter_pgdata` (adjust the prefix to your project folder), then bring the stack up again — migrations recreate the schema.
- **Careful:** `docker compose down` keeps your data; `docker compose down -v` also deletes the named volumes — the database (`pgdata`) and the downloaded model cache (`demucs_cache`).

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
pip install -r requirements-app.txt
# Point at a running PostgreSQL 18 and create the schema
export DATABASE_URL=postgresql+psycopg://splitter:splitter@localhost:5432/splitter
alembic upgrade head
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
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `splitter` | Credentials for the `db` service |
| `DATABASE_URL` | built from the above | Backend connection string (set by compose; set it yourself when running without Docker) |
| `MEDIA_RETENTION_DAYS` | `0` | Delete jobs (uploads, stems, spectrograms) older than N days; library samples are separate copies and are kept. `0` = keep everything |
| `MAX_CONCURRENT_JOBS` | `1` | Separation jobs run at once; the rest queue (raise only with spare VRAM/CPU) |
| `MAX_UPLOAD_MB` | `1024` | Largest accepted upload |
| `RENDER_CACHE_MB` | `4096` | Disk cap for cached time-stretch/pitch renders (least recently used evicted) |

### API Endpoints
- `POST /upload` - Upload an audio/video file (`file`, `model`, `recover`, `recovery_model`) → `{task_id}`; `400` not audio / too long, `413` too large
- `POST /youtube/info` - Validate a YouTube URL and return metadata (playlists and live streams are refused)
- `POST /youtube/download` - Start a background YouTube download (`url`, `model`, `recover`, `recovery_model`, `auto_split`) → `{task_id}`; `/status` reports `download_percent`
- `POST /youtube/confirm/{task_id}` - Confirm the downloaded audio and start processing
- `GET /youtube/preview/{task_id}` - Preview the downloaded YouTube audio
- `GET /status/{task_id}` - Poll job status: `step` (`separating`/`restoring`), queue position, timestamps, progress
- `GET /result/{task_id}` - Tracks, recovered variants, `derived_tracks`, song BPM/key and duration
- `GET /download/{task_id}/{track_name}?variant=original|recovered` - Download/stream a stem (Range requests)
- `GET /peaks/{task_id}/{track_name}?variant=&resolution=` - Waveform peaks (points per second, cached)
- `GET /onsets/{task_id}/{track_name}?variant=` - Transient times (for snapping)
- `GET /spectrogram/{task_id}/{track_name}?variant=original|recovered` - Rendered (and cached) spectrogram PNG
- `GET /tasks/{task_id}/stems.zip?variant=` - Every stem of a job as one zip (streamed)
- `GET /tasks?limit=&before=&q=&status=` - Jobs, newest first, with `in_flight` (page back with `before`)
- `POST /tasks/{task_id}/retry` - Re-run a job's source audio with other settings (JSON: `model`, `recover`, `recovery_model`) → `{task_id}` of the new job
- `POST /tasks/{task_id}/cancel` - Cancel a queued or running job
- `DELETE /tasks/{task_id}` - Delete a job and its files (`409` while running)
- `POST /samples` - Extract a sample from a stem (JSON: `task_id`, `track`, `variant`, `start_sec`, `end_sec`, `name?`, `tags?`, plus `snap_to_zero`, `fade_in_ms`, `fade_out_ms`, `normalize`, `reverse`, `bit_depth`, `sample_rate`, `mono`)
- `POST /samples/mix` - Same, from several stems summed with per-stem gains (`stems: [{track, variant, gain}]`)
- `POST /samples/import` - Import an audio file into the library (`file`, `name?`, `tags?`)
- `GET /samples?q=&tags=&key=&bpm_min=&bpm_max=&sort=&task_id=&limit=&offset=` - List/search samples → `{samples, matched, total}`
- `POST /samples/export` - Zip of the given sample ids (JSON `{ids}`); `POST /samples/analyze` - Re-analyse many (`{ids}`, empty = all)
- `GET /samples/{id}/peaks?points=` - Thumbnail peaks
- `GET /samples/tags` - Tags with usage counts
- `GET /samples/{id}` / `PATCH /samples/{id}` / `DELETE /samples/{id}` - Read, edit (`name`, `tags`, `bpm`, `key`; `null` reverts bpm/key to the detected value), delete
- `POST /samples/{id}/analyze` - Re-run BPM/key detection
- `GET /samples/{id}/audio` - Sample WAV
- `GET /samples/{id}/render?bpm=&semitones=&cents=` - Sample time-stretched to `bpm` / pitch-shifted (rendered once, cached); `DELETE /samples/renders/cache` clears the cache
- `GET /projects` / `POST /projects` - List / create arrangement projects
- `GET /projects/{id}` / `PUT /projects/{id}` / `DELETE /projects/{id}` - Read (samples embedded), save the whole document (tracks, clips, markers; send `base_version` to get `409` + the current document if another tab saved first), delete
- Deleting a sample that's used in a project returns `409`

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
- [PostgreSQL](https://www.postgresql.org/) - Database
- [librosa](https://librosa.org/) - Tempo and key analysis
- [pedalboard](https://github.com/spotify/pedalboard) / [Rubber Band](https://breakfastquay.com/rubberband/) - Time-stretching and pitch-shifting

## License
This project is for educational and personal use. Please respect the licenses of the underlying technologies:
- Demucs and BS-Roformer (`bs-roformer-infer`) are released under the MIT license
- FlashSR has **no stated license** — verify acceptable use yourself before relying on it beyond experimentation
- Commercial use of separated audio may require permission from original copyright holders
- pedalboard is GPLv3 (it bundles the GPL Rubber Band library) — keep that in mind before distributing this project

## Contributing
Contributions are welcome! Please feel free to submit issues or pull requests.

## Support
If you encounter any problems or have questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review existing [GitHub Issues](../../issues)
3. Create a new issue with detailed information about your problem