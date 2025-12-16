# Virtual Probability Simulation

계정(이름+PIN) 기반 가상 포인트 카지노 시뮬레이터입니다. 학생은 로그인 후 베팅·게임을 진행하고, 서버가 자동으로 포인트를 증감합니다. 관리자는 계정/포인트 관리와 게임 보정 설정을 담당합니다.

```bash
pip install -r requirements.txt
```

## 실행/접속
```bash
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
# 관리자 비밀번호 기본값: adminpass (환경변수 ADMIN_SECRET로 변경)
# 토큰 서명 키: TOKEN_SECRET (기본 dev-secret)
```
- 관리자 페이지: `http://localhost:8000/admin`
- 게임 설정: `http://localhost:8000/admin/settings`
- 유저 페이지: `http://localhost:8000/game`
- 경마 검증/리플레이: `http://localhost:8000/horse-verify`

## 네트워크/접속 시나리오별 가이드
> 서버(uvicorn)는 메인 PC 1대에서만 실행하고, 포트는 8000을 그대로 사용한다고 가정합니다.

1) **같은 PC에서만 사용**  
   - `http://localhost:8000/admin`, `http://localhost:8000/game` 접속.

2) **공유기/사내 LAN에 여러 PC 연결**  
   - 메인 PC에서 `ipconfig`(Windows) 또는 `ifconfig`/`ip a`(macOS/Linux)로 IPv4 확인(보통 192.168.x.x).  
   - 서브 PC 브라우저: `http://<메인PC-IP>:8000/admin`(관리), `http://<메인PC-IP>:8000/game`(게임).  
   - 방화벽에서 포트 8000 인바운드를 “개인/사설 네트워크”에 허용.

3) **모바일 핫스팟(iPhone/Android)으로 여러 PC 연결**  
   - 핫스팟을 켜고 메인·서브 PC 모두 같은 SSID에 연결.  
   - 메인 PC IP 확인: Windows `ipconfig` → “무선 LAN 어댑터 Wi‑Fi” IPv4(보통 172.20.10.x), macOS/Linux는 `ifconfig`/`ip a`.  
   - 서브 PC/폰에서 `http://<해당 IP>:8000/admin` / `http://<해당 IP>:8000/game`.  
   - 핫스팟을 껐다 켜면 IP가 바뀌므로 매번 `ipconfig`로 재확인.  
   - Windows 방화벽에서 8000 인바운드 허용 필요 시 추가.

4) **관리 페이지는 메인 PC에서만 열고 싶을 때**  
   - `ADMIN_SECRET`를 강하게 설정하고 공유 금지.  
   - 네트워크 장비에서 IP 필터링 가능하면 `/admin` 접근을 메인 PC IP만 허용(선택).  
   - 다른 PC는 `http://<메인PC-IP>:8000/game`만 안내.

5) **계정·포인트 흐름**  
   - 계정 생성/포인트 조정: 메인 PC에서 `/admin` → “관리자 비밀번호” 입력 후 사용.  
   - 게임: 서브 PC가 `/game`에서 로그인→플레이→결과/포인트가 메인 DB에 바로 적재.  
   - 경품 교환 시 자동 차감 기능은 없음. 교환 후 `/admin`에서 해당 사용자에 “±포인트”로 차감.

6) **환경변수 권장값**  
   - `ADMIN_SECRET`: 관리자 비밀번호(필수 변경).  
   - `TOKEN_SECRET`: 토큰 서명 키(원격 접속 시 변경 추천).  
   - 설정 예: `set ADMIN_SECRET=강한패스워드`(Windows CMD) / `export ADMIN_SECRET=강한패스워드`(bash/zsh).

## 프로젝트 구조
- `server/` FastAPI 백엔드
  - `main.py` 엔트리(라우팅·정적·템플릿)
  - `database.py` DB 세션/초기화
  - `models.py` SQLAlchemy 모델
  - `schemas.py` Pydantic 스키마
  - `static/js/admin.js`, `static/js/settings.js`, `static/css/admin.css`
  - `templates/admin.html`, `templates/settings.html`
- `webclient/` 게임 클라이언트 정적 자원
  - `index.html` 부트스트랩 기반 화면
  - `static/js/app.js` 게임 로직 + 무한 슬라이더 제어
  - `static/css/style.css` 스타일
  - `static/img/` 게임 카드 아이콘
  - `react/` React+TS 무한 캐러셀 참고용(현재 번들 미사용)
- 루트 스크립트: `run_server.sh`, `run_server.bat`
- DB: `bet_simulator.db` (SQLite)

## 사용자 흐름 (웹 클라이언트)
1) 로그인: 이름 + 4자리 PIN → Bearer 토큰 발급·저장
2) 대시보드: 현재 포인트, 게임 카드(업다운/슬롯/바카라 + 더미 2종) 슬라이더 노출
3) 게임 진행:
   - 업다운: 베팅 → 최대 5회 숫자 입력/판정 → 최종 배당·잔액 표시
   - 슬롯: 스핀 애니메이션 → 결과·배당·잔액 표시
   - 바카라: 카드 공개 애니메이션 → 결과·배당·잔액 표시
4) 포인트 증감은 서버가 즉시 계산되어 화면에 반영

## 게임 카드 슬라이더 (무한 마키)
- `app.js`의 `setupGameMarquee`: 카드 배열을 2배 복제한 flex 트랙을 `translateX`로 이동하며, 트랙 길이 기준으로 오프셋을 래핑해 시각적 점프 없이 이어짐.
- hover 시 즉시 정지, 영역을 벗어나면 지연 후 재개.
- 영역 내 휠 입력은 세로 스크롤 대신 가로 이동으로 변환하고, 한 번 휠을 돌리면 영역 밖으로 나갔다 다시 들어올 때까지 자동 이동을 멈춤.
- 게임을 선택해 진행하는 동안 자동 이동을 정지시켜 플레이에 집중 가능.
- 클릭/키보드 포커스/버튼 등 카드 내 인터랙션은 그대로 동작.

## 관리자 기능
- 헤더 `admin-secret: <비밀번호>` (기본 `adminpass`)
- 계정 생성/목록/삭제
- 포인트 조정(충전/차감) 및 트랜잭션 로그 조회(유형, 게임, 금액, 잔액 변동, 메모, 시간)
- 게임 보정 설정(카지노 우세/유저 우세, 최소·최대 베팅, 가중치%)

## 주요 API
- 인증
  - `POST /api/login {name, pin}` → `{token, user}`
  - `GET /api/me` → 현재 유저 정보
- 게임
  - `POST /api/game/updown/start?bet_amount=` 업다운 시작
  - `POST /api/game/updown/guess {guess}` 업다운 판정(진행/최종)
  - `POST /api/game/slot {bet_amount}`
  - `POST /api/game/baccarat {bet_amount, bet_choice}`
  - 공통 응답: `{result, payout_multiplier, payout_amount, delta, balance, detail}` (`result: pending`이면 진행 중)
- 관리자 (헤더 `admin-secret`)
  - `POST /api/admin/users {name, pin, initial_balance}`
  - `GET /api/admin/users?search=`
  - `POST /api/admin/users/{id}/adjust_balance {delta, reason}`
  - `DELETE /api/admin/users/{id}`
  - `GET /api/admin/users/{id}/transactions?limit=20`
  - `GET /game_settings`, `POST /game_settings {settings: [...]}` (게임 보정)

## DB 스키마 (SQLite `bet_simulator.db`)
- `users(id, name, pin, balance, created_at, updated_at)`
- `transactions(id, user_id, type(charge|deduct|game), game_type, amount, before_balance, after_balance, description, created_at)`
- `game_results(id, user_id, game_id, bet_amount, bet_choice, result, payout_multiplier, payout_amount, detail, timestamp)`
- `game_settings(game_id unique, risk_enabled, risk_threshold, casino_advantage_percent, assist_enabled, assist_max_bet, player_advantage_percent, updated_at)`

## 게임별 상세 규칙/계산

### 업다운 (Up&Down 숫자 맞히기)
- 시작: `POST /api/game/updown/start?bet_amount=` → 베팅 차감, 서버가 `target ∈ [1,100]` 설정 후 세션 저장.
- 배당 시퀀스: 게임 설정의 `updown_payout1~10`을 첫 번째 0 이하가 나오기 전까지만 사용. 기본값 [7,5,4,3,2] → 최대 5회 시도.
- 판정: `POST /api/game/updown/guess {guess}`마다 시도 수+1, `hint`는 UP/DOWN/CORRECT. 맞히면 시도 번호에 따른 배당, 전부 실패 시 0배.
- 응답 detail: `target, guesses[], attempts, max_attempts, hint`, `payout_multiplier`, `delta`, `balance`.

### 슬롯 머신
- 시작: `POST /api/game/slot {bet_amount}`. 베팅 선차감.
- 심볼: A,B,C,D,7 균등 랜덤 3개.
- 배당:
  - 777 세 개: `slot_payout_triple_seven` (기본 10.0x)
  - 같은 심볼 3개: `slot_payout_triple_same` (기본 5.0x)
  - 같은 심볼 2개: `slot_payout_double_same` (기본 1.5x)
  - 나머지 0x
- 잭팟(옵션): `jackpot_enabled`일 때 베팅의 `jackpot_contrib_percent%` 적립, `jackpot_trigger_percent%` 확률로 풀 전체 지급 후 0 초기화. 잭팟 시 `payout_amount_override=풀 금액`.
- detail: `symbols[3], jackpot_win, jackpot_amount, pool`.

### 바카라
- 간단 호출: `POST /api/game/baccarat {bet_amount, bet_choice(player|banker|tie)}` (세션 플로우도 지원).
- 덱: 2벌(104장) 셔플, 카드 값 A=1, 2~9=숫자, 10/J/Q/K=0.
- 드로우: 내추럴(8/9)이 아니면 표준 3rd-card 룰 적용(플레이어 ≤5 드로우, 뱅커는 플레이어 3번째 카드 값에 따른 조건).
- 결과: player/banker/tie. 최대 200회 시뮬해 목표 결과(바이어스용)가 있으면 그 결과가 나올 때까지 반복.
- 배당 기본값: Player 2.0x 수령, Banker 1.95x 수령, Tie 8.0x 수령(틀리면 0). detail: `player_hand[], banker_hand[], player_value, banker_value, outcome`.

### 경마 (Horse Racing)
- 흐름: 세션 생성→말 선택→시작(베팅 차감)→서버 시뮬→타임라인/결과 반환. 승리 시 3.0x, 패배 0x.
- 트랙/시간: 길이 1000m, 랩 2, dt=1/60s, 타임라인 샘플 0.2s.
- 스탯/특성: speed/accel/stamina/stability/cornering(0~100) + 숨은 특성(heat_resist∈[0.9,1.2], recover_rate∈[0.85,1.1], luck∈[0.8,1.2], tactic front/stalker/closer), 컨디션 F는 안정성 기반 로그정규.
- 환경: 바람 N(0,0.08)→windFactor=max(0.2,1+wind), 경사 프로파일(0~0.25:+0%, 0.25~0.5:+1%, 0.5~0.75:-0.8%, 0.75~1:+0%).
- 주요 수식/동역학:
  - 정규화: `Sn=speed/100`, `An=accel/100`, `Tn=stamina/100`, `Cn=cornering/100`
  - 효율: `T_eff=1-exp(-K_T*Tn)`, `C_eff=1-exp(-K_C*Cn)`, `R_eff=1-exp(-K_R*stability/100)`
  - 컨디션: `sigma = sigma_min + (sigma_max-sigma_min)*(1-R_eff)`, `F=exp(N(0,sigma^2))`
  - 전술 목표속도(회복 기준): `progress = x/(2L)`, `Vcap_base=V0+V1*sqrt(Sn)`  
    front: `Vcap_base*0.9` (progress>0.65 ⇒ *0.92), stalker: `Vcap_base*0.85` (progress>0.5 ⇒ *1.05), closer: `Vcap_base*(0.75+0.15*progress)`
  - 포화/출력: `Vcap=Vcap_base`, `eta=1.8+1.2*(1-An)`, `sat=max(0,1-(v/Vcap)^eta)`  
    `Pmax=P0+P1*Sn`, `P=Pmax*F*(0.35+0.65*E)`, `power_push=P*sat`
  - 항력/상호작용: `drag=(D0*v^2 + D1*v^3)*windFactor`, 경사 `drag+=9.8*slope*v/Vref`, 슬립스트림(거리<20m) → `drag*=0.9`, `H+=0.01` (+로그)
  - 에너지/열:  
    `dE=[e0*(1+K_SD*Sn)*(v/Vref)^gamma + e1*isCorner*(v/Vref)^gamma2*(1-0.5*T_eff)]*dt`  
    `dH=H0*isCorner*(v/Vref)^2*(1-C_eff)*(1+HT_TWEAK*(1-T_eff))*dt`  
    느릴 때(v<target_v*0.6) → `dE,dH *= 0.8*recover_rate`; 갱신 `E=clamp(E-dE,0,1)`, `H=max(0, H + dH - Hdecay*H*dt*heat_resist)`  
    과열 캡 `heat_cap=max(0.6,1-0.2*heat_resist)` 넘으면 `power_push*=0.75`
  - 코너: `isCorner`는 lapFrac∈[0.4,0.5)∪[0.9,1]  
    `a_lat_max=ALAT0+ALAT1*C_eff^1.1`, `a_lat_eff=a_lat_max/(1+H)`, `v_corner_max=sqrt(a_lat_eff/max(kappa,eps))` (`kappa=KAPPA` in corner)  
    제동 `corner_brake = (v>v_corner_max) ? Bc*(v-v_corner_max)^2 : 0`  
    코너 미스: `excess=(v - v_corner_max)/v_corner_max`; excess>0.25 → `H+=0.15*excess`, `v*=(1-0.08*excess)` (이벤트 로그)
  - 이벤트(포아송):  
    `lambda_stumble=0.003*(1+(1-R_eff))` (직전 STUMBLE시 동일 배수 곱), 발동확률 `p=1-exp(-λ*dt)` → `power_push*=(1-mag)`, `v*=(1-0.5*mag)`  
    BOOST: `lambda=0.0025*luck` → `power_push*=(1+mag)`  
    CONTACT: 거리<6m, `lambda=0.02` → `v*=(1-hit)`  
    SLIP/CONTACT/STUMBLE/BOOST/CORNER_MISS/HEATCAP 모두 `{t, horse_id, kind, mag, note}` 로 기록
  - 오버드라이브: `w_od=smoothstep(0.7,0.9,progress)`, `h_ratio=H/(H+OD_H_HALF)`, `spurt_gate=clamp(0.35, 0.7+0.3*E-0.2*h_ratio)`  
    `iod = w_od * clamp(0.35+0.65*T_eff - 0.3*(1-R_eff)) * smoothstep(0.12,0.3,E) * (1 - exp(-K_A*An)) * spurt_gate`  
    `eta_eff=max(OD_ETA_MIN, eta*(1-OD_PHI*iod))`, `sat_eff=max(0,1-(v/Vcap)^eta_eff)`  
    `power_push *= (sat_eff/sat if sat>1e-6 else 1); power_push *= (1+OD_ALPHA*iod)`  
    `dE += OD_LAMBDA*iod*(v/Vref)^OD_RHO*dt`, `dH *= (1+OD_MU*iod)`
  - 적분: `a = power_push - drag - corner_brake`; `v = max(0, v + a*dt)`, `x += v*dt`; `x>=2L` → finish_time=t
- 결과/표시: 타임라인 `positions/speeds/energy/heat`, 이벤트 로그, 말별 컨디션·스탯, 우승/선택 말 강조(우승 초록, 선택 노랑). 프런트 애니메이션 기본 4x 속도.
- 로그/결과: 타임라인 `positions/speeds/energy/heat`, 이벤트 로그, 말별 컨디션·스탯·우승 말, 선택 말 강조(클라에서 선택 말 노랑, 우승 말 초록).

## 추가 참고 (React 샘플)
- `webclient/react/InfiniteGameCarousel.tsx`: React + TS + Tailwind 기반 무한 캐러셀 참고용
- `webclient/react/ExampleCarouselUsage.tsx`: 샘플 사용 코드
