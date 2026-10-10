# AI 오디오 분리기 (Demucs + 주파수 복원)

**Language:** [English](README.md) | 한국어

Meta Demucs AI 모델을 사용하여 오디오 파일을 개별 트랙(보컬, 드럼, 베이스, 기타)으로 분리하는 웹 애플리케이션입니다. 손실 압축 소스와 분리 과정 자체가 뭉개거나 약화시키는 중고음역대를 복원하는 **주파수 복원(선택 사항)** 단계가 추가되었습니다.

## 주요 기능
- **간편한 업로드:** 오디오(또는 영상) 파일 여러 개를 페이지 어디에든 끌어다 놓거나 선택합니다. 업로드 진행률과 취소를 지원하고, YouTube URL은 다운로드 후 바로 분리하거나 먼저 확인할 수 있습니다.
- **작업 대기열:** 작업은 한 번에 하나씩 실행되고(GPU 하나에서 두 개를 동시에 돌리면 메모리가 부족해지기 쉬움), Split 화면에 실시간으로 표시됩니다. 대기 순서, 단계, 경과/남은 시간, 검색, 상태 필터, 취소·재실행·삭제를 지원합니다. 앱의 모든 화면에 고유 URL이 있어 새로고침·뒤로 가기·북마크에도 위치가 유지됩니다.
- **AI 기반 분리:** Meta의 `htdemucs` 모델(BS-Roformer를 포함한 여러 대안 모델)을 사용한 고품질 분리
- **분리 & 복원:** 작업별로 선택 가능 — 분리 후 각 스템을 복원 모델로 추가 처리:
  - **Apollo** — 손실/압축 음악 복원에 특화된 band-sequence 모델. CPU에서도 충분히 빠름
  - **AudioSR** — 범용 any→48kHz 초고해상도 모델. 더 강력하지만 diffusion 기반으로 느림(RTX 4070 SUPER, 기본 설정, 15초 클립 기준 스템당 약 15-35초 + 작업당 모델 로딩 약 30초)
  - **FlashSR** — single-step distillation 기반, AudioSR보다 훨씬 빠름. 음악에 대한 검증이 부족하고 라이선스가 명시되어 있지 않아 기본값이 아닌 선택 옵션으로 제공
  - 원본 스템은 항상 보존되므로 트랙별로 원본 vs 복원본을 A/B 비교 가능
- **Stem 믹서:**
  - 바로 열립니다: 파형은 미리 계산한 peaks로 그리고 오디오는 짧은 조각으로 스트리밍합니다(6분짜리 7-stem 작업은 예전에는 재생 전에 약 1 GB를 내려받았습니다).
  - 하나의 오디오 클록에서 샘플 단위로 정렬해 재생하므로, 탐색하거나 원본/복원본을 바꿔도 stem이 어긋나지 않습니다.
  - stem별 dB 페이더, 음소거, 솔로. 다른 stem을 합친 파생 stem(BS-Roformer의 instrumental)은 악기가 두 번 들리지 않도록 처음부터 음소거됩니다.
  - 같은 시간축의 행 안에서 여는 스펙트로그램. −/+/Fit, Ctrl+휠, 핀치로 확대
  - stem별 다운로드 또는 전체 stem zip 다운로드(원본 또는 복원본)
- **단계별 진행 표시:** 단순 로딩 표시가 아닌 분리 → 복원 단계별 실제 진행률
- **샘플 추출:** stem(또는 지금 들리는 stem들의 믹스)에서 구간을 선택해 샘플로 저장하고, 서버에서 샘플 단위로 정확하게 잘라냅니다. 시작/끝 숫자 입력, 미세 이동 키, zero crossing·트랜지언트·박자 길이 스냅, 페이드, 노멀라이즈, 리버스, 출력 포맷(16/24/32-bit float, 44.1/48 kHz, 모노)을 지원합니다.
- **샘플 라이브러리:** 키보드로 다루는 촘촘한 목록(↑/↓ 미리듣기, Space, Enter, Del)에 파형 썸네일, URL에 유지되는 여러 태그·키·BPM 필터, 편집용 인스펙터, 일괄 태그/재분석/zip 다운로드/삭제, 여러 파일 가져오기, Camelot 키 표기, 프로젝트 템포로 미리듣기를 제공합니다. BPM과 키는 자동 분석되고(템포 오차 약 0.03 %), BPM은 ×2 / ÷2, 직접 입력, 탭 템포, 마디에 맞추기로 보정하고 키도 직접 지정할 수 있습니다.
- **작업 기록:** 작업이 PostgreSQL에 저장되어, 재시작한 뒤에도 이전 결과를 다시 열 수 있습니다. 끝난 작업은 다른 분리 모델이나 복원 설정으로 **다시 실행(Retry)**할 수 있고(같은 원본 음원으로 새 작업을 만들며 기존 작업은 유지), 파일과 함께 **삭제**할 수도 있습니다.
- **Arrangement View:** Ableton 방식의 마디/박자 타임라인 위에 트랙을 구성합니다. 샘플을 트랙에 끌어다 놓고, 스냅에 맞춰 클립을 이동·복제하고, 양쪽 끝을 자르고, **클립 루프**(자른 구간을 원하는 길이만큼 반복), 페이드, 리버스, 음정(±24반음 + cents), 복사/붙여넣기, 재생 위치에서 자르기, 드래그 다중 선택, Ableton처럼 겹친 클립 잘라내기, 트랙 순서 변경, 마커, 박자표, 마스터 게인과 피크 미터, 메트로놈, 실행 취소/다시 실행, **Export WAV**(전체 곡, 반복 구간, 트랙별 WAV)를 지원합니다. 프로젝트는 PostgreSQL에 자동 저장되고, 다른 탭에서 저장한 경우를 감지하며(조용히 덮어쓰지 않음), 실패한 저장은 다시 시도하고, 저장 전에 탭을 닫아도 편집 내용이 남습니다.
- **BPM Sync:** warp가 켜진 클립은 프로젝트 템포를 따릅니다. BPM을 바꾸면 서버에서 음정을 유지한 채 time-stretch(Rubber Band)하고 결과를 캐시합니다. 렌더링이 끝나기 전에는 속도만 바꿔 재생해서 변경을 바로 들을 수 있습니다.
- **휴대폰·태블릿·데스크탑:** 모든 화면을 휴대폰에서 쓸 수 있습니다. 촘촘한 행, 하단 고정 재생/실행 바, 바텀 시트, 44 px 이상의 터치 영역, 핀치 확대, 길게 눌러 클립 끌기(스와이프는 스크롤). 레이아웃은 화면 폭만이 아니라 기기에 맞춰 정해집니다. 가로로 든 휴대폰은 휴대폰 레이아웃, 가로 iPad는 태블릿 레이아웃을 쓰고, 터치가 되는 모든 화면(터치 노트북, 트랙패드를 연결한 iPad)에서 손가락 크기의 터치 영역을 씁니다. iPhone 무음 모드에서도 재생 소리가 나고, 통화나 Siri로 끊기면 깔끔하게 일시정지됩니다. 가로 화면에서 노치를 피하고, Safari 트랙패드 핀치로 파형을 확대하며, 한글 자판 상태에서도 단축키가 동작합니다.
- **이어 올리기:** 파일을 조각으로 나눠 올려서, 화면 잠금이나 연결 끊김으로 끊긴 업로드가 멈춘 곳부터 이어집니다(자동으로, 또는 다시 시도로). 업로드 중에는 화면이 꺼지지 않으며, 서버 한도(`GET /limits`)를 넘는 파일은 보내기 전에 거절합니다.
- **GPU 지원:** Docker를 통한 NVIDIA GPU 가속 지원(선택사항)

## 빠른 시작

### 1. 사전 요구사항
- [Docker](https://www.docker.com/products/docker-desktop/)와 [Docker Compose](https://docs.docker.com/compose/install/) 설치 필요

### 2. 설정
루트 디렉토리에 `.env` 파일을 생성(`cp .env.example .env`)하거나 편집하세요:
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
- `DEMUCS_SHIFTS`: 분리 품질을 제어합니다 (값이 클수록 품질은 좋지만 처리 속도가 느려집니다):
  - `0`: 기본값, 가장 빠름 (CPU 권장)
  - `1-5`: 높은 품질, 느린 처리 (GPU 권장)
- `AUDIOSR_DDIM_STEPS` / `AUDIOSR_GUIDANCE_SCALE` / `AUDIOSR_MODEL_NAME`: UI에서 AudioSR 복원 모델을 선택했을 때만 적용됩니다. 아래 [복원 모델](#복원-모델) 참고.
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`: 함께 실행되는 PostgreSQL 18 서비스(`db`)의 접속 정보입니다. 포트를 따로 열지 않는 한 compose 네트워크 안에서만 접근할 수 있습니다. 스키마 마이그레이션은 백엔드가 시작될 때 자동으로 실행됩니다.

> **첫 빌드 참고:** 백엔드 이미지가 이제 빌드 시점에 [JusperLee/Apollo](https://github.com/JusperLee/Apollo)를 클론하고 체크포인트를 미리 받아오므로, 첫 `docker compose ... up --build`는 시간이 더 걸리고 이미지 용량도 커집니다.

### 3. 애플리케이션 실행
프로젝트 폴더에서 터미널을 열고 환경에 맞는 compose 파일을 실행하세요:

**CPU 전용 (기본):**
```bash
docker compose -f docker-compose.cpu.yml up --build
```

**GPU (NVIDIA):**
호스트에 [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) 설치가 필요합니다. `.env` 파일에서 `USE_GPU=true`로 설정하세요.
```bash
docker compose -f docker-compose.gpu.yml up --build
```

### 4. UI 접속
빌드가 완료되면:
- **프론트엔드:** [http://localhost:3000](http://localhost:3000)
- **백엔드 API:** [http://localhost:8000](http://localhost:8000)

## 사용 방법
1. **분리:** **Split** 화면에서 오디오 파일을 끌어다 놓거나 YouTube URL을 붙여넣고, 모델(최고 품질은 BS-Roformer, 속도는 htdemucs)과 필요하면 **Restore**를 고르세요. 작업은 오른쪽 목록에 실시간 진행률과 함께 쌓이고, 열어서 따라갈 수 있습니다.
2. **결과:** Space로 재생/일시정지합니다. stem별 페이더, 음소거/솔로, stem별 또는 전체 원본/복원본 전환, 스펙트로그램, stem 또는 전체 zip 다운로드가 가능합니다.
3. **샘플 추출:** stem의 **Extract**를 누르고 파형 위를 드래그하세요(휴대폰에서는 재생 위치에서 Set start / Set end). 시작/끝 입력, ←/→(Shift = 10 ms, Alt = 1박), Snap으로 다듬고 **Loop**로 확인합니다. **Save**는 그 stem의 현재 원본/복원본을, **Save mix**는 지금 들리는 stem들을 현재 볼륨으로 합쳐 저장합니다. −/+/Fit, Ctrl/⌘+휠, Z(선택 구간으로), 핀치로 확대합니다.
4. **라이브러리:** ↑/↓(Auto가 켜져 있으면 바로 미리듣기), Space, L(반복)로 둘러보고, 인스펙터에서 이름·태그·BPM·키를 고칩니다. 행을 체크하면 일괄 작업, **Sync**는 프로젝트 템포로 미리듣기, **Add to Arrange**는 마지막 프로젝트에 샘플을 넣습니다.
5. **어레인지:** 프로젝트를 만들고 BPM을 정한 뒤 샘플 브라우저에서 샘플을 트랙으로 끌어다 놓으세요(휴대폰에서는 샘플을 탭한 뒤 레인을 탭). BPM이 있는 클립은 프로젝트 템포에 맞춰 warp됩니다. 클립 인스펙터에서 **Loop**를 켜고 오른쪽 끝을 끌면 구간이 반복됩니다. 툴바에서 곡, 반복 구간, stem별 WAV를 내보낼 수 있습니다. 키보드로는 Tab으로 클립에 들어가고, ⌥/Alt+←/→로 같은 트랙의 클립을, ⌥/Alt+↑/↓로 위·아래 트랙에서 가장 가까운 클립을 오가며, 화살표로 선택한 클립을 옮기고 Enter로 클립 인스펙터를 엽니다.

## 분리 모델

전체 Demucs 계열 외에도 **BS-Roformer** ([openmirlab/bs-roformer-infer](https://github.com/openmirlab/bs-roformer-infer))를 더 높은 품질의 대안으로 선택할 수 있습니다 — htdemucs보다 의미 있게 높은 SDR(약 11.99 dB vs 약 9.00 dB)을 기록했으며 2023년 Sound Demixing Challenge에서 우승했습니다. `htdemucs_6s`와 동일한 6개 스템(vocals/drums/bass/guitar/piano/other)에 보너스로 `*_instrumental.wav`를 추가로 생성합니다.

## 복원 모델

분리와 복원을 동시에 수행하는 완성된 단일 모델은 아직 없습니다 — 이 앱은 2단계 파이프라인으로 동작합니다: 분리 모델이 스템을 나누고, (활성화 시) 복원 모델이 스템별로 주파수 디테일을 되살립니다.

| 모델 | 방식 | 속도 | 적합한 경우 |
|------|------|------|-------------|
| **Apollo** (기본값) | Band-sequence 모델링 ([JusperLee/Apollo](https://github.com/JusperLee/Apollo)) | 빠름, CPU에서도 가능 | 손실/압축 소스(MP3, YouTube) — 분리된 스템에서 고음이 "사라진" 것처럼 들리는 가장 흔한 원인 |
| **AudioSR** | Diffusion 기반 any→48kHz 초고해상도, 10-50회 반복 DDIM 스텝 ([haoheliu/versatile_audio_super_resolution](https://github.com/haoheliu/versatile_audio_super_resolution)) | 느림(RTX 4070 SUPER, 기본 설정, 15초 클립 기준 스템당 약 15-35초 + 작업당 모델 로딩 약 30초), GPU 권장 | 명확한 샘플레이트/주파수 상한이 원인인 일반적인 대역폭 확장 |
| **FlashSR** | Single-step distillation 기반 any→48kHz ([jakeoneijk/FlashSR_Inference](https://github.com/jakeoneijk/FlashSR_Inference)) | 빠름 — AudioSR의 반복 루프 대신 윈도우당 한 번의 forward pass만 필요 | AudioSR 방식의 대역폭 확장은 원하지만 AudioSR의 속도는 받아들이기 어려운 경우 |

복원은 **작업별 선택 사항**이며 원본 스템을 항상 보존하므로 언제든 비교할 수 있습니다.

> **참고:**
> - AudioSR은 스테레오 입력이더라도 출력을 모노로 다운믹스합니다 — 이는 이 프로젝트의 통합 방식이 아니라 AudioSR 자체의 특성입니다. Apollo와 FlashSR은 원본 채널 수를 그대로 유지합니다.
> - **FlashSR은 저장소에 라이선스가 명시되어 있지 않습니다.** 평가해볼 수 있도록 옵션으로 제공하지만, 실험 이상의 용도로 사용하기 전에 라이선스 조건을 직접 확인하세요. 아키텍처 계보(HierSpeech++)가 음성 중심이라 음악에서의 품질은 이 프로젝트에서 별도로 검증하지 않았습니다.

### 조사했지만 포함하지 않은 모델

연구 과정(Gemini 및 자체 조사)에서 논문상으로는 유망해 보였지만 이 문서 작성 시점에 공개된 코드가 없던 모델들이 있었습니다 — 복원 모델로는 **AudioLBM**(NeurIPS 2025, Latent Bridge Models)과 **SAGA-SR**(KAIST), 그리고 음악 전용 **"BigWavGAN"** 논문(NVIDIA의 BigVGAN 보코더와는 다른, 별개의 도구로 이 파이프라인에는 해당하지 않음)이 있습니다. 저자들이 코드를 공개하면 다시 검토할 가치가 있습니다.

## 기술 스택

### 백엔드
- **Python 3.11** - 핵심 프로그래밍 언어
- **FastAPI** - API 구축을 위한 현대적인 웹 프레임워크
- **Demucs** - Meta의 최첨단 음악 소스 분리 AI 모델
- **BS-Roformer** - Demucs보다 높은 SDR을 제공하는 대안 분리 모델
- **Apollo** - 손실/압축 음악을 위한 band-sequence 복원 모델
- **AudioSR** - 범용 any→48kHz 오디오 초고해상도 모델
- **FlashSR** - Single-step distillation 기반 any→48kHz 오디오 초고해상도 모델
- **PyTorch** - 딥러닝 프레임워크 (CPU/GPU 지원)
- **Uvicorn** - ASGI 서버
- **PostgreSQL 18** - 작업 기록 및 샘플 라이브러리
- **SQLAlchemy + Alembic** - ORM 및 스키마 마이그레이션
- **librosa** - 샘플 템포 및 키 분석
- **pedalboard (Rubber Band)** - BPM Sync용 time-stretch / 피치 시프트

### 프론트엔드
- **React 18** - UI 프레임워크
- **Vite** - 빠른 빌드 도구 및 개발 서버
- **Tailwind CSS** - 유틸리티 기반 스타일링 / 디자인 시스템
- **Palnarium 디자인 시스템** - 흑백 토큰(ink/muted/paper/line/wash), Exo 2 + Pretendard(한글) 단일 굵기, 텍스트만으로 된 컨트롤
- **Web Audio API** - stem 믹서 스트리밍 엔진(Range 요청으로 WAV를 조각 단위로 받아 모든 stem을 하나의 클록으로 재생)과 어레인지 엔진
- **Axios** - API 요청을 위한 HTTP 클라이언트
- **React Icons** - 아이콘 라이브러리

### 인프라
- **Docker & Docker Compose** - 컨테이너화 및 오케스트레이션
- **NVIDIA Container Toolkit** - GPU 가속 지원 (선택사항)

## 프로젝트 구조
```
web_audio_splitter/
├── backend/
│   ├── main.py              # FastAPI 애플리케이션 진입점 (파이프라인 + 엔드포인트)
│   ├── separate.py          # 분리 디스패치 (Demucs 계열 / BS-Roformer)
│   ├── restore.py           # 복원 디스패치 (Apollo / AudioSR / FlashSR)
│   ├── apollo_infer.py      # 독립 실행형 Apollo 추론 래퍼 (청크 처리, CPU/GPU)
│   ├── flashsr_infer.py     # 독립 실행형 FlashSR 추론 래퍼 (청크 처리, CPU/GPU)
│   ├── audiosr_infer.py     # 독립 실행형 AudioSR 추론 래퍼
│   ├── infer_cli.py         # 래퍼 공통 배치/진행률 처리 (작업당 모델 1회 로딩)
│   ├── samples.py           # 샘플 라이브러리 엔드포인트 (추출 / 믹스 / 가져오기 / 목록 / 편집 / 렌더)
│   ├── analysis.py          # 샘플과 곡의 BPM + 키 분석
│   ├── jobs.py              # 작업 대기열 (기본 한 번에 하나) 및 취소
│   ├── peaks.py             # 파형 peaks (JSON 캐시) — 믹서와 썸네일을 바로 그리기 위함
│   ├── songs.py             # 곡 단위 BPM/키, 분리 후 분석
│   ├── db.py / models.py    # SQLAlchemy 엔진/세션 및 ORM 모델
│   ├── task_store.py        # 작업 영구 저장 (기존 메모리 dict 대체)
│   ├── storage.py           # media/ 디렉터리 구성 및 경로 헬퍼
│   ├── migrations/          # Alembic 마이그레이션 (시작 시 자동 적용)
│   ├── requirements-app.txt # 앱 의존성(DB), Docker 후반 레이어에서 설치
│   ├── projects.py          # 어레인지 프로젝트 API (문서 단위 저장)
│   ├── requirements.txt     # Python 의존성
│   ├── Dockerfile           # 백엔드 컨테이너 설정 (Apollo + FlashSR 벤더링 포함)
│   └── media/               # 업로드/분리/복원된 오디오 및 캐시된 스펙트로그램
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # 셸: 헤더, 라우트, 오류 경계
│   │   ├── router.js        # 해시 라우트 (#/split, #/split/job/<id>, #/library?…, #/arrange/<id>)
│   │   ├── api.js           # 백엔드 API 호출 통합 모듈
│   │   ├── arrange/         # 어레인지: 데이터 모델 + 타이밍(project.js), Web Audio 엔진(engine.js), UI(ui/)
│   │   ├── components/      # Split 홈 + 작업 목록 (jobs/), 셸 (shell/), stem 믹서 + 추출 (result/), 라이브러리 (library/)
│   │   └── main.jsx         # 애플리케이션 진입점
│   ├── tailwind.config.js   # 디자인 토큰 (색상, 그림자, 애니메이션)
│   ├── package.json         # Node.js 의존성
│   ├── vite.config.js       # Vite 설정
│   └── Dockerfile           # 프론트엔드 컨테이너 설정
├── docker-compose.cpu.yml   # CPU 환경용 Docker Compose
├── docker-compose.gpu.yml   # GPU 환경용 Docker Compose (NVIDIA)
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
3. GPU compose 파일로 실행: `docker compose -f docker-compose.gpu.yml up --build`

### 지원 오디오 포맷
- ffmpeg가 읽을 수 있는 모든 포맷: MP3, WAV, FLAC, OGG, M4A, AIFF, WMA… 그리고 영상 파일(오디오 트랙 사용)
- 업로드는 `MAX_UPLOAD_MB`(기본 1 GB), 30분까지, 라이브러리 가져오기는 10분까지
- 권장사항: 최상의 분리 결과를 위해 고품질 소스 파일 사용

## 문제 해결

### 일반적인 문제

**문제: "Docker daemon not running"**
- 해결방법: 시스템에서 Docker Desktop 또는 Docker 서비스를 시작하세요

**문제: "Port 3000 or 8000 already in use"**
- 해결방법: 해당 포트를 사용 중인 다른 애플리케이션을 중지하거나 docker-compose 파일에서 포트를 수정하세요
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
  - 모델 선택기에서 다른 Demucs 모델이나 BS-Roformer를 시도해보세요

**문제: 복원 단계가 몇 분간 멈춰 있다가 Hugging Face 401/429 또는 "cannot find the requested files in the local cache" 오류로 실패함**
- 원인: `/root/.cache`에 마운트되는 `demucs_cache` Docker 볼륨(Apollo/AudioSR/FlashSR/BS-Roformer의 다운로드된 체크포인트 저장)은 **named volume**입니다 — Docker는 볼륨이 처음 생성될 때만 이미지 내용으로 초기화합니다. 새 모델이 이미지에 추가되기 전에 이 볼륨이 이미 존재했다면(예: 한 번 빌드한 뒤 새 모델이 추가된 최신 버전을 받은 경우), 컨테이너는 새 이미지에 미리 준비된 캐시 대신 기존의 불완전한 볼륨을 계속 사용하게 되어, 느리거나 rate-limit에 걸리는 런타임 다운로드로 넘어가게 됩니다.
- 해결방법: `docker compose rm -sf backend && docker volume rm web_audio_splitter_demucs_cache`(프로젝트 폴더 접두사가 다르면 볼륨 이름을 맞게 조정) 실행 후 `docker compose up -d backend`로 현재 이미지 기준으로 새로 채워지도록 하세요.

**문제: 데이터베이스 초기화**
- 작업 기록과 샘플 메타데이터는 `pgdata` Docker 볼륨에 저장됩니다(샘플 오디오 파일은 `backend/media/samples/`에 있습니다).
- 처음부터 다시 시작하려면 `docker compose -f docker-compose.gpu.yml down && docker volume rm web_audio_splitter_pgdata`(프로젝트 폴더 접두사에 맞게 조정)를 실행한 뒤 다시 띄우세요. 마이그레이션이 스키마를 다시 만듭니다.
- **주의:** `docker compose down`은 데이터를 유지하지만, `docker compose down -v`는 이름 있는 볼륨인 데이터베이스(`pgdata`)와 내려받은 모델 캐시(`demucs_cache`)까지 삭제합니다.

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
pip install -r requirements-app.txt
# 실행 중인 PostgreSQL 18을 지정하고 스키마 생성
export DATABASE_URL=postgresql+psycopg://splitter:splitter@localhost:5432/splitter
alembic upgrade head
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
| `USE_GPU` | `false` | NVIDIA GPU 가속 활성화 (복원 단계의 디바이스도 함께 결정) |
| `DEMUCS_SHIFTS` | `0` | 분리 품질을 위한 랜덤 시프트 횟수 |
| `AUDIOSR_DDIM_STEPS` | `50` | AudioSR 샘플링 스텝 수 (높을수록 느리지만 대체로 품질이 좋음) |
| `AUDIOSR_GUIDANCE_SCALE` | `3.5` | AudioSR guidance scale |
| `AUDIOSR_MODEL_NAME` | `basic` | AudioSR 모델 종류: `basic`(음악/범용) 또는 `speech` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `splitter` | `db` 서비스 접속 정보 |
| `DATABASE_URL` | 위 값으로 구성 | 백엔드 DB 연결 문자열 (compose가 설정, Docker 없이 실행할 때는 직접 지정) |
| `MEDIA_RETENTION_DAYS` | `0` | N일이 지난 작업(업로드, stem, 스펙트로그램)을 삭제합니다. 라이브러리 샘플은 별도 복사본이라 유지됩니다. `0` = 모두 보관 |
| `MAX_CONCURRENT_JOBS` | `1` | 동시에 실행할 분리 작업 수, 나머지는 대기 (VRAM/CPU 여유가 있을 때만 늘리세요) |
| `MAX_UPLOAD_MB` | `1024` | 업로드 최대 크기 |
| `RENDER_CACHE_MB` | `4096` | time-stretch/피치 렌더 캐시의 디스크 상한 (가장 오래 쓰지 않은 것부터 삭제) |

### API 엔드포인트
- `POST /upload` - 오디오/영상 파일 업로드 (`file`, `model`, `recover`, `recovery_model`) → `{task_id}`; 오디오가 아니거나 너무 길면 `400`, 너무 크면 `413`
- `POST /uploads` - 이어 올리기(조각) 업로드 시작 (form: `filename`, `size`, `model`, `recover`, `recovery_model`) → `{upload_id, received, size, chunk_size}`; 너무 크면 `413`
- `PUT /uploads/{id}` - 조각 추가 (multipart: `offset`, `chunk`) → `{received}`; `offset`이 받은 위치와 다르면 `409` + `{received}`
- `GET /uploads/{id}` - 업로드가 어디까지 왔는지 → `{received, size, task_id}`; `DELETE /uploads/{id}`로 버리기 (하루 동안 손대지 않은 세션은 정리됨)
- `POST /uploads/{id}/complete` - `POST /upload`와 같은 검사 후 작업 생성 → `{task_id}` (다시 보내도 같은 작업)
- `GET /limits` - 업로드 한도 `{max_upload_mb, max_duration_seconds}`
- `POST /youtube/info` - YouTube URL 검증 및 메타데이터 조회 (재생목록, 라이브 스트림은 거부)
- `POST /youtube/download` - 백그라운드 YouTube 다운로드 시작 (`url`, `model`, `recover`, `recovery_model`, `auto_split`) → `{task_id}`; `/status`가 `download_percent`를 알려줌
- `POST /youtube/confirm/{task_id}` - 다운로드된 오디오 확인 및 처리 시작
- `GET /youtube/preview/{task_id}` - 다운로드된 YouTube 오디오 미리듣기
- `GET /status/{task_id}` - 작업 상태 폴링: `step`(`separating`/`restoring`), 대기 순서, 시각, 진행률
- `GET /result/{task_id}` - 트랙, 복원본, `derived_tracks`, 곡 BPM/키, 길이
- `GET /download/{task_id}/{track_name}?variant=original|recovered` - 스템 다운로드/스트리밍 (Range 요청 지원)
- `GET /peaks/{task_id}/{track_name}?variant=&resolution=` - 파형 peaks (초당 포인트 수, 캐시)
- `GET /onsets/{task_id}/{track_name}?variant=` - 트랜지언트 시각 (스냅용)
- `GET /spectrogram/{task_id}/{track_name}?variant=original|recovered` - 렌더링(및 캐시)된 스펙트로그램 PNG
- `GET /tasks/{task_id}/stems.zip?variant=` - 작업의 모든 stem을 zip 하나로 (스트리밍)
- `GET /tasks?limit=&before=&q=&status=` - 작업 목록 (최신순, `in_flight` 포함, `before`로 이전 페이지)
- `POST /tasks/{task_id}/retry` - 작업의 원본 음원을 다른 설정으로 다시 실행 (JSON: `model`, `recover`, `recovery_model`) → 새 작업의 `{task_id}`
- `POST /tasks/{task_id}/cancel` - 대기 중이거나 실행 중인 작업 취소
- `DELETE /tasks/{task_id}` - 작업과 파일 삭제 (실행 중이면 `409`)
- `POST /samples` - stem에서 샘플 추출 (JSON: `task_id`, `track`, `variant`, `start_sec`, `end_sec`, `name?`, `tags?`, 그리고 `snap_to_zero`, `fade_in_ms`, `fade_out_ms`, `normalize`, `reverse`, `bit_depth`, `sample_rate`, `mono`)
- `POST /samples/mix` - 위와 같지만 여러 stem을 stem별 게인으로 합쳐서 (`stems: [{track, variant, gain}]`)
- `POST /samples/import` - 오디오 파일을 라이브러리로 가져오기 (`file`, `name?`, `tags?`)
- `GET /samples?q=&tags=&key=&bpm_min=&bpm_max=&sort=&task_id=&limit=&offset=` - 샘플 목록/검색 → `{samples, matched, total}`
- `POST /samples/export` - 지정한 샘플들의 zip (JSON `{ids}`); `POST /samples/analyze` - 여러 샘플 재분석 (`{ids}`, 비우면 전체)
- `GET /samples/{id}/peaks?points=` - 썸네일 peaks
- `GET /samples/tags` - 태그별 사용 횟수
- `GET /samples/{id}` / `PATCH /samples/{id}` / `DELETE /samples/{id}` - 조회, 수정(`name`, `tags`, `bpm`, `key`; `null`을 보내면 bpm/key가 분석값으로 돌아감), 삭제
- `POST /samples/{id}/analyze` - BPM/키 재분석
- `GET /samples/{id}/audio?download=` - 샘플 WAV; `download=<이름>`을 주면 그 이름의 첨부 파일로 보냄
- `GET /samples/{id}/render?bpm=&semitones=&cents=` - `bpm`으로 time-stretch / 피치 시프트한 샘플 (한 번 렌더링 후 캐시); `DELETE /samples/renders/cache`로 캐시 비우기
- `GET /projects` / `POST /projects` - 어레인지 프로젝트 목록 / 생성
- `GET /projects/{id}` / `PUT /projects/{id}` / `DELETE /projects/{id}` - 조회(샘플 정보 포함), 문서 전체 저장(트랙, 클립, 마커; `base_version`을 보내면 다른 탭이 먼저 저장했을 때 `409`와 현재 문서를 돌려줌), 삭제
- 프로젝트에서 사용 중인 샘플을 삭제하면 `409`를 반환합니다

## 크레딧

### 오픈소스 라이브러리
- [Meta Demucs](https://github.com/facebookresearch/demucs) - 음악 소스 분리 AI 모델
- [BS-Roformer](https://github.com/openmirlab/bs-roformer-infer) - 더 높은 SDR을 제공하는 대안 분리 모델
- [Apollo](https://github.com/JusperLee/Apollo) - Band-sequence 오디오 복원 모델
- [AudioSR](https://github.com/haoheliu/versatile_audio_super_resolution) - 범용 오디오 초고해상도 모델
- [FlashSR](https://github.com/jakeoneijk/FlashSR_Inference) - Single-step distillation 기반 오디오 초고해상도 모델 (라이선스 미명시 — 위 참고 사항 확인)
- [FastAPI](https://fastapi.tiangolo.com/) - 백엔드 프레임워크
- [React](https://react.dev/) - 프론트엔드 프레임워크
- [Tailwind CSS](https://tailwindcss.com/) - 스타일링
- [PostgreSQL](https://www.postgresql.org/) - 데이터베이스
- [librosa](https://librosa.org/) - 템포 및 키 분석
- [pedalboard](https://github.com/spotify/pedalboard) / [Rubber Band](https://breakfastquay.com/rubberband/) - time-stretch 및 피치 시프트

## 라이선스
이 프로젝트는 교육 및 개인 용도입니다. 기반 기술의 라이선스를 존중해주세요:
- Demucs와 BS-Roformer(`bs-roformer-infer`)는 MIT 라이선스로 배포됩니다
- FlashSR은 **라이선스가 명시되어 있지 않습니다** — 실험 이상의 용도로 사용하기 전에 직접 사용 가능 여부를 확인하세요
- 분리된 오디오의 상업적 사용은 원본 저작권 보유자의 허가가 필요할 수 있습니다
- pedalboard는 GPLv3입니다(GPL 라이선스인 Rubber Band 라이브러리를 포함). 이 프로젝트를 배포하기 전에 참고하세요

## 기여
기여를 환영합니다! 이슈를 제출하거나 풀 리퀘스트를 자유롭게 보내주세요.

## 지원
문제가 발생하거나 질문이 있는 경우:
1. [문제 해결](#문제-해결) 섹션을 확인하세요
2. 기존 [GitHub Issues](../../issues)를 검토하세요
3. 문제에 대한 자세한 정보와 함께 새 이슈를 생성하세요

---
Meta Demucs AI로 제작됨
