# AI Audio Splitter (Demucs)

**Language:** English | [한국어](README_ko.md)

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
Create(`cp .env.example .env`) or edit the `.env` file in the root directory:
```env
USE_GPU=false
DEMUCS_SHIFTS=0
```
- Set `USE_GPU=true` if you have an NVIDIA GPU and want faster processing (requires NVIDIA Container Toolkit).*

Don't forget to enable GPU configuration section in the `docker-compose.yml`. Change the backend deploy section as below.

```yml
    environment:
      - USE_GPU=${USE_GPU:-false}
      - DEMUCS_SHIFTS=${DEMUCS_SHIFTS:-0}
    # GPU Configuration
    # If you have an NVIDIA GPU and want to use it, uncomment the section below
    # and ensure 'nvidia-container-toolkit' is installed on your host.
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

- Change the `DEMUCS_SHIFTS` value to increase separation quality (higher values = better quality but slower processing):
  - `0`: Default, fastest (recommended for CPU)
  - `1-5`: Higher quality, slower processing (recommended for GPU)

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

## Technology Stack

### Backend
- **Python 3.11** - Core programming language
- **FastAPI** - Modern web framework for building APIs
- **Demucs** - Meta's state-of-the-art music source separation AI model
- **PyTorch** - Deep learning framework (CPU/GPU support)
- **Uvicorn** - ASGI server

### Frontend
- **React 18** - UI framework
- **Vite** - Fast build tool and dev server
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
│   ├── main.py              # FastAPI application entry point
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Backend container configuration
│   └── media/               # Uploaded and processed audio files
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main React component
│   │   ├── components/      # React components
│   │   └── main.jsx         # Application entry point
│   ├── package.json         # Node.js dependencies
│   ├── vite.config.js       # Vite configuration
│   └── Dockerfile           # Frontend container configuration
├── docker-compose.yml       # Multi-container orchestration
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
3. Uncomment the `deploy` section in [docker-compose.yml](docker-compose.yml:18-24)
4. Rebuild the containers: `docker-compose up --build`

### Supported Audio Formats
- MP3, WAV, FLAC, OGG, M4A, WMA
- Maximum file size: Limited by available disk space
- Recommended: High-quality source files for best separation results

## Troubleshooting

### Common Issues

**Issue: "Docker daemon not running"**
- Solution: Start Docker Desktop or Docker service on your system

**Issue: "Port 3000 or 8000 already in use"**
- Solution: Stop other applications using these ports or modify ports in [docker-compose.yml](docker-compose.yml)
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
  - Try different Demucs models by modifying the backend configuration

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
| `USE_GPU` | `false` | Enable NVIDIA GPU acceleration |
| `DEMUCS_SHIFTS` | `0` | Number of random shifts for separation quality |

### API Endpoints
- `POST /separate/` - Upload audio file for separation
- `GET /download/{filename}` - Download separated track
- `GET /status/{job_id}` - Check separation job status (if implemented)

## Credits

### Open Source Libraries
- [Meta Demucs](https://github.com/facebookresearch/demucs) - Music source separation AI model
- [FastAPI](https://fastapi.tiangolo.com/) - Backend framework
- [React](https://react.dev/) - Frontend framework
- [WaveSurfer.js](https://wavesurfer-js.org/) - Audio visualization

## License
This project is for educational and personal use. Please respect the licenses of the underlying technologies:
- Demucs is released under the MIT license
- Commercial use of separated audio may require permission from original copyright holders

## Contributing
Contributions are welcome! Please feel free to submit issues or pull requests.

## Support
If you encounter any problems or have questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review existing [GitHub Issues](../../issues)
3. Create a new issue with detailed information about your problem