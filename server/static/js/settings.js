const adminSecretInput = document.getElementById("adminSecret");
const adminFeedback = document.getElementById("adminFeedback");
const adminAuthBtn = document.getElementById("adminAuthBtn");
const saveGameSettingsBtn = document.getElementById("saveGameSettings");
const gameSettingsContainer = document.getElementById("gameSettingsContainer");
const gameSettingsFeedback = document.getElementById("gameSettingsFeedback");
const saveGlobalSettingsBtn = document.getElementById("saveGlobalSettings");
const globalMinBetInput = document.getElementById("globalMinBet");
const globalMaxBetInput = document.getElementById("globalMaxBet");
const globalSettingsFeedback = document.getElementById("globalSettingsFeedback");
const termCycleToggle = document.getElementById("termCycleEnabled");
const neutralBgToggle = document.getElementById("neutralBgEnabled");
const settingsGuideCard = document.getElementById("settingsGuideCard");
const ADMIN_SECRET_KEY = "adminSecretCache";

const getStoredSecret = () => sessionStorage.getItem(ADMIN_SECRET_KEY) || "";
const setStoredSecret = (secret) => sessionStorage.setItem(ADMIN_SECRET_KEY, secret || "");
const clearStoredSecret = () => sessionStorage.removeItem(ADMIN_SECRET_KEY);

const getAdminHeader = () => ({
  "admin-secret": adminSecretInput.value || getStoredSecret() || "",
});

const prefillSecret = () => {
  const saved = getStoredSecret();
  if (saved && adminSecretInput) adminSecretInput.value = saved;
};

const showAdminFeedback = (msg, variant = "info") => {
  if (!adminFeedback) return;
  adminFeedback.classList.remove("alert-info", "alert-success", "alert-danger", "d-none");
  adminFeedback.classList.add(`alert-${variant}`);
  adminFeedback.textContent = msg;
};

const BIAS_PRESETS = {
  defensive: [
    { id: "def-1", enabled: true, games: ["slot", "baccarat", "updown"], direction: "house", bet_min: 500, bet_max: 1_000_000_000, probability: 0.1, priority: 5, cooldown_sec: 60 },
  ],
  balanced: [
    { id: "bal-1", enabled: true, games: ["slot", "baccarat", "updown"], direction: "house", bet_min: 1000, bet_max: 1_000_000_000, probability: 0.15, priority: 5, cooldown_sec: 30 },
    { id: "bal-2", enabled: true, games: ["slot", "baccarat", "updown"], direction: "player", bet_min: 1, bet_max: 200, probability: 0.1, priority: 4, cooldown_sec: 30 },
  ],
  aggressive: [
    { id: "agg-1", enabled: true, games: ["slot", "baccarat", "updown"], direction: "house", bet_min: 500, bet_max: 1_000_000_000, probability: 0.25, priority: 8, cooldown_sec: 15 },
    { id: "agg-2", enabled: true, games: ["slot"], direction: "house", streak_win_at_least: 3, probability: 0.3, priority: 9, cooldown_sec: 10 },
  ],
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const validateBiasRules = (rules) => {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((r, idx) => {
      if (typeof r !== "object" || r === null) return null;
      const direction = r.direction === "player" ? "player" : r.direction === "house" ? "house" : null;
      if (!direction) return null;
      const probability = clamp(Number(r.probability ?? r.weight ?? 0), 0, 1);
      if (probability <= 0) return null;
      const bet_min = Number.isFinite(r.bet_min) ? r.bet_min : 0;
      const bet_max = Number.isFinite(r.bet_max) ? r.bet_max : 10 ** 12;
      const target_rtp = Number.isFinite(r.target_rtp) ? clamp(r.target_rtp, 0, 1) : undefined;
      const streak_win_at_least = Number.isFinite(r.streak_win_at_least) ? Math.max(0, r.streak_win_at_least) : 0;
      const streak_lose_at_least = Number.isFinite(r.streak_lose_at_least) ? Math.max(0, r.streak_lose_at_least) : 0;
      const cooldown_sec = Number.isFinite(r.cooldown_sec) ? Math.max(0, r.cooldown_sec) : 0;
      const priority = Number.isFinite(r.priority) ? r.priority : 0;
      const win_multiplier = Number.isFinite(r.win_multiplier) ? Math.max(1, r.win_multiplier) : undefined;
      const games = Array.isArray(r.games) ? r.games : undefined;
      const bet_choices = Array.isArray(r.bet_choices) ? r.bet_choices : undefined;
      return {
        id: r.id || `rule-${idx}`,
        name: r.name,
        enabled: r.enabled !== false,
        direction,
        probability,
        bet_min,
        bet_max,
        target_rtp,
        streak_win_at_least,
        streak_lose_at_least,
        cooldown_sec,
        priority,
        win_multiplier,
        games,
        bet_choices,
      };
    })
    .filter(Boolean);
};

const renderSettings = (settings) => {
  if (!gameSettingsContainer) return;
  gameSettingsContainer.innerHTML = settings
    .map((setting) => {
      const isSlot = setting.game_id === "slot";
      const isBaccarat = setting.game_id === "baccarat";
      const isUpdown = setting.game_id === "updown";
      const biasStr =
        typeof setting.bias_rules === "string"
          ? setting.bias_rules
          : JSON.stringify(setting.bias_rules || []);
      const biasControls = `
        <div class="d-flex flex-wrap gap-2 mt-2">
          <button type="button" class="btn btn-sm btn-outline-secondary bias-preset-btn" data-target="bias_rules_${setting.game_id}" data-preset="defensive">방어형</button>
          <button type="button" class="btn btn-sm btn-outline-secondary bias-preset-btn" data-target="bias_rules_${setting.game_id}" data-preset="balanced">기본</button>
          <button type="button" class="btn btn-sm btn-outline-secondary bias-preset-btn" data-target="bias_rules_${setting.game_id}" data-preset="aggressive">공격형</button>
        </div>
      `;
      const updownBlock = isUpdown
        ? `
          <hr />
          <p class="text-muted mb-2">배당 테이블 (업다운)</p>
          <div class="row g-2">
            ${[1,2,3,4,5,6,7,8,9,10].map((n) => `
              <div class="col-6">
                <label class="form-label" for="updown_payout${n}_${setting.game_id}">${n}번째 시도 적중 배당</label>
                <input type="number" step="0.1" min="0" class="form-control" id="updown_payout${n}_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting['updown_payout'+n]}" />
              </div>
            `).join('')}
          </div>
        `
        : "";
      const slotBlock = isSlot
        ? `
          <hr />
          <p class="text-muted mb-2">배당/애니메이션 (슬롯)</p>
          <div class="mb-2">
            <label class="form-label" for="slot_payout_triple_seven_${setting.game_id}">777 적중 배당</label>
            <input type="number" step="0.1" min="0" class="form-control" id="slot_payout_triple_seven_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_payout_triple_seven}" />
          </div>
          <div class="mb-2">
            <label class="form-label" for="slot_payout_triple_same_${setting.game_id}">같은 심볼 3개 적중 배당</label>
            <input type="number" step="0.1" min="0" class="form-control" id="slot_payout_triple_same_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_payout_triple_same}" />
          </div>
          <div class="mb-3">
            <label class="form-label" for="slot_payout_double_same_${setting.game_id}">같은 심볼 2개 적중 배당</label>
            <input type="number" step="0.1" min="0" class="form-control" id="slot_payout_double_same_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_payout_double_same}" />
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label" for="slot_anim_step_ms_${setting.game_id}">숫자 변경 속도(ms)</label>
              <input type="number" min="10" class="form-control" id="slot_anim_step_ms_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_step_ms}" />
            </div>
            <div class="col-6">
              <label class="form-label" for="slot_anim_stagger_ms_${setting.game_id}">릴 시작 시간 차(ms)</label>
              <input type="number" min="0" class="form-control" id="slot_anim_stagger_ms_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_stagger_ms}" />
            </div>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-4">
              <label class="form-label" for="slot_anim_steps1_${setting.game_id}">1번 스텝수</label>
              <input type="number" min="1" class="form-control" id="slot_anim_steps1_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_steps1}" />
            </div>
            <div class="col-4">
              <label class="form-label" for="slot_anim_steps2_${setting.game_id}">2번 스텝수</label>
              <input type="number" min="1" class="form-control" id="slot_anim_steps2_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_steps2}" />
            </div>
            <div class="col-4">
              <label class="form-label" for="slot_anim_steps3_${setting.game_id}">3번 스텝수</label>
              <input type="number" min="1" class="form-control" id="slot_anim_steps3_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_steps3}" />
            </div>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label" for="slot_anim_extra_prob_${setting.game_id}">랜덤 추가 지연 확률(0~1)</label>
              <input type="number" step="0.01" min="0" max="1" class="form-control" id="slot_anim_extra_prob_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_extra_prob}" />
            </div>
            <div class="col-6">
              <label class="form-label">랜덤 추가 지연 범위(%)</label>
              <div class="input-group">
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_extra_pct_min_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_extra_pct_min * 100}" />
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_extra_pct_max_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_extra_pct_max * 100}" />
              </div>
            </div>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label" for="slot_anim_match_prob_${setting.game_id}">1,2번 릴 매치 시 3번 지연 확률(0~1)</label>
              <input type="number" step="0.01" min="0" max="1" class="form-control" id="slot_anim_match_prob_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_match_prob}" />
            </div>
            <div class="col-6">
              <label class="form-label">매치 지연 범위(%)</label>
              <div class="input-group">
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_match_min_pct_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_match_min_pct * 100}" />
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_match_max_pct_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_match_max_pct * 100}" />
              </div>
            </div>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label">매치(7) 지연 범위(%)</label>
              <div class="input-group">
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_match7_min_pct_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_match7_min_pct * 100}" />
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_match7_max_pct_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_match7_max_pct * 100}" />
              </div>
            </div>
            <div class="col-6">
              <label class="form-label" for="slot_anim_extra25_prob_${setting.game_id}">고정 지연 확률(0~1)</label>
              <input type="number" step="0.01" min="0" max="1" class="form-control" id="slot_anim_extra25_prob_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_extra25_prob}" />
              <div class="mt-2">
                <label class="form-label" for="slot_anim_extra25_pct_${setting.game_id}">고정 지연 배율(%)</label>
                <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_extra25_pct_${setting.game_id}" data-game-id="${setting.game_id}" value="${(setting.slot_anim_extra25_pct * 100).toFixed(1)}" />
              </div>
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label" for="slot_anim_smooth_strength_${setting.game_id}">감속 연출 강도(1=기본)</label>
            <input type="number" step="0.1" min="0.1" class="form-control" id="slot_anim_smooth_strength_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.slot_anim_smooth_strength}" />
            <div class="mt-2">
              <label class="form-label" for="slot_anim_smooth_threshold_${setting.game_id}">감속 연출 발동 기준(%)</label>
              <input type="number" step="0.1" min="0" class="form-control" id="slot_anim_smooth_threshold_${setting.game_id}" data-game-id="${setting.game_id}" value="${(setting.slot_anim_smooth_threshold * 100).toFixed(1)}" />
            </div>
          </div>
          <p class="text-muted mb-2">잭팟 설정</p>
          <div class="form-check form-switch mb-2">
            <input
              class="form-check-input"
              type="checkbox"
              id="jackpot_enabled_${setting.game_id}"
              data-game-id="${setting.game_id}"
              ${setting.jackpot_enabled ? "checked" : ""}
            />
            <label class="form-check-label" for="jackpot_enabled_${setting.game_id}">
              잭팟 활성화
            </label>
          </div>
          <div class="mb-2">
            <label class="form-label" for="jackpot_contrib_percent_${setting.game_id}">잭팟 적립 비율(%)</label>
            <input type="number" step="0.1" min="0" max="100" class="form-control" id="jackpot_contrib_percent_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.jackpot_contrib_percent}" />
          </div>
          <div class="mb-2">
            <label class="form-label" for="jackpot_trigger_percent_${setting.game_id}">잭팟 발동 확률(%)</label>
            <input type="number" step="0.01" min="0" max="100" class="form-control" id="jackpot_trigger_percent_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.jackpot_trigger_percent}" />
          </div>
          <input type="hidden" id="jackpot_pool_${setting.game_id}" value="${setting.jackpot_pool}" />
          <div class="mb-1 text-muted small">현재 잭팟 풀: ${Math.round(setting.jackpot_pool)}</div>
        `
        : "";

      const baccaratBlock = isBaccarat
        ? `
          <hr />
          <p class="text-muted mb-2">배당 테이블 (바카라)</p>
          <div class="mb-2">
            <label class="form-label" for="baccarat_payout_player_${setting.game_id}">플레이어 적중 배당</label>
            <input type="number" step="0.01" min="0" class="form-control" id="baccarat_payout_player_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.baccarat_payout_player}" />
          </div>
          <div class="mb-2">
            <label class="form-label" for="baccarat_payout_banker_${setting.game_id}">뱅커 적중 배당</label>
            <input type="number" step="0.01" min="0" class="form-control" id="baccarat_payout_banker_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.baccarat_payout_banker}" />
          </div>
          <div class="mb-3">
            <label class="form-label" for="baccarat_payout_tie_${setting.game_id}">타이 적중 배당</label>
            <input type="number" step="0.1" min="0" class="form-control" id="baccarat_payout_tie_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.baccarat_payout_tie}" />
          </div>
        `
        : "";

      return `
      <div class="col-md-4">
        <div class="border rounded p-3 h-100">
          <h6 class="mb-3">${setting.game_id.toUpperCase()}</h6>
          <input type="hidden" class="game-setting-toggle" id="risk_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.risk_enabled ? "1" : "0"}" />
          <input type="hidden" class="game-setting-threshold" id="threshold_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.risk_threshold}" />
          <input type="hidden" class="game-setting-advantage" id="advantage_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.casino_advantage_percent}" />
          <input type="hidden" class="game-setting-assist-toggle" id="assist_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.assist_enabled ? "1" : "0"}" />
          <input type="hidden" class="game-setting-assist-threshold" id="assist_threshold_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.assist_max_bet}" />
          <input type="hidden" class="game-setting-assist-advantage" id="assist_advantage_${setting.game_id}" data-game-id="${setting.game_id}" value="${setting.player_advantage_percent}" />
          <div class="row mb-3">
            <div class="col-6">
              <label class="form-label" for="min_bet_${setting.game_id}">최소 베팅 한도</label>
              <input
                type="number"
                class="form-control"
                id="min_bet_${setting.game_id}"
                data-game-id="${setting.game_id}"
                value="${setting.min_bet}"
                min="1"
              />
            </div>
            <div class="col-6">
              <label class="form-label" for="max_bet_${setting.game_id}">최대 베팅 한도</label>
              <input
                type="number"
                class="form-control"
                id="max_bet_${setting.game_id}"
                data-game-id="${setting.game_id}"
                value="${setting.max_bet}"
                min="1"
              />
            </div>
          </div>
          <div class="form-check form-switch mb-3">
            <input
              class="form-check-input"
              type="checkbox"
              id="maintenance_${setting.game_id}"
              data-game-id="${setting.game_id}"
              ${setting.maintenance_mode ? "checked" : ""}
            />
            <label class="form-check-label" for="maintenance_${setting.game_id}">
              게임 상태 (꺼짐=운영 / 켜짐=중지)
            </label>
          </div>
          <div class="mb-3">
            <label class="form-label" for="bias_rules_${setting.game_id}">결과 보정 규칙(JSON)</label>
            <textarea class="form-control" rows="4" id="bias_rules_${setting.game_id}" data-game-id="${setting.game_id}" placeholder='[{"direction":"house","bet_min":1000,"bet_max":99999,"probability":0.2}]'>${biasStr || "[]"}</textarea>
            <div class="form-text">
              예) {"direction":"house","probability":0.2,"bet_min":1000} | 필드: direction(house|player), probability(0~1), bet_min/max, bet_choices(["player"]), streak_win_at_least/lose_at_least, target_rtp(0~1), cooldown_sec, priority, win_multiplier, games(["slot","baccarat","updown"]), enabled(false로 비활성)
            </div>
            ${biasControls}
          </div>
          ${slotBlock}
          ${baccaratBlock}
          ${updownBlock}
        </div>
      </div>
    `;
    })
    .join("");
  attachBiasPresetHandlers();
};

const attachBiasPresetHandlers = () => {
  document.querySelectorAll(".bias-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetKey = btn.dataset.preset;
      const target = btn.dataset.target;
      const preset = BIAS_PRESETS[presetKey];
      const el = document.getElementById(target);
      if (preset && el) {
        el.value = JSON.stringify(preset, null, 2);
      }
    });
  });
};

const collectGameSettings = () => {
  const settings = [];
  const gameIds = new Set();
  document.querySelectorAll(".game-setting-toggle").forEach((el) => {
    gameIds.add(el.dataset.gameId);
  });
  const getNumber = (sel, def = 0) => {
    const el = document.querySelector(sel);
    if (!el) return def;
    const val = Number(el.value);
    return Number.isFinite(val) ? val : def;
  };
  const getChecked = (sel) => {
    const el = document.querySelector(sel);
    return !!(el && el.checked);
  };

  gameIds.forEach((gameId) => {
    const isSlot = gameId === "slot";
    const isBaccarat = gameId === "baccarat";
    const isUpdown = gameId === "updown";
    const riskEnabled = getChecked(`#risk_${gameId}`);
    const riskThreshold = getNumber(`#threshold_${gameId}`, 0);
    const casinoAdvantage = getNumber(`#advantage_${gameId}`, 0);
    const assistEnabled = getChecked(`#assist_${gameId}`);
    const assistThreshold = getNumber(`#assist_threshold_${gameId}`, 0);
    const playerAdvantage = getNumber(`#assist_advantage_${gameId}`, 0);
    const minBet = getNumber(`#min_bet_${gameId}`, 1);
    const maxBet = getNumber(`#max_bet_${gameId}`, 1);
    const maintenance = getChecked(`#maintenance_${gameId}`);
    const slotTripleSeven = isSlot ? getNumber(`#slot_payout_triple_seven_${gameId}`, 10) : 10;
    const slotTripleSame = isSlot ? getNumber(`#slot_payout_triple_same_${gameId}`, 5) : 5;
    const slotDoubleSame = isSlot ? getNumber(`#slot_payout_double_same_${gameId}`, 1.5) : 1.5;
    const baccaratPayoutPlayer = isBaccarat ? getNumber(`#baccarat_payout_player_${gameId}`, 2) : 2;
    const baccaratPayoutBanker = isBaccarat ? getNumber(`#baccarat_payout_banker_${gameId}`, 1.95) : 1.95;
    const baccaratPayoutTie = isBaccarat ? getNumber(`#baccarat_payout_tie_${gameId}`, 8) : 8;
    const jackpotEnabled = isSlot ? getChecked(`#jackpot_enabled_${gameId}`) : false;
    const jackpotContrib = isSlot ? getNumber(`#jackpot_contrib_percent_${gameId}`, 0) : 0;
    const jackpotTrigger = isSlot ? getNumber(`#jackpot_trigger_percent_${gameId}`, 0) : 0;
    const jackpotPool = isSlot ? getNumber(`#jackpot_pool_${gameId}`, 0) : 0;
    const slotAnimStepMs = isSlot ? getNumber(`#slot_anim_step_ms_${gameId}`, 60) : 60;
    const slotAnimStaggerMs = isSlot ? getNumber(`#slot_anim_stagger_ms_${gameId}`, 0) : 0;
    const slotAnimSteps1 = isSlot ? getNumber(`#slot_anim_steps1_${gameId}`, 24) : 24;
    const slotAnimSteps2 = isSlot ? getNumber(`#slot_anim_steps2_${gameId}`, 34) : 34;
    const slotAnimSteps3 = isSlot ? getNumber(`#slot_anim_steps3_${gameId}`, 48) : 48;
    const slotAnimExtraProb = isSlot ? getNumber(`#slot_anim_extra_prob_${gameId}`, 0.2) : 0.2;
    const slotAnimExtraMin = isSlot ? getNumber(`#slot_anim_extra_pct_min_${gameId}`, 0) / 100 : 0;
    const slotAnimExtraMax = isSlot ? getNumber(`#slot_anim_extra_pct_max_${gameId}`, 10) / 100 : 0.1;
    const slotAnimSmooth = isSlot ? getNumber(`#slot_anim_smooth_strength_${gameId}`, 1) : 1;
    const slotAnimMatchProb = isSlot ? getNumber(`#slot_anim_match_prob_${gameId}`, 1) : 1;
    const slotAnimMatchMin = isSlot ? getNumber(`#slot_anim_match_min_pct_${gameId}`, 10) / 100 : 0.1;
    const slotAnimMatchMax = isSlot ? getNumber(`#slot_anim_match_max_pct_${gameId}`, 40) / 100 : 0.4;
    const slotAnimMatch7Min = isSlot ? getNumber(`#slot_anim_match7_min_pct_${gameId}`, 30) / 100 : 0.3;
    const slotAnimMatch7Max = isSlot ? getNumber(`#slot_anim_match7_max_pct_${gameId}`, 60) / 100 : 0.6;
    const slotAnimExtra25Prob = isSlot ? getNumber(`#slot_anim_extra25_prob_${gameId}`, 0.15) : 0.15;
    const slotAnimExtra25Pct = isSlot ? getNumber(`#slot_anim_extra25_pct_${gameId}`, 25) / 100 : 0.25;
    const slotAnimSmoothThreshold = isSlot ? getNumber(`#slot_anim_smooth_threshold_${gameId}`, 25) / 100 : 0.25;
    let biasRules = [];
    const biasEl = document.querySelector(`#bias_rules_${gameId}`);
    if (biasEl && biasEl.value) {
      try {
        const parsed = JSON.parse(biasEl.value);
        biasRules = validateBiasRules(parsed);
      } catch (e) {
        throw new Error(`보정 규칙 JSON이 잘못되었습니다. (${gameId})`);
      }
    }
    const updownPayouts = isUpdown
      ? [
          getNumber(`#updown_payout1_${gameId}`, 7),
          getNumber(`#updown_payout2_${gameId}`, 5),
          getNumber(`#updown_payout3_${gameId}`, 4),
          getNumber(`#updown_payout4_${gameId}`, 3),
          getNumber(`#updown_payout5_${gameId}`, 2),
          getNumber(`#updown_payout6_${gameId}`, 0),
          getNumber(`#updown_payout7_${gameId}`, 0),
          getNumber(`#updown_payout8_${gameId}`, 0),
          getNumber(`#updown_payout9_${gameId}`, 0),
          getNumber(`#updown_payout10_${gameId}`, 0),
        ]
      : [7, 5, 4, 3, 2, 0, 0, 0, 0, 0];
    settings.push({
      game_id: gameId,
      risk_enabled: !!riskEnabled,
      risk_threshold: riskThreshold,
      casino_advantage_percent: casinoAdvantage,
      assist_enabled: !!assistEnabled,
      assist_max_bet: assistThreshold,
      player_advantage_percent: playerAdvantage,
      min_bet: minBet,
      max_bet: maxBet,
      maintenance_mode: !!maintenance,
      slot_payout_triple_seven: slotTripleSeven,
      slot_payout_triple_same: slotTripleSame,
      slot_payout_double_same: slotDoubleSame,
      baccarat_payout_player: baccaratPayoutPlayer,
      baccarat_payout_banker: baccaratPayoutBanker,
      baccarat_payout_tie: baccaratPayoutTie,
      jackpot_enabled: !!jackpotEnabled,
      jackpot_contrib_percent: jackpotContrib,
      jackpot_trigger_percent: jackpotTrigger,
      jackpot_pool: jackpotPool,
      updown_payout1: updownPayouts[0],
      updown_payout2: updownPayouts[1],
      updown_payout3: updownPayouts[2],
      updown_payout4: updownPayouts[3],
      updown_payout5: updownPayouts[4],
      updown_payout6: isUpdown ? getNumber(`#updown_payout6_${gameId}`, 0) : 0,
      updown_payout7: isUpdown ? getNumber(`#updown_payout7_${gameId}`, 0) : 0,
      updown_payout8: isUpdown ? getNumber(`#updown_payout8_${gameId}`, 0) : 0,
      updown_payout9: isUpdown ? getNumber(`#updown_payout9_${gameId}`, 0) : 0,
      updown_payout10: isUpdown ? getNumber(`#updown_payout10_${gameId}`, 0) : 0,
      slot_anim_step_ms: slotAnimStepMs,
      slot_anim_steps1: slotAnimSteps1,
      slot_anim_steps2: slotAnimSteps2,
      slot_anim_steps3: slotAnimSteps3,
      slot_anim_stagger_ms: slotAnimStaggerMs,
      slot_anim_extra_prob: slotAnimExtraProb,
      slot_anim_extra_pct_min: slotAnimExtraMin,
      slot_anim_extra_pct_max: slotAnimExtraMax,
      slot_anim_smooth_strength: slotAnimSmooth,
      slot_anim_match_prob: slotAnimMatchProb,
      slot_anim_match_min_pct: slotAnimMatchMin,
      slot_anim_match_max_pct: slotAnimMatchMax,
      slot_anim_match7_min_pct: slotAnimMatch7Min,
      slot_anim_match7_max_pct: slotAnimMatch7Max,
      slot_anim_extra25_prob: slotAnimExtra25Prob,
      slot_anim_extra25_pct: slotAnimExtra25Pct,
      slot_anim_smooth_threshold: slotAnimSmoothThreshold,
      bias_rules: biasRules,
    });
  });
  return settings;
};

const fetchGlobalSettings = async () => {
  if (globalSettingsFeedback) {
    globalSettingsFeedback.classList.remove("d-none", "alert-danger");
    globalSettingsFeedback.classList.add("alert-info");
    globalSettingsFeedback.textContent = "전역 설정 불러오는 중...";
  }
  const res = await fetch("/global_settings", { headers: getAdminHeader() });
  if (res.status === 401) throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  if (!res.ok) throw new Error("전역 설정을 불러오지 못했습니다.");
  const data = await res.json();
  if (globalMinBetInput) globalMinBetInput.value = data.min_bet;
  if (globalMaxBetInput) globalMaxBetInput.value = data.max_bet;
  if (termCycleToggle) termCycleToggle.checked = !!data.term_cycle_enabled;
  if (neutralBgToggle) neutralBgToggle.checked = !!data.neutral_bg_enabled;
  if (globalSettingsFeedback) {
    globalSettingsFeedback.classList.remove("alert-info", "alert-danger");
    globalSettingsFeedback.classList.add("alert-success");
    globalSettingsFeedback.textContent = "전역 설정을 불러왔습니다.";
  }
  if (saveGlobalSettingsBtn) saveGlobalSettingsBtn.disabled = false;
  if (settingsGuideCard) settingsGuideCard.classList.remove("d-none");
};

const saveGlobalSettings = async () => {
  const min_bet = Number(globalMinBetInput?.value || 1);
  const max_bet = Number(globalMaxBetInput?.value || 1);
  const term_cycle_enabled = !!termCycleToggle?.checked;
  const neutral_bg_enabled = !!neutralBgToggle?.checked;
  if (globalSettingsFeedback) {
    globalSettingsFeedback.classList.remove("d-none", "alert-danger", "alert-success");
    globalSettingsFeedback.classList.add("alert-info");
    globalSettingsFeedback.textContent = "전역 설정 저장 중...";
  }
  const res = await fetch("/global_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminHeader() },
    body: JSON.stringify({ min_bet, max_bet, term_cycle_enabled, neutral_bg_enabled }),
  });
  if (res.status === 401) throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  if (!res.ok) throw new Error("전역 설정 저장 실패");
  if (globalSettingsFeedback) {
    globalSettingsFeedback.classList.remove("alert-info", "alert-danger");
    globalSettingsFeedback.classList.add("alert-success");
    globalSettingsFeedback.textContent = "전역 설정 저장 완료";
  }
};

const fetchGameSettings = async () => {
  if (gameSettingsFeedback) {
    gameSettingsFeedback.classList.remove("d-none");
    gameSettingsFeedback.classList.replace("alert-danger", "alert-info");
    gameSettingsFeedback.textContent = "설정을 불러오는 중...";
  }
  const res = await fetch("/game_settings", {
    headers: getAdminHeader(),
  });
  if (res.status === 401) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }
  if (!res.ok) {
    throw new Error("설정을 불러오지 못했습니다.");
  }
  const data = await res.json();
  renderSettings(data);
  if (gameSettingsFeedback) {
    gameSettingsFeedback.classList.remove("d-none");
    gameSettingsFeedback.classList.remove("alert-danger");
    gameSettingsFeedback.classList.add("alert-success");
    gameSettingsFeedback.textContent = "설정을 불러왔습니다.";
  }
  if (saveGameSettingsBtn) saveGameSettingsBtn.disabled = false;
  if (settingsGuideCard) settingsGuideCard.classList.remove("d-none");
  showAdminFeedback("인증 및 불러오기 완료", "success");
};

const saveSettings = async () => {
  const settings = collectGameSettings();
  if (gameSettingsFeedback) {
    gameSettingsFeedback.classList.remove("d-none");
    gameSettingsFeedback.classList.remove("alert-danger", "alert-success");
    gameSettingsFeedback.classList.add("alert-info");
    gameSettingsFeedback.textContent = "저장 중...";
  }
  const res = await fetch("/game_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminHeader() },
    body: JSON.stringify({ settings }),
  });
  if (res.status === 401) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }
  if (!res.ok) throw new Error("저장 실패");
  if (gameSettingsFeedback) {
    gameSettingsFeedback.classList.remove("alert-info", "alert-danger");
    gameSettingsFeedback.classList.add("alert-success");
    gameSettingsFeedback.textContent = "저장 완료";
  }
  showAdminFeedback("설정 저장 완료", "success");
};

if (adminAuthBtn) {
  adminAuthBtn.addEventListener("click", () => {
    const secret = adminSecretInput.value.trim();
    if (!secret) {
      showAdminFeedback("관리자 비밀번호를 입력하세요.", "danger");
      return;
    }
    setStoredSecret(secret);
    Promise.all([fetchGameSettings(), fetchGlobalSettings()]).catch((e) =>
      showAdminFeedback(e.message, "danger")
    );
  });
}

if (saveGameSettingsBtn) {
  saveGameSettingsBtn.addEventListener("click", () => {
    saveSettings().catch((e) => showAdminFeedback(e.message, "danger"));
  });
}

if (saveGlobalSettingsBtn) {
  saveGlobalSettingsBtn.addEventListener("click", () => {
    saveGlobalSettings().catch((e) => showAdminFeedback(e.message, "danger"));
  });
}

prefillSecret();
window.addEventListener("beforeunload", clearStoredSecret);
