# AI Audio Splitter (Demucs)

A simple web application to separate audio files into individual tracks (Vocals, Drums, Bass, and Other) using the Meta Demucs AI model.

## Features
- **Easy Upload:** Drag and drop or select your audio file.
- **AI Powered:** Uses Meta's `htdemucs` model for high-quality separation.
- **Interactive Mixer:** 
  - Visualized waveforms for each track.
  - Synchronized playback and seeking.
  - Individual volume controls.
  - Export/Download each track separately.
- **GPU Support:** Optional NVIDIA GPU acceleration via Docker.

## Quick Start

### 1. Prerequisites
- [Docker](https://www.docker.com/products/docker-desktop/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.

### 2. Configuration
Create or edit the `.env` file in the root directory:
```env
USE_GPU=false
```
*Set `USE_GPU=true` if you have an NVIDIA GPU and want faster processing (requires NVIDIA Container Toolkit).*

### 3. Run the Application
Open your terminal in the project folder and run:
```bash
docker-compose up --build
```

### 4. Access the UI
Once the build is complete:
- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:8000](http://localhost:8000)

## How to Use
1. **Upload:** Select an audio file on the main page and click "Start Separation".
2. **Process:** Wait for the AI to process the file (this takes a few minutes on CPU).
3. **Result:** Use the play button to listen to all tracks. Adjust volumes to isolate specific instruments and use the download icon to save individual tracks.
