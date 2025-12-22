# Code audit summary

## Findings

1. **Adjustment deletion is unauthenticated**: `DELETE /adjustments/{adjustment_id}` lacks the `require_admin` dependency, letting any caller erase financial adjustments and alter profit totals without authorization. This endpoint contrasts with creation, which is admin-protected. 【F:server/main.py†L928-L972】
2. **Horse sessions ignore betting limits and maintenance**: The horse session lifecycle (`/api/horse/session/create` and `/api/horse/session/lock`) never loads `GameSetting` or global limits, so bets can exceed configured min/max or proceed during maintenance, unlike other games that call `enforce_bet_limits`. 【F:server/main.py†L1648-L1709】【F:server/main.py†L1712-L1760】
3. **In-memory session bookkeeping can strand balances after restarts**: Slot, baccarat, and horse starts deduct balance then store pending state only in process memory. A server crash or restart drops the pending entry, permanently losing the stake with no reconciliation path. Examples: slot start deducts and records in `SLOT_PENDING`, baccarat in `BACCARAT_PENDING`, horse in `HORSE_SESSIONS`. 【F:server/main.py†L1247-L1292】【F:server/main.py†L1346-L1393】【F:server/main.py†L1712-L1756】
4. **Login response exposes the user PIN**: `api_login` serializes `UserItem` including the `pin` field, so clients receive plaintext PINs on every login, leaking a sensitive secret that should never be returned. 【F:server/schemas.py†L161-L207】【F:server/main.py†L903-L918】

## Recommended fixes

- Add `admin=Depends(require_admin)` to `delete_adjustment` to align with creation and prevent unauthorized deletions.
- For horse flows, fetch the `horse` `GameSetting`, enforce global and game bet limits, and honor maintenance flags before debiting balances.
- Persist or resumably reconcile in-flight game state (e.g., DB-backed pending sessions or refunds on startup) so wagers aren’t lost on process failure.
- Remove `pin` from serialized responses (return only token + non-sensitive user fields), and avoid storing plaintext PINs in responses.

## 확률/확률보정 동작 검증

- **기본 RNG 및 RTP 계산**: 슬롯/바카라/업다운 모두 Python `random`(환경 시드 기반)으로 결과를 뽑고, RTP 보정용 최근 RTP는 `get_recent_rtp`가 마지막 100게임(`game_id`별)에서 `sum(payout)/sum(bet)`으로 계산해 `apply_bias`에 전달한다. `target_rtp` 조건이 주어지면 방향에 따라 RTP가 목표보다 높거나 낮을 때만 보정이 시도되므로 의도한 조건 분기가 정상 작동한다. 【F:server/main.py†L2589-L2637】
- **확률보정(JSON rule) 적용 흐름**: `parse_bias_rules`가 문자열/리스트를 JSON으로 파싱하고, `apply_bias`가 우선순위 내림차순으로 1개 규칙만 적용한다. `probability` 값을 실확률로 그대로 사용하고, 조건 미충족 시 건너뛰며, 적용 시 `BIAS_COOLDOWN_STATE`에 쿨다운 타임스탬프를 저장한다. 슬롯/업다운/바카라에서는 게임별 로직 후 `apply_bias`를 호출하고, 결과가 뒤집힐 경우 출력 정보를 일관되게 맞추는 후처리(슬롯 심볼 재조정, 업다운 타깃/힌트 재조정, 바카라 재시뮬레이션)가 수행된다. 【F:server/main.py†L2402-L2503】【F:server/main.py†L1186-L1219】【F:server/main.py†L2321-L2388】
- **기본 적용 규칙 현황**: `ensure_default_game_settings`는 슬롯/바카라에만 기본 하우스 우위 규칙(확률 0.2, 전 구간 베팅 대상)을 넣으며, 업다운/경마에는 기본 규칙이 없다. JSON 필드는 DB에 문자열로 저장되고, 업데이트 시에도 `json.dumps`로 일관되게 직렬화하므로 로드·저장 경로 모두 정상이다. 【F:server/main.py†L280-L355】【F:server/main.py†L3294-L3344】
- **게임별 확률 로직 점검**
  - 슬롯: 3칸 심볼을 균등 난수로 선택(기본 기댓값 약 95% 미만, 별도 RTP 조정 없음). 잭팟 풀은 스핀 시마다 베팅액 비율만큼 적립 후 `jackpot_trigger_percent` 확률로 전액 지급하며, 규칙 적용 시 심볼/배당이 다시 맞춰져 표시되므로 표시/정산 일관성이 유지된다. 【F:server/main.py†L2444-L2503】【F:server/main.py†L2505-L2565】
  - 바카라: 8덱(2벌) 셔플 후 규칙대로 카드 분배, 필요 시 목표 결과에 맞춰 재시뮬레이션해 보정 결과가 실제 패 분배와 일치하도록 한다. 【F:server/main.py†L2641-L2733】
  - 업다운: 타깃 1~100 균등 추출, 베팅 테이블은 최초 0 이하 배당부터 잘라 시도 횟수를 제한해 기대 RTP를 안정화한다. 보정으로 승/패가 뒤집히면 타깃·힌트를 다시 맞춰 표시한다. 【F:server/main.py†L2149-L2206】【F:server/main.py†L2215-L2258】

### 결론
현재 확률 산출과 JSON 기반 보정 파이프라인은 파싱→조건 평가→단일 규칙 적용→결과 표시 일관화까지 정상적으로 연동된다. 기본 설정상 슬롯/바카라만 하우스 우위(확률 20%)가 적용되며, 업다운/경마는 보정 없이 순수 난수로 동작한다. 별도 개선이 필요한 보안/구조적 문제는 상단 “Findings” 항목을 참고. 
