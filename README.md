# Virtual Probability Simulation

교육용 가상 포인트 기반 확률 시뮬레이션입니다. FastAPI 서버와 Bootstrap 웹 UI를 사용하며, 업다운·슬롯·바카라 3가지 게임을 지원합니다. 모든 게임 결과는 가상의 포인트로만 계산되며, 실제 돈·도박과는 무관합니다.

## 구성

- **server/** – FastAPI 앱, SQLite 모델, 관리자 템플릿
- **webclient/** – 학생용 게임 페이지 (HTML/CSS/JS)
- **bet\_simulator.db** – 실행 시 자동 생성되는 SQLite DB

## 의존성 설치

Python 3.11 이상을 권장합니다. 가상환경을 만든 뒤 `requirements.txt`에 명시된 패키지를 설치하세요.

### Windows

```bash
python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

### macOS / Linux / WSL

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 실행 방법

```bash
# Windows
run_server.bat

# macOS / Linux / WSL
./run_server.sh
```

### 주요 URL

- 관리자 패널: `http://localhost:8000/admin`
- 게임 클라이언트: `http://localhost:8000/game`

## 기능 개요

### 관리자 패널

- 로그인 없이 접근 가능한 교육용 대시보드
- 게임 종류(업다운 / 슬롯 / 바카라)와 가상 배팅 금액을 입력 후 세션 키 생성
- 생성된 세션 키 목록/결과 로그 확인
- REST API
  - `POST /create_session` – 세션 생성
  - `POST /verify_key` – 세션 키 검증
  - `POST /report_result` – 게임 결과 저장
  - `GET /sessions`, `GET /results` – 최근 데이터 조회

### 게임 클라이언트 흐름

1. 학생이 `/game` 페이지에서 관리자에게 받은 세션 키 입력
2. 서버에서 게임 ID, 배팅 금액을 받아 UI 표시
3. 해당 게임 JS 모듈이 로컬 시뮬레이션 수행
4. 결과 확인 후 “서버에 결과 전송” 버튼으로 `/report_result` 호출

## 게임 규칙

### 업다운 (숫자 맞추기)

- 1~100 사이 난수, 최대 5회 추측
- 시도 횟수에 따라 배당: 1→x7 / 2→x5 / 3→x4 / 4→x3 / 5→x2
- 5회 이내에 맞추지 못하면 실패 처리 (배당 0)

### 슬롯 머신 (3릴)

- 심볼: `A, B, C, D, 7`
- 조합별 배당: `777`→x10, 같은 심볼 3개→x5, 같은 심볼 2개→x1.5, 그 외 x0

### 바카라 (교육용 간소 버전)

- 카드 값: A=1, 2~9 그대로, 10/J/Q/K=0
- Player/Banker/Natural 규칙, Player·Banker·Tie 베팅 구현
- 배당: Player x2, Banker x1.95(커미션 반영), Tie x8
- 3장 규칙 전부 적용, 로그와 카드 목록을 화면에 표시

## 데이터 구조

- **Sessions**: `session_key`, `game_id`, `bet_amount`, `created_at`, `used`
- **GameResults**: `session_key`, `result`, `bet_choice`, `payout_multiplier`, `detail`, `timestamp`

## 기타

- 모든 포인트는 100% 가상 포인트입니다.
- 서버에는 간단한 UUID 기반 세션 키와 선형 보안만 포함되며, 교육용 과제/시뮬레이션 이외의 용도로 사용하지 마세요.
