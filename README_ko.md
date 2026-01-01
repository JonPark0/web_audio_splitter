# AI 오디오 분리기 (Demucs)

**Language:** [English](README.md) | 한국어

Meta Demucs AI 모델을 사용하여 오디오 파일을 개별 트랙(보컬, 드럼, 베이스, 기타)으로 분리하는 간단한 웹 애플리케이션입니다.

## 주요 기능
- **간편한 업로드:** 드래그 앤 드롭 또는 파일 선택으로 오디오 업로드
- **AI 기반:** Meta의 `htdemucs` 모델을 사용한 고품질 분리
- **인터랙티브 믹서:**
  - 각 트랙별 파형 시각화
  - 동기화된 재생 및 탐색
  - 개별 볼륨 조절
  - 각 트랙 개별 내보내기/다운로드
- **GPU 지원:** Docker를 통한 NVIDIA GPU 가속 지원(선택사항)

## 빠른 시작

### 1. 사전 요구사항
- [Docker](https://www.docker.com/products/docker-desktop/)와 [Docker Compose](https://docs.docker.com/compose/install/) 설치 필요

### 2. 설정
루트 디렉토리에 `.env` 파일을 생성(`cp .env.example .env`)하거나 편집하세요:
```env
USE_GPU=false
DEMUCS_SHIFTS=0
```
- NVIDIA GPU를 사용하여 더 빠른 처리를 원하면 `USE_GPU=true`로 설정하세요 (NVIDIA Container Toolkit 필요).*

`docker-compose.yml`에서 GPU 설정 섹션을 활성화하는 것을 잊지 마세요. 백엔드 deploy 섹션을 아래와 같이 변경하세요.

```yml
    environment:
      - USE_GPU=${USE_GPU:-false}
      - DEMUCS_SHIFTS=${DEMUCS_SHIFTS:-0}
    # GPU 설정
    # NVIDIA GPU를 사용하려면 아래 섹션의 주석을 해제하고
    # 호스트에 'nvidia-container-toolkit'이 설치되어 있는지 확인하세요.
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

- 분리 품질을 높이려면 `DEMUCS_SHIFTS` 값을 변경하세요 (값이 클수록 품질은 좋지만 처리 속도가 느려집니다):
  - `0`: 기본값, 가장 빠름 (CPU 권장)
  - `1-5`: 높은 품질, 느린 처리 (GPU 권장)

### 3. 애플리케이션 실행
프로젝트 폴더에서 터미널을 열고 실행하세요:
```bash
docker-compose up --build
```

### 4. UI 접속
빌드가 완료되면:
- **프론트엔드:** [http://localhost:3000](http://localhost:3000)
- **백엔드 API:** [http://localhost:8000](http://localhost:8000)

## 사용 방법
1. **업로드:** 메인 페이지에서 오디오 파일을 선택하고 "Start Separation"을 클릭하세요.
2. **처리:** AI가 파일을 처리할 때까지 기다립니다 (CPU에서 몇 분 소요).
3. **결과:** 재생 버튼을 사용하여 모든 트랙을 들어보세요. 볼륨을 조정하여 특정 악기를 분리하고 다운로드 아이콘을 사용하여 개별 트랙을 저장하세요.

## 기술 스택

### 백엔드
- **Python 3.11** - 핵심 프로그래밍 언어
- **FastAPI** - API 구축을 위한 현대적인 웹 프레임워크
- **Demucs** - Meta의 최첨단 음악 소스 분리 AI 모델
- **PyTorch** - 딥러닝 프레임워크 (CPU/GPU 지원)
- **Uvicorn** - ASGI 서버

### 프론트엔드
- **React 18** - UI 프레임워크
- **Vite** - 빠른 빌드 도구 및 개발 서버
- **WaveSurfer.js** - 오디오 파형 시각화
- **Axios** - API 요청을 위한 HTTP 클라이언트
- **React Icons** - 아이콘 라이브러리

### 인프라
- **Docker & Docker Compose** - 컨테이너화 및 오케스트레이션
- **NVIDIA Container Toolkit** - GPU 가속 지원 (선택사항)

## 프로젝트 구조
```
web_audio_splitter/
├── backend/
│   ├── main.py              # FastAPI 애플리케이션 진입점
│   ├── requirements.txt     # Python 의존성
│   ├── Dockerfile           # 백엔드 컨테이너 설정
│   └── media/               # 업로드 및 처리된 오디오 파일
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # 메인 React 컴포넌트
│   │   ├── components/      # React 컴포넌트들
│   │   └── main.jsx         # 애플리케이션 진입점
│   ├── package.json         # Node.js 의존성
│   ├── vite.config.js       # Vite 설정
│   └── Dockerfile           # 프론트엔드 컨테이너 설정
├── docker-compose.yml       # 멀티 컨테이너 오케스트레이션
├── .env.example             # 환경 변수 템플릿
└── README.md                # 영문 README
```

## 고급 설정

### 처리 품질 vs 속도
`DEMUCS_SHIFTS` 매개변수는 분리 시 사용되는 랜덤 시프트 수를 제어합니다:
- **0 시프트 (기본값)**: 가장 빠른 처리, 양호한 품질
- **1-5 시프트**: 점진적으로 더 나은 품질, 하지만 훨씬 느림
- **권장사항**: CPU는 0, GPU는 1-2 사용

### GPU 가속
GPU 가속을 활성화하려면:
1. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) 설치
2. [.env](.env) 파일에서 `USE_GPU=true`로 설정
3. [docker-compose.yml](docker-compose.yml:18-24)에서 `deploy` 섹션 주석 해제
4. 컨테이너 재빌드: `docker-compose up --build`

### 지원 오디오 포맷
- MP3, WAV, FLAC, OGG, M4A, WMA
- 최대 파일 크기: 사용 가능한 디스크 공간에 의해 제한
- 권장사항: 최상의 분리 결과를 위해 고품질 소스 파일 사용

## 문제 해결

### 일반적인 문제

**문제: "Docker daemon not running"**
- 해결방법: 시스템에서 Docker Desktop 또는 Docker 서비스를 시작하세요

**문제: "Port 3000 or 8000 already in use"**
- 해결방법: 해당 포트를 사용 중인 다른 애플리케이션을 중지하거나 [docker-compose.yml](docker-compose.yml)에서 포트를 수정하세요
- 프론트엔드: `"3000:3000"`을 `"3001:3000"`으로 변경
- 백엔드: `"8000:8000"`을 `"8001:8000"`으로 변경

**문제: "Out of memory during processing"**
- 해결방법: 다른 애플리케이션을 종료하거나 더 짧은 오디오 파일을 사용하세요
- CPU의 경우: `DEMUCS_SHIFTS`를 0으로 줄이세요
- GPU의 경우: GPU 메모리 사용량을 모니터링하세요

**문제: "GPU not detected"**
- 해결방법: NVIDIA 드라이버 및 Container Toolkit 설치를 확인하세요
- 확인 명령: `docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi`

**문제: "Separation quality is poor"**
- 해결방법:
  - 고품질 소스 오디오를 사용하세요 (320kbps MP3 또는 무손실 포맷)
  - GPU 사용 시 `DEMUCS_SHIFTS`를 증가시키세요
  - 백엔드 설정을 수정하여 다른 Demucs 모델을 시도해보세요

### 성능 팁
- **CPU 처리**: 3분 곡 기준 약 2-5분 소요
- **GPU 처리**: 3분 곡 기준 약 30-90초 소요
- 첫 실행 시 Demucs 모델을 다운로드합니다 (약 2GB), 이후 실행은 더 빠릅니다

## 개발

### 로컬 개발 (Docker 없이)

#### 백엔드
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

#### 프론트엔드
```bash
cd frontend
npm install
npm run dev
```

### 환경 변수
| 변수 | 기본값 | 설명 |
|----------|---------|-------------|
| `USE_GPU` | `false` | NVIDIA GPU 가속 활성화 |
| `DEMUCS_SHIFTS` | `0` | 분리 품질을 위한 랜덤 시프트 횟수 |

### API 엔드포인트
- `POST /separate/` - 분리를 위한 오디오 파일 업로드
- `GET /download/{filename}` - 분리된 트랙 다운로드
- `GET /status/{job_id}` - 분리 작업 상태 확인 (구현된 경우)

## 크레딧

### 오픈소스 라이브러리
- [Meta Demucs](https://github.com/facebookresearch/demucs) - 음악 소스 분리 AI 모델
- [FastAPI](https://fastapi.tiangolo.com/) - 백엔드 프레임워크
- [React](https://react.dev/) - 프론트엔드 프레임워크
- [WaveSurfer.js](https://wavesurfer-js.org/) - 오디오 시각화

## 라이선스
이 프로젝트는 교육 및 개인 용도입니다. 기반 기술의 라이선스를 존중해주세요:
- Demucs는 MIT 라이선스로 배포됩니다
- 분리된 오디오의 상업적 사용은 원본 저작권 보유자의 허가가 필요할 수 있습니다

## 기여
기여를 환영합니다! 이슈를 제출하거나 풀 리퀘스트를 자유롭게 보내주세요.

## 지원
문제가 발생하거나 질문이 있는 경우:
1. [문제 해결](#문제-해결) 섹션을 확인하세요
2. 기존 [GitHub Issues](../../issues)를 검토하세요
3. 문제에 대한 자세한 정보와 함께 새 이슈를 생성하세요

---
Meta Demucs AI로 제작됨
