# Virtual Probability Simulation

계정(이름+PIN) 기반 가상 포인트 시뮬레이터입니다. 학생은 로그인 후 베팅·게임을 진행하고, 서버가 자동으로 포인트를 증감합니다. 관리자는 계정/포인트 관리와 게임 보정 설정만 담당합니다.

## 실행/접속
```bash
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
# 관리자 비밀번호 기본값: adminpass (환경변수 ADMIN_SECRET로 변경)
# 토큰 서명 키: TOKEN_SECRET (기본 dev-secret)
```
- 관리자 페이지: `http://localhost:8000/admin` (또는 `http://<서버IP>:8000/admin`)
- 유저 페이지: `http://localhost:8000/game` (또는 `http://<서버IP>:8000/game`)

## 사용자 흐름
1) 로그인: 이름 + 4자리 PIN → Bearer 토큰 발급
2) 대시보드: 현재 포인트 표시, 게임 3종(업다운/슬롯/바카라) 카드 노출
3) 게임 진행:
   - 업다운: 베팅 후 “게임 시작” → 플레이 화면에서 1~5회 숫자 입력/판정, 최종 배당·잔액 표시
   - 슬롯: 스핀 애니메이션 후 결과·배당·잔액 표시
   - 바카라: 카드 공개 애니메이션, Player/Banker/Tie 배팅 결과·배당·잔액 표시
4) 포인트 증감은 서버가 즉시 처리하며, 결과/잔액이 화면에 반영됩니다.

## 관리자 기능
- 관리자 인증: 요청 헤더 `admin-secret: <비밀번호>` (기본 adminpass)
- 계정 생성/목록/삭제
- 포인트 조정(충전/차감) 및 트랜잭션 로그 조회(유형, 게임, 금액, 잔액 변동, 메모, 시간)
- 게임 보정 설정(카지노 우세/유저 우세, 최소·최대 베팅 기준, 가중치%)

## 주요 API
- 인증
  - `POST /api/login {name, pin}` → `{token, user}` (Bearer 토큰)
  - `GET /api/me` → 현재 유저 정보
- 게임
  - `POST /api/game/updown/start?bet_amount=`: 업다운 시작(타깃/시도 초기화)
  - `POST /api/game/updown/guess {guess}`: 업다운 판정(진행/최종)
  - `POST /api/game/slot {bet_amount}`
  - `POST /api/game/baccarat {bet_amount, bet_choice}` (Player/Banker/Tie)
  - 공통 응답: `{result, payout_multiplier, payout_amount, delta, balance, detail}` (업다운 진행 중은 `result: pending`)
- 관리자 (헤더 `admin-secret` 필수)
  - `POST /api/admin/users {name, pin, initial_balance}`
  - `GET /api/admin/users?search=`
  - `POST /api/admin/users/{id}/adjust_balance {delta, reason}`
  - `DELETE /api/admin/users/{id}`
  - `GET /api/admin/users/{id}/transactions?limit=20`
  - `GET /game_settings`, `POST /game_settings {settings: [...]}`

## DB 스키마 (SQLite `bet_simulator.db`)
- `users(id, name, pin, balance, created_at, updated_at)`
- `transactions(id, user_id, type(charge|deduct|game), game_type, amount, before_balance, after_balance, description, created_at)`
- `game_results(id, user_id, game_id, bet_amount, bet_choice, result, payout_multiplier, payout_amount, detail, timestamp)`
- `game_settings(game_id unique, risk_enabled, risk_threshold, casino_advantage_percent, assist_enabled, assist_max_bet, player_advantage_percent, updated_at)`

## 게임 규칙 요약
- 업다운: 1~100 난수, 최대 5회. 배당 1~5회 차례로 7x/5x/4x/3x/2x, 실패 0x. 인터랙티브로 한 번에 한 추측씩 진행.
- 슬롯: 심볼 A,B,C,D,7 각 릴 균등. 777=10x, 같은 심볼 3개=5x, 같은 심볼 2개=1.5x, 그 외 0x.
- 바카라: 표준 드로우 규칙(네추럴 8/9 즉시 종료, Player 0~5 드로우, Banker 표준 3rd 카드 규칙), 배당 Player 1:1(수령 2x), Banker 1:1-커미션(수령 1.95x), Tie 8:1. 카드 공개 애니메이션 포함.

## 보정(옵션)
- 카지노 리스크 보정: 최소 베팅 이상일 때 카지노 쪽으로 승률 가중
- 유저 확률 보정: 최대 베팅 이하일 때 플레이어 쪽으로 승률 가중
- 관리자 페이지의 게임 세부 설정에서 게임별로 조정

## 네트워크 안내
- 같은 PC: `localhost:8000`
- 같은 네트워크의 다른 PC: `http://<서버IP>:8000` (방화벽에서 8000 포트 허용 필요)
