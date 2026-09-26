FROM python:3.11-slim

WORKDIR /app

# Receive the build argument
ARG USE_GPU=false
# Pin the Apollo/FlashSR commits so the vendored inference APIs don't shift under us.
ARG APOLLO_COMMIT=main
ARG FLASHSR_COMMIT=main

# Install system dependencies
# git is needed to vendor the Apollo repo below.
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install PyTorch based on USE_GPU
# If false, install CPU-only version to save space
# If true, install standard version (includes CUDA)
RUN if [ "$USE_GPU" = "false" ]; then \
        echo "Installing CPU-only PyTorch..." && \
        pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu; \
    else \
        echo "Installing GPU-enabled PyTorch..." && \
        pip install --no-cache-dir torch torchaudio; \
    fi

# Install remaining dependencies (demucs will use the pre-installed torch)
RUN pip install --no-cache-dir -r requirements.txt

# --- Vendor Apollo (JusperLee/Apollo) for the recovery stage ---
# Not published as a pip package; look2hear/ (its model framework) is
# vendored inside the Apollo repo itself, so cloning it is sufficient — it's
# driven via backend/apollo_infer.py as a subprocess (see backend/restore.py).
# NOTE: this noticeably increases image size (Apollo's own deps + checkpoint).
RUN git clone --depth 1 https://github.com/JusperLee/Apollo.git /app/apollo \
    && cd /app/apollo && git fetch --depth 1 origin $APOLLO_COMMIT && git checkout $APOLLO_COMMIT
ENV PYTHONPATH="/app/apollo:${PYTHONPATH}"
ENV APOLLO_REPO_ID=JusperLee/Apollo

# Prefetch the Apollo checkpoint at build time so the image is self-contained
# and the first real request isn't a multi-minute cold download.
#
# NOTE: Apollo's own `BaseModel.from_pretrain(path, ...)` (look2hear/models/
# base_model.py) does NOT take a Hugging Face repo id despite the upstream
# demo passing one — it does `torch.load(path, ...)` directly on its first
# argument, so it needs an already-downloaded local checkpoint file. This was
# confirmed by actually building this image and hitting
# `FileNotFoundError: 'JusperLee/Apollo'` on an earlier version of this step.
# The fix is the same one apollo_infer.py uses at request time: download via
# huggingface_hub first, which also happens to warm its on-disk cache here.
#
# NOTE: docker-compose.*.yml mount a `demucs_cache` volume at /root/.cache at
# *runtime*; on first container start, Docker initializes an empty named
# volume from the image's existing directory contents, so this build-time
# cache is preserved rather than shadowed — but if that volume already
# exists from a prior run without this cache, it won't be retroactively
# populated. Delete/recreate the volume if you need to force a refresh.
RUN python -c "\
from huggingface_hub import hf_hub_download; \
hf_hub_download(repo_id='JusperLee/Apollo', filename='pytorch_model.bin')"

# AudioSR downloads its own (large) diffusion checkpoints on first use rather
# than at build time — its weights are considerably bigger than Apollo's and
# it's the secondary/opt-in model, so we accept a first-run download instead
# of always bloating the image.

# --- Vendor FlashSR (jakeoneijk/FlashSR_Inference) for the recovery stage ---
# Not published on PyPI. Unlike Apollo, it does ship a setup.py, so `pip
# install` on the clone pulls its real declared dependencies instead of us
# guessing them — the FlashSR/ and TorchJaekwon/ directories inside the repo
# are the actual importable packages (see backend/flashsr_infer.py's
# sys.path handling), matched to a real usage example, not the official
# README alone (which was incomplete) — expect this integration to need a
# real-build-and-fix pass the same way Apollo's did.
RUN git clone --depth 1 https://github.com/jakeoneijk/FlashSR_Inference.git /app/flashsr \
    && cd /app/flashsr && git fetch --depth 1 origin $FLASHSR_COMMIT && git checkout $FLASHSR_COMMIT \
    && pip install --no-cache-dir .
ENV PYTHONPATH="/app/flashsr:${PYTHONPATH}"
ENV FLASHSR_REPO_ID=jakeoneijk/FlashSR_weights

# Prefetch FlashSR's three checkpoint files at build time, same rationale as
# the Apollo checkpoint warm-up above.
# NOTE: FlashSR_weights is a HF *dataset* repo (huggingface.co/datasets/...),
# not a model repo — confirmed by an actual build failing with a 401
# "Repository Not Found" until repo_type="dataset" was added here.
RUN python -c "\
from huggingface_hub import hf_hub_download; \
[hf_hub_download(repo_id='jakeoneijk/FlashSR_weights', filename=f, repo_type='dataset') for f in ('student_ldm.pth', 'sr_vocoder.pth', 'vae.pth')]"

# Warm BS-Roformer's default model cache at build time too (its own default
# cache location, not a custom --output-dir, so the runtime CLI finds it
# without a first-request download).
RUN python -c "\
from bs_roformer import DEFAULT_MODEL, ensure_model_assets; \
ensure_model_assets(DEFAULT_MODEL)"

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]