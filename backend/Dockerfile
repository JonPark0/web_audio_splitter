FROM python:3.11-slim

WORKDIR /app

# Receive the build argument
ARG USE_GPU=false

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
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

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]