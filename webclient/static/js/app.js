const API = {
  login: "/api/login",
  me: "/api/me",
  updown: "/api/game/updown",
  updownStart: "/api/game/updown/start",
  updownGuess: "/api/game/updown/guess",
  slot: "/api/game/slot",
  slotStart: "/api/game/slot/start",
  slotResolve: "/api/game/slot/resolve",
  baccarat: "/api/game/baccarat",
  baccaratStart: "/api/game/baccarat/start",
  baccaratResolve: "/api/game/baccarat/resolve",
  horseCreate: "/api/horse/session/create",
  horseLock: "/api/horse/session/lock",
  horseHeartbeat: "/api/horse/session/heartbeat",
  horseFinish: "/api/horse/session/finish",
  horseForfeit: "/api/horse/session/forfeit",
};

const withMarqueeControl = (cb) => {
  const ctrl = typeof window !== "undefined" ? window.__gameMarqueeControl : null;
  if (ctrl) cb(ctrl);
};

const setGameMarqueePaused = (value) =>
  withMarqueeControl((ctrl) => {
    if (typeof ctrl.setGameFreeze === "function") ctrl.setGameFreeze(value);
  });

const auth = {
  token: null,
  load() {
    this.token = localStorage.getItem("authToken");
  },
  save(token) {
    this.token = token;
    localStorage.setItem("authToken", token);
  },
  clear() {
    this.token = null;
    localStorage.removeItem("authToken");
  },
  headers() {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  },
};

auth.load();

const loginForm = document.getElementById("loginForm");
const loginFeedback = document.getElementById("loginFeedback");
const authCard = document.getElementById("authCard");
const appArea = document.getElementById("appArea");
const userNameLabel = document.getElementById("userNameLabel");
const balanceLabel = document.getElementById("balanceLabel");
const logoutBtn = document.getElementById("logoutBtn");
const refreshBalanceBtn = document.getElementById("refreshBalance");
let gameSelectButtons = document.querySelectorAll(".game-select");
const selectedGameTitle = document.getElementById("selectedGameTitle");
const baccaratExtra = document.getElementById("baccaratExtra");
const betAmountInput = document.getElementById("betAmount");
const betChoiceBaccarat = document.getElementById("betChoiceBaccarat");
const playSelectedBtn = document.getElementById("playSelected");
const gameBoard = document.getElementById("gameBoard");
const betCard = document.getElementById("betCard");
const playCard = document.getElementById("playCard");
const playCardTitle = playCard ? playCard.querySelector(".card-title") : null;
const selectedGameDetail = document.getElementById("selectedGameDetail");

let currentGame = null;
let updownInProgress = false;
let slotSessionId = null;
let baccaratSessionId = null;
let horseSessionId = null;
let horseSessionSeed = null;
let horseSessionHorses = [];
let horseHeartbeatTimer = null;
let horseSessionStatus = "idle"; // idle | running
let selectionLocked = false;
let slotAnimating = false;
let baccaratAnimating = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isGameLocked = () =>
  selectionLocked ||
  updownInProgress ||
  !!slotSessionId ||
  !!baccaratSessionId ||
  slotAnimating ||
  baccaratAnimating;

const updateGameLock = () => {
  document.querySelectorAll(".game-select").forEach((btn) => {
    btn.disabled = isGameLocked();
  });
};

const getBetAmount = () => {
  const inline = document.getElementById("inlineBetAmount");
  if (inline) return Number(inline.value);
  if (betAmountInput) return Number(betAmountInput.value);
  return 0;
};

const getBaccaratChoice = () => {
  const inline = document.getElementById("inlineBetChoiceBaccarat");
  if (inline) return inline.value;
  if (betChoiceBaccarat) return betChoiceBaccarat.value;
  return "player";
};

const setPlayTitle = (text) => {
  if (playCardTitle) playCardTitle.textContent = text;
};

const setUpdownContent = (html) => {
  const target = document.getElementById("updownContent");
  if (target) target.innerHTML = html;
  else gameBoard.innerHTML = html;
};

const handleGameSelectClick = (btn) => {
  if (isGameLocked()) return;
  const gameId = btn.dataset.game;
  const isGuide = gameId === "dummy2";
  if (!isGuide) setGameMarqueePaused(true); // 실제 게임 선택 시에만 정지
  currentGame = gameId;
  updownInProgress = false;
  updateGameLock();
  const card = btn.closest(".card");
  const titleEl = card ? card.querySelector(".card-title") : null;
  const descEl = card ? card.querySelector("p.text-muted") : null;
  const gameName = titleEl ? titleEl.textContent.trim() : btn.textContent.trim();
  selectedGameTitle.textContent = gameName;
  setPlayTitle(gameName);
  if (baccaratExtra) baccaratExtra.classList.toggle("d-none", currentGame !== "baccarat");
  if (selectedGameDetail) {
    if (descEl && descEl.textContent.trim()) {
      selectedGameDetail.textContent = descEl.textContent.trim();
    } else {
      const detailMap = {
        updown: "1~100 숫자 맞히기, 최대 10회 시도",
        slot: "3릴 슬롯, 777=10x / 같은 심볼=5x/1.5x",
        baccarat: "플레이어/뱅커/타이 중 선택",
        horse: "4마리 경주, 맵은 시작 직전 공개",
        dummy2: "게임 규칙과 배당 안내",
      };
      selectedGameDetail.textContent = detailMap[currentGame] || "";
    }
  }
  if (isGuide) {
    renderGuideContent();
    setGameMarqueePaused(false);
    return;
  }
  if (currentGame === "horse") return renderHorseSetup(gameName);
  if (currentGame === "slot") return renderSlotSetup(gameName);
  if (currentGame === "baccarat") return renderBaccaratSetup(gameName);
  if (currentGame === "updown") return renderUpdownSetup(gameName);
  gameBoard.innerHTML = `<p class="text-muted mb-0">${btn.textContent}을 선택했습니다. 베팅 후 게임 시작을 눌러주세요.</p>`;
  if (betCard) betCard.classList.remove("d-none");
  if (playCard) playCard.classList.add("d-none");
};

const bindGameSelectButtons = () => {
  gameSelectButtons = document.querySelectorAll(".game-select");
  gameSelectButtons.forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => handleGameSelectClick(btn));
  });
};

const selectGuideDefault = () => {
  if (currentGame) return;
  const guideBtn = document.querySelector('.game-select[data-game="dummy2"]');
  if (guideBtn) handleGameSelectClick(guideBtn);
};

const setupGameMarquee = () => {
  const container = document.getElementById("gameChooser");
  if (!container || container.dataset.marqueeInit === "1") return;
  const originals = Array.from(container.querySelectorAll(".game-col"));
  if (!originals.length) return;
  container.dataset.marqueeInit = "1";

  const track = document.createElement("div");
  track.className = "game-track";

  originals.forEach((node) => track.appendChild(node));
  originals.forEach((node) => {
    const clone = node.cloneNode(true);
    clone.classList.add("game-col-clone");
    track.appendChild(clone);
  });

  container.innerHTML = "";
  container.appendChild(track);
  gameSelectButtons = container.querySelectorAll(".game-select");

  let offset = 0;
  let baseWidth = 0;
  let hoverPaused = false;
  let wheelFreeze = false;
  let gameFreeze = false;
  let resumeAtTs = null;
  const speedPxPerSec = 60;
  const wheelSpeed = 0.5;
  const resumeDelayMs = 220;

  const wrapOffset = (value) => {
    if (!baseWidth) return value;
    const mod = value % baseWidth;
    // 항상 [-baseWidth, 0)로 되감아 두 세트가 자연스럽게 이어지도록 함
    return mod <= 0 ? mod : mod - baseWidth;
  };

  const applyOffset = (delta) => {
    offset = wrapOffset(offset + delta);
    track.style.transform = `translateX(${offset}px)`;
  };

  const measure = () => {
    baseWidth = track.scrollWidth / 2;
    applyOffset(0);
  };

  const ensureMeasured = () => {
    if (baseWidth) return;
    measure();
    if (!baseWidth) requestAnimationFrame(ensureMeasured);
  };

  const setResumeDelay = () => {
    resumeAtTs = performance.now() + resumeDelayMs;
  };

  let rafId = null;
  let lastTs = null;
  const step = (ts) => {
    const runnable =
      !hoverPaused &&
      !wheelFreeze &&
      !gameFreeze &&
      (resumeAtTs === null || ts >= resumeAtTs);

    if (lastTs !== null) {
      if (runnable) {
        const dt = ts - lastTs;
        const dist = (speedPxPerSec * dt) / 1000;
        applyOffset(-dist);
      }
      lastTs = ts;
    } else {
      lastTs = ts;
    }
    rafId = requestAnimationFrame(step);
  };

  const onWheel = (e) => {
    e.preventDefault();
    wheelFreeze = true; // 휠을 한 번이라도 하면 마우스를 밖으로 뺐다 올 때까지 정지
    hoverPaused = false;
    resumeAtTs = null;
    applyOffset(-e.deltaY * wheelSpeed);
  };

  const handleMouseEnter = () => {
    hoverPaused = true;
  };

  const handleMouseLeave = () => {
    hoverPaused = false;
    wheelFreeze = false;
    if (!gameFreeze) setResumeDelay();
  };

  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("mouseenter", handleMouseEnter);
  container.addEventListener("mouseleave", handleMouseLeave);
  window.addEventListener("resize", measure);

  measure();
  ensureMeasured();
  rafId = requestAnimationFrame(step);
  bindGameSelectButtons();
  updateGameLock();

  window.__gameMarqueeControl = {
    setGameFreeze: (value) => {
      gameFreeze = !!value;
      if (!gameFreeze && !hoverPaused && !wheelFreeze) setResumeDelay();
      if (gameFreeze) resumeAtTs = null;
    },
  };
};

const attachInlinePlayHandler = () => {
  const inlineBtn = document.getElementById("inlinePlayBtn");
  if (inlineBtn)
    inlineBtn.onclick = () => {
      if (currentGame === "slot") return startSlotFlow();
      if (currentGame === "baccarat") return startBaccaratFlow();
      if (currentGame === "horse") return startHorseFlow();
      return playGame();
    };
};

// ---------- Horse race helpers (nonlinear, two-lap) ----------
const OD_CONST = {
  ALPHA: 0.15,
  PHI: 0.35,
  ETA_MIN: 1.0,
  LAMBDA: 0.035,
  RHO: 2.0,
  MU: 0.6,
  H_HALF: 1.5,
};
const HT_TWEAK = 0.15; // stamina influence on corner heat
const SPEED_TUNING = {
  K_SD: 0.45, // stamina drain boost per Speed
  K_A: 1.4, // accel soft-sat for spurt
};
const STAT_TUNING = {
  K_T: 1.2, // stamina eff
  K_C: 1.3, // corner eff
  K_R: 1.4, // stability eff
  SIGMA_MIN: 0.03,
  SIGMA_MAX: 0.25,
  NOISE_MAX: 0.05,
};

const createRng = (seed) => {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) >>> 0;
  };
  const nextFloat = () => next() / 4294967296;
  const normal = (mean = 0, std = 1) => {
    let u = 0;
    let v = 0;
    while (u === 0) u = nextFloat();
    while (v === 0) v = nextFloat();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z = mag * Math.cos(2.0 * Math.PI * v);
    return mean + z * std;
  };
  const nextInt = (min, max) => Math.floor(nextFloat() * (max - min + 1)) + min;
  return { next, nextFloat, nextInt, normal };
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

const hashSeed = (base, salt) => {
  const s = `${base}:${salt}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
};

const smoothstep = (edge0, edge1, t) => {
  const u = Math.min(1, Math.max(0, (t - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
};

const effExp = (raw, k) => 1 - Math.exp(-k * raw);

const buildHorseEvents = (stats, rng, totalLength) => {
  const R_eff = effExp(stats.stability / 100, STAT_TUNING.K_R);
  const u = 1 - R_eff;
  const q = 0.3 + 0.5 * u;
  let count = 0;
  for (let i = 0; i < 2; i += 1) if (rng.nextFloat() < q) count += 1;
  const events = [];
  for (let i = 0; i < count; i += 1) {
    const d = rng.nextFloat() * (0.10 - 0.04) + 0.04;
    const s = rng.nextFloat() * (0.90 - d - 0.10) + 0.10;
    const pStumble = 0.35 + 0.45 * u;
    const isStumble = rng.nextFloat() < pStumble;
    let m = rng.nextFloat() * (0.22 - 0.06) + 0.06;
    const T_eff = effExp(stats.stamina / 100, STAT_TUNING.K_T);
    if (isStumble) m *= 1 - 0.7 * T_eff;
    events.push({ start: s, dur: d, mag: m, kind: isStumble ? "STUMBLE" : "BOOST" });
  }
  return events;
};

const simulateHorseRaceLocal = (horses, seed) => {
  const trackLength = 1000;
  const laps = 2;
  const finishDist = trackLength * laps;
  const dt = 1 / 60;
  const timelineInterval = 0.15;
  const rng = createRng(seed || 1);

  const states = horses.map((h, idx) => {
    const R_raw = h.stats.stability / 100;
    const R_eff = effExp(R_raw, STAT_TUNING.K_R);
    const condSigma = STAT_TUNING.SIGMA_MIN + (STAT_TUNING.SIGMA_MAX - STAT_TUNING.SIGMA_MIN) * (1 - R_eff);
    const F = Math.exp(rng.normal(0, condSigma));
    const events = buildHorseEvents(h.stats, createRng(hashSeed(seed, `ev-${idx}`)), finishDist);
    return {
      id: h.id,
      idx,
      stats: h.stats,
      pos: 0,
      v: 0,
      E: 1,
      H: 0,
      F,
      events,
      finished: false,
      finishTime: Infinity,
    };
  });

  const samples = [];
  let t = 0;
  let nextSample = 0;
  const maxTicks = 40000;

  const eventMultiplier = (evs, frac) => {
    let mult = 1;
    for (const ev of evs) {
      const end = ev.start + ev.dur;
      if (frac < ev.start || frac > end) continue;
      const z = clamp01((frac - ev.start) / ev.dur);
      const bump = Math.sin(Math.PI * z) ** 2;
      const delta = ev.mag * bump;
      mult *= ev.kind === "STUMBLE" ? 1 - delta : 1 + delta;
    }
    return mult;
  };

  for (let tick = 0; tick < maxTicks; tick += 1) {
    let finished = 0;
    for (const st of states) {
      if (st.finished) {
        finished += 1;
        continue;
      }
      const totalFrac = st.pos / finishDist;
      const lapFrac = (st.pos % trackLength) / trackLength;
      const isCorner = (lapFrac >= 0.42 && lapFrac < 0.5) || (lapFrac >= 0.92 && lapFrac <= 1);

      const Sn = st.stats.speed / 100;
      const An = st.stats.accel / 100;
      const T_eff = effExp(st.stats.stamina / 100, STAT_TUNING.K_T);
      const C_eff = effExp(st.stats.cornering / 100, STAT_TUNING.K_C);
      const R_eff = effExp(st.stats.stability / 100, STAT_TUNING.K_R);

      const Vref = 15;
      const gamma = 2.2;
      const gamma2 = 2.6;
      const e0 = 0.015;
      const e1 = 0.035;
      const speedLoad = 1 + SPEED_TUNING.K_SD * Sn;
      const baseDrain = e0 * speedLoad * (st.v / Vref) ** gamma;
      const cornerExtra = e1 * (isCorner ? 1 : 0) * (st.v / Vref) ** gamma2 * (1 - 0.5 * T_eff);
      const drainStam = 1 - 0.6 * T_eff; // 낮은 스태미너일수록 소모 증가
      let dE = (baseDrain + cornerExtra) * drainStam * dt;

      const H0 = 0.8;
      const Hdecay = 2.5;
      let dH = H0 * (isCorner ? 1 : 0) * (st.v / Vref) ** 2 * (1 - C_eff) * (1 + HT_TWEAK * (1 - T_eff)) * dt;

      const P0 = 8;
      const P1 = 10;
      const Pmax = P0 + P1 * Sn;
      let P = Pmax * st.F * (0.35 + 0.65 * st.E);

      const V0 = 14;
      const V1 = 6;
      const Vcap = V0 + V1 * Math.sqrt(Sn);
      const eta = 1.8 + 1.2 * (1 - An);
      const satBase = Vcap > 0 ? 1 - (st.v / Vcap) ** eta : 0;
      let powerPush = P * Math.max(0, satBase);

      const evMult = eventMultiplier(st.events, totalFrac);
      powerPush *= evMult;

      // 코너에서 파워 자체를 낮춰 감속 유도
      const cornerPowerMult = isCorner ? 0.55 + 0.45 * C_eff * (0.9 + 0.1 * T_eff) : 1;
      powerPush *= cornerPowerMult;

      // 안정성이 낮으면 가속에 노이즈 추가
      const instability = 1 - R_eff;
      const jitter = 1 + rng.normal(0, STAT_TUNING.NOISE_MAX * instability);
      powerPush *= Math.max(0.5, Math.min(1.5, jitter));

      // Overdrive (막판 스퍼트)
      const wOD = smoothstep(0.75, 0.9, totalFrac);
      const uOD = 1 - R_eff;
      let IOD = wOD * Math.min(1, Math.max(0, 0.35 + 0.65 * T_eff - 0.3 * uOD));
      const Egate = smoothstep(0.1, 0.25, st.E);
      IOD *= Egate;
      const gA = 1 - Math.exp(-SPEED_TUNING.K_A * An);
      let IOD_eff = IOD * gA;
      const hRatio = st.H / (st.H + OD_CONST.H_HALF);
      const spurtGate = Math.min(1, Math.max(0.4, 0.7 + 0.3 * st.E - 0.2 * hRatio));
      IOD_eff *= spurtGate;
      const etaEff = Math.max(OD_CONST.ETA_MIN, eta * (1 - OD_CONST.PHI * IOD_eff));
      const satOD = Vcap > 0 ? 1 - (st.v / Vcap) ** etaEff : 0;
      const satClamped = Math.max(0, satOD);
      powerPush = P * satClamped * (powerPush / (P * Math.max(1e-6, Math.max(0, satBase)))); // keep multipliers proportional
      powerPush *= 1 + OD_CONST.ALPHA * IOD_eff;
      dE += (OD_CONST.LAMBDA * IOD * (st.v / Vref) ** OD_CONST.RHO) * dt;
      dH *= 1 + OD_CONST.MU * IOD;

      st.E = clamp01(st.E - dE);
      st.H = Math.max(0, st.H + dH - Hdecay * st.H * dt);

      const D0 = 0.01;
      const D1 = 0.0006;
      const drag = D0 * st.v ** 2 + D1 * st.v ** 3;

      const KAPPA = 0.03;
      const eps = 1e-6;
      const ALAT0 = 2.0;
      const ALAT1 = 4.0;
      const Bc = 2.2;
      const kappa = isCorner ? KAPPA : 0;
      const aLatMax = (ALAT0 + ALAT1 * Math.pow(C_eff, 1.1)) * (0.7 + 0.3 * T_eff);
      const aLatEff = aLatMax / (1 + st.H);
      const vCornerMax = kappa > 0 ? Math.sqrt(aLatEff / Math.max(kappa, eps)) : Infinity;
      const cornerBrake = isCorner && st.v > vCornerMax ? Bc * (st.v - vCornerMax) ** 2 : 0;

      const aVal = powerPush - drag - cornerBrake;
      st.v = Math.max(0, st.v + aVal * dt);
      st.pos += st.v * dt;
      if (st.pos >= finishDist) {
        st.pos = finishDist;
        st.finished = true;
        st.finishTime = t;
        finished += 1;
      }
    }
    t += dt;
    if (t >= nextSample) {
      samples.push({
        t: Number(t.toFixed(3)),
        positions: states.map((s) => s.pos),
        speeds: states.map((s) => s.v),
      });
      nextSample += timelineInterval;
    }
    if (finished >= states.length) break;
  }

  const winnerIdx = states.reduce(
    (best, st, idx) => {
      if (st.finishTime < states[best].finishTime - 1e-6) return idx;
      if (Math.abs(st.finishTime - states[best].finishTime) <= 1e-6 && idx < best) return idx;
      return best;
    },
    0
  );
  const finishTimes = {};
  const conditions = {};
  states.forEach((s) => {
    finishTimes[s.id] = s.finishTime;
    conditions[s.id] = s.F;
  });

  return {
    winnerId: states[winnerIdx].id,
    finishTimes,
    timeline: samples,
    laps,
    trackLength: trackLength,
    horses,
    conditions,
  };
};

const updownControlsMarkup = (betValue = 1) => `
  <div class="mb-3">
    <label class="form-label" for="inlineBetAmount">베팅 포인트</label>
    <div class="d-flex flex-wrap gap-2 align-items-end">
      <input type="number" id="inlineBetAmount" class="form-control" style="max-width: 140px;" min="1" value="${betValue}" />
      <button class="btn btn-primary" id="inlinePlayBtn">게임 시작</button>
    </div>
  </div>
  <div id="updownContent" class="text-muted">베팅 후 게임 시작을 눌러주세요.</div>
`;

const slotControlsMarkup = (betValue = 1) => `
  <div class="mb-3">
    <label class="form-label" for="inlineBetAmount">베팅 포인트</label>
    <div class="d-flex flex-wrap gap-2 align-items-end">
      <input type="number" id="inlineBetAmount" class="form-control" style="max-width: 140px;" min="1" value="${betValue}" />
      <button class="btn btn-primary" id="inlinePlayBtn">게임 시작</button>
    </div>
  </div>
`;

const baccaratControlsMarkup = (betValue = 1, choice = "player") => `
  <div class="mb-3">
    <div class="row g-2 align-items-end">
      <div class="col-md-4">
        <label class="form-label" for="inlineBetAmount">베팅 포인트</label>
        <input type="number" id="inlineBetAmount" class="form-control" min="1" value="${betValue}" />
      </div>
      <div class="col-md-4">
        <label class="form-label" for="inlineBetChoiceBaccarat">승리 예측</label>
        <select class="form-select" id="inlineBetChoiceBaccarat">
          <option value="player" ${choice === "player" ? "selected" : ""}>Player</option>
          <option value="banker" ${choice === "banker" ? "selected" : ""}>Banker</option>
          <option value="tie" ${choice === "tie" ? "selected" : ""}>Tie</option>
        </select>
      </div>
      <div class="col-auto d-grid">
        <button class="btn btn-primary" id="inlinePlayBtn">게임 시작</button>
      </div>
    </div>
  </div>
`;

const renderSlotSetup = (gameName) => {
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.remove("d-none");
  setPlayTitle(gameName || "SLOT MACHINE");
  const defaultBet = betAmountInput ? betAmountInput.value : 1;
  gameBoard.innerHTML = `
    ${slotControlsMarkup(defaultBet)}
    <div class="text-center">
      <div class="d-flex justify-content-center gap-3 mb-2">
        <div class="slot-reel"><div class="slot-cell">7</div></div>
        <div class="slot-reel"><div class="slot-cell">7</div></div>
        <div class="slot-reel"><div class="slot-cell">7</div></div>
      </div>
      <p class="text-muted small mb-0">게임 시작을 누르면 바로 스핀합니다.</p>
    </div>
  `;
  attachInlinePlayHandler();
};

const renderBaccaratSetup = (gameName) => {
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.remove("d-none");
  setPlayTitle(gameName || "BACCARAT");
  const defaultBet = betAmountInput ? betAmountInput.value : 1;
  const defaultChoice = betChoiceBaccarat ? betChoiceBaccarat.value : "player";
  gameBoard.innerHTML = `
    ${baccaratControlsMarkup(defaultBet, defaultChoice)}
    <div class="row g-3">
      <div class="col-md-6">
        <h6>PLAYER</h6>
        <div class="card-pile">
          <span class="baccarat-card">&nbsp;</span>
          <span class="baccarat-card">&nbsp;</span>
        </div>
      </div>
      <div class="col-md-6">
        <h6>BANKER</h6>
        <div class="card-pile">
          <span class="baccarat-card">&nbsp;</span>
          <span class="baccarat-card">&nbsp;</span>
        </div>
      </div>
    </div>
    <p class="mt-3 text-muted mb-0">베팅 후 게임 시작을 눌러주세요.</p>
  `;
  attachInlinePlayHandler();
};

const renderUpdownSetup = (gameName) => {
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.remove("d-none");
  setPlayTitle(gameName || "UP&DOWN");
  const defaultBet = betAmountInput ? betAmountInput.value : 1;
  gameBoard.innerHTML = updownControlsMarkup(defaultBet);
  attachInlinePlayHandler();
  updateGameLock();
};

const startSlotFlow = async () => {
  setGameMarqueePaused(true);
  const bet = getBetAmount();
  if (!bet || bet < 1) {
    gameBoard.innerHTML = "<p class='text-danger'>베팅 포인트를 입력하세요.</p>";
    return;
  }
  selectionLocked = true;
  updateGameLock();
  slotAnimating = false;
  try {
    const res = await fetch(API.slotStart, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ bet_amount: bet }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "슬롯 시작에 실패했습니다.");
    }
    const data = await res.json();
    slotSessionId = data.detail?.session_id || null;
    if (typeof data.balance === "number") balanceLabel.textContent = data.balance;
    updateGameLock();
    gameBoard.innerHTML = `
      ${slotControlsMarkup(bet)}
      <div class="text-center text-muted">스핀 준비 중...</div>
    `;
    attachInlinePlayHandler();
    await sleep(400);
    await resolveSlotFlow();
  } catch (error) {
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  }
};

const resolveSlotFlow = async () => {
  if (!slotSessionId) {
    gameBoard.innerHTML = `<p class="text-danger">진행 중인 슬롯 게임이 없습니다.</p>`;
    return;
  }
  try {
    const res = await fetch(API.slotResolve, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ session_id: slotSessionId }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "슬롯 결과 조회에 실패했습니다.");
    }
    const data = await res.json();
    slotAnimating = true;
    updateGameLock();
    renderSlot(data.detail || {}, data);
    slotSessionId = null;
  } catch (error) {
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  }
};

const startBaccaratFlow = async () => {
  setGameMarqueePaused(true);
  const bet = getBetAmount();
  if (!bet || bet < 1) {
    gameBoard.innerHTML = "<p class='text-danger'>베팅 포인트를 입력하세요.</p>";
    return;
  }
  selectionLocked = true;
  updateGameLock();
  baccaratAnimating = false;
  const betChoice = getBaccaratChoice();
  try {
    const res = await fetch(API.baccaratStart, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ bet_amount: bet, bet_choice: betChoice }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "바카라 시작에 실패했습니다.");
    }
    const data = await res.json();
    baccaratSessionId = data.detail?.session_id || null;
    if (typeof data.balance === "number") balanceLabel.textContent = data.balance;
    updateGameLock();
    gameBoard.innerHTML = `
      ${baccaratControlsMarkup(bet, betChoice)}
      <p class="text-muted mb-0">카드를 준비합니다...</p>
    `;
    attachInlinePlayHandler();
    await sleep(400);
    await resolveBaccaratFlow();
  } catch (error) {
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  }
};

const resolveBaccaratFlow = async () => {
  if (!baccaratSessionId) {
    gameBoard.innerHTML = `<p class="text-danger">진행 중인 바카라 게임이 없습니다.</p>`;
    return;
  }
  try {
    const res = await fetch(API.baccaratResolve, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ session_id: baccaratSessionId }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "바카라 결과 조회에 실패했습니다.");
    }
    const data = await res.json();
    baccaratAnimating = true;
    updateGameLock();
    renderBaccarat(data.detail || {}, data);
    baccaratSessionId = null;
  } catch (error) {
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  }
};

const startHorseFlow = async () => {
  setGameMarqueePaused(true);
  const bet = getBetAmount();
  if (!bet || bet < 1) {
    gameBoard.innerHTML = "<p class='text-danger'>베팅 포인트를 입력하세요.</p>";
    return;
  }
  selectionLocked = true;
  updateGameLock();
  try {
    const res = await fetch(API.horseCreate, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ bet_amount: bet }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "경마 세션 생성에 실패했습니다.");
    }
    const data = await res.json();
    horseSessionId = data.session_id;
    horseSessionSeed = data.seed;
    horseSessionHorses = data.horses || [];
    horseSessionStatus = "created";
    renderHorseSelection(horseSessionHorses, bet);
  } catch (error) {
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
  } finally {
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  }
};

const resolveHorseFlow = async () => {
  if (!horseSessionId) {
    gameBoard.innerHTML = `<p class="text-danger">경마 세션이 없습니다. 다시 준비를 눌러주세요.</p>`;
    return;
  }
  const pick = document.querySelector('input[name="horsePick"]:checked');
  if (!pick) {
    gameBoard.innerHTML = `<p class="text-danger">말을 선택하세요.</p>`;
    return;
  }
  const bet = getBetAmount();
  setGameMarqueePaused(true);
  selectionLocked = true;
  updateGameLock();
  horseSessionStatus = "running";
  try {
    const res = await fetch(API.horseLock, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ session_id: horseSessionId, horse_id: pick.value, bet_amount: bet }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "경마 시작에 실패했습니다.");
    }
    const data = await res.json();
    if (typeof data.balance === "number") balanceLabel.textContent = data.balance;

    // Finish on server (authoritative)
    const finishRes = await fetch(API.horseFinish, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ session_id: horseSessionId }),
    });
    if (!finishRes.ok) {
      const msg = await finishRes.text();
      throw new Error(msg || "경마 결과 조회에 실패했습니다.");
    }
    const payload = await finishRes.json();
    if (typeof payload.balance === "number") balanceLabel.textContent = payload.balance;

    renderHorseResult(payload.detail || {}, payload);
    horseSessionId = null;
    horseSessionStatus = "idle";
    // unlock은 애니메이션 완료 시 renderHorseResult에서 수행
  } catch (error) {
    horseSessionStatus = "idle";
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  }
};

const showAlert = (el, message, variant = "success") => {
  el.classList.remove("d-none", "alert-success", "alert-danger");
  el.classList.add(`alert-${variant}`);
  el.textContent = message;
};
const hideAlert = (el) => el.classList.add("d-none");

const updateMe = async () => {
  if (!auth.token) return;
  const res = await fetch(API.me, { headers: auth.headers() });
  if (!res.ok) throw new Error("세션이 만료되었습니다.");
  const data = await res.json();
  userNameLabel.textContent = `${data.name} 님`;
  balanceLabel.textContent = data.balance;
};

const requireLoginUI = async (showError = false) => {
  if (!auth.token) return false;
  try {
    await updateMe();
    authCard.classList.add("d-none");
    appArea.classList.remove("d-none");
    selectGuideDefault();
    return true;
  } catch (e) {
    if (showError) showAlert(loginFeedback, e.message || "세션 오류로 로그인에 실패했습니다.", "danger");
    auth.clear();
    authCard.classList.remove("d-none");
    appArea.classList.add("d-none");
    return false;
  }
};

if (loginForm) {
  loginForm.setAttribute("novalidate", "true");
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("loginName").value.trim();
    const pin = document.getElementById("loginPin").value.trim();
    if (!name) {
      showAlert(loginFeedback, "이름을 입력해주세요.", "danger");
      return;
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      showAlert(loginFeedback, "PIN은 숫자 4자리여야 합니다.", "danger");
      return;
    }
    showAlert(loginFeedback, "로그인 시도 중...", "success");
    try {
      const res = await fetch(API.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin }),
      });
      if (!res.ok) {
        const txt = await res.text();
        const msg = txt || `로그인 실패 (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const data = await res.json();
      auth.save(data.token);
      hideAlert(loginFeedback);
      const ok = await requireLoginUI(true);
      if (!ok) throw new Error("로그인 세션을 불러오지 못했습니다.");
    } catch (err) {
      showAlert(loginFeedback, err.message, "danger");
    }
  });
} else {
  console.error("loginForm element not found; login handler not attached.");
}

logoutBtn.addEventListener("click", () => {
  auth.clear();
  appArea.classList.add("d-none");
  authCard.classList.remove("d-none");
  resetSelection();
});

refreshBalanceBtn.addEventListener("click", () => {
  updateMe().catch((err) => showAlert(loginFeedback, err.message, "danger"));
});

const resetSelection = () => {
  currentGame = null;
  updownInProgress = false;
  slotSessionId = null;
  baccaratSessionId = null;
  horseSessionId = null;
  horseSessionSeed = null;
  horseSessionHorses = [];
  horseSessionStatus = "idle";
  if (horseHeartbeatTimer) {
    clearInterval(horseHeartbeatTimer);
    horseHeartbeatTimer = null;
  }
  selectionLocked = false;
  slotAnimating = false;
  baccaratAnimating = false;
  selectedGameTitle.textContent = "게임을 선택하세요";
  setPlayTitle("플레이 화면");
  if (selectedGameDetail) selectedGameDetail.textContent = "";
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.add("d-none");
  gameBoard.innerHTML = `<p class="text-muted mb-0">게임을 선택하고 시작하면 여기에서 진행됩니다.</p>`;
  updateGameLock();
  setGameMarqueePaused(false);
};

const renderGuideContent = () => {
  selectionLocked = false;
  updownInProgress = false;
  slotSessionId = null;
  baccaratSessionId = null;
  horseSessionId = null;
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.remove("d-none");
  setPlayTitle("GAME GUIDE");
  gameBoard.innerHTML = `
    <div class="guide-grid">
      <div class="row g-4">
        <div class="guide-col">
          <h6 class="fw-bold mb-2">UP&DOWN</h6>
          <ul class="small mb-0 ps-3">
            <li>1~100 숫자 맞히기, 최대 5회 시도</li>
            <li>정답에 따라 UP / DOWN 힌트 제공</li>
            <li>배당: 1~5회차 7x/5x/4x/3x/2x, 실패 0x</li>
            <li>힌트를 활용해 남은 시도 관리</li>
          </ul>
        </div>
        <div class="guide-col">
          <h6 class="fw-bold mb-2">SLOT MACHINE</h6>
          <ul class="small mb-0 ps-3">
            <li>심볼 A,B,C,D,7 균등 확률</li>
            <li>당첨: 777=10x, 같은 심볼 3개=5x, 같은 심볼 2개=1.5x</li>
            <li>그 외 0x (베팅만 차감)</li>
            <li>스핀 애니메이션 후 결과·잔액 표시</li>
          </ul>
        </div>
        <div class="guide-col">
          <h6 class="fw-bold mb-2">BACCARAT</h6>
          <ul class="small mb-0 ps-3">
            <li>Player / Banker / Tie 중 선택</li>
            <li>배당: Player 1:1(수령 2x), Banker 1:1-커미션(수령 1.95x), Tie 8:1</li>
            <li>표준 드로우 규칙 적용, 네추럴 8/9 즉시 종료</li>
            <li>카드 공개 애니메이션으로 진행</li>
          </ul>
        </div>
      </div>
      <div class="row g-4 mt-1">
        <div class="guide-col guide-col-full">
          <h6 class="fw-bold mb-2">HORSE RACING</h6>
          <ul class="small mb-0 ps-3">
            <li>가상 경마 이벤트에 베팅(준비중)</li>
            <li>말/조합 선택 후 결과에 따라 배당 지급</li>
            <li>실제 배당·확률은 추후 안내 예정</li>
            <li>출시 시 별도 규칙/배당표 제공</li>
          </ul>
        </div>
      </div>
    </div>
    </div>
    <div class="mt-3 small text-muted">
      베팅은 실제 게임(업다운/슬롯/바카라)을 선택한 뒤에만 가능합니다. 도움말 카드는 안내용으로만 사용됩니다.
    </div>
  `;
  updateGameLock();
};

const renderHorseSetup = (gameName) => {
  horseSessionId = null;
  selectionLocked = false;
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.remove("d-none");
  setPlayTitle(gameName || "HORSE RACING");
  const defaultBet = betAmountInput ? betAmountInput.value : 1;
  gameBoard.innerHTML = `
    <div class="mb-3">
      <label class="form-label">베팅 포인트</label>
      <div class="d-flex flex-wrap gap-2 align-items-end">
        <input type="number" id="inlineBetAmount" class="form-control" style="max-width: 160px;" min="1" value="${defaultBet}" />
        <button class="btn btn-primary" id="inlinePlayBtn">경마 준비</button>
      </div>
    </div>
    <p class="text-muted mb-0">베팅 후 말을 선택하고 경주를 시작하세요. (현재 기본 맵 사용)</p>
  `;
  attachInlinePlayHandler();
};

const renderHorseSelection = (horses, betValue) => {
  const rows = horses
    .map(
      (h) => `
      <div class="card mb-2">
        <div class="card-body d-flex flex-wrap align-items-center gap-3">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="horsePick" value="${h.id}" id="pick-${h.id}">
            <label class="form-check-label fw-bold" for="pick-${h.id}">${h.name}</label>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  gameBoard.innerHTML = `
    <div class="mb-3">
      <label class="form-label">베팅 포인트</label>
      <div class="d-flex flex-wrap gap-2 align-items-end">
        <input type="number" id="inlineBetAmount" class="form-control" style="max-width: 160px;" min="1" value="${betValue}" disabled />
        <button class="btn btn-primary" id="startHorseRaceBtn">경주 시작</button>
      </div>
    </div>
    <div class="mb-3">${rows}</div>
  `;

  const startBtn = document.getElementById("startHorseRaceBtn");
  if (startBtn) startBtn.onclick = resolveHorseFlow;
};

const renderHorseResult = (detail, payload) => {
  const horses = detail.horses || [];
  const timeline = detail.timeline || [];
  const events = detail.events || [];
  const trackId = `horse-track-${Date.now()}`;
  const speedCtrlId = `${trackId}-speed`;
  const speedValId = `${trackId}-speed-val`;
  const rankId = `${trackId}-rank`;
  const winnerId = detail.winner_id;
  const trackLenUnits = detail.track_length || 1000;
  const laps = detail.laps || 1;
  const finishDist = trackLenUnits * laps;

  gameBoard.innerHTML = `
    <div class="horse-race-wrap">
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="small fw-bold">재생 속도</span>
        <button class="btn btn-sm btn-outline-secondary" id="${speedCtrlId}-down">-10%</button>
        <span class="badge bg-secondary" id="${speedValId}">1.0x</span>
        <button class="btn btn-sm btn-outline-secondary" id="${speedCtrlId}-up">+10%</button>
      </div>
      <div class="small text-muted mb-2" id="${rankId}">현재 순위: -</div>
      <div class="horse-track mb-1" id="${trackId}">
        ${horses
          .map(
            (h) => `
              <div class="horse-runner ${h.id === winnerId ? "winner" : ""}" data-horse="${h.id}">
                ${h.name}
              </div>
            `
          )
          .join("")}
      </div>
      <div class="card d-none" id="horseResultCard">
        <div class="card-body">
          <h6 class="fw-bold mb-2">결과</h6>
          <p class="mb-1" id="horsePickedRow">선택 말: ${detail.bet_choice || "-"}</p>
          <p class="mb-1" id="horseWinnerRow">우승 말: -</p>
          <p class="mb-2" id="horsePayoutRow">배당: ${payload.payout_multiplier?.toFixed ? payload.payout_multiplier.toFixed(2) : payload.payout_multiplier || 0}x / 증감: ${payload.delta || 0} pt / 잔액: ${payload.balance || ""} pt</p>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>말</th><th>컨디션</th><th>SPD</th><th>ACC</th><th>STM</th><th>STB</th><th>COR</th></tr></thead>
              <tbody id="horseResultTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  const trackEl = document.getElementById(trackId);
  if (!trackEl) return null;
  const runners = Array.from(trackEl.querySelectorAll(".horse-runner"));
  const trackW = trackEl.clientWidth;
  const trackH = trackEl.clientHeight;
  const runnerW = 64;
  const runnerH = 32;
  const outerR = trackH / 2;
  const innerInset = 26; // grass inset in CSS ::after
  const innerR = (trackH - innerInset * 2) / 2;
  const trackThickness = outerR - innerR;
  const laneR = outerR - trackThickness / 2; // 트랙 중앙선을 따라 이동
  const leftCenterX = outerR;
  const rightCenterX = trackW - outerR;
  const straightLen = Math.max(40, rightCenterX - leftCenterX); // 중앙선 기준 직선 길이
  const arcHalf = laneR * Math.PI;
  const totalLen = straightLen * 2 + arcHalf * 2;
  const pointAt = (distRaw) => {
    let d = distRaw % totalLen;
    if (d <= straightLen) return { x: leftCenterX + d, y: trackH / 2 - laneR, heading: 0, corner: false };
    d -= straightLen;
    if (d <= arcHalf) {
      const a = -Math.PI / 2 + (d / arcHalf) * Math.PI;
      const heading = a + Math.PI / 2;
      return { x: rightCenterX + laneR * Math.cos(a), y: trackH / 2 + laneR * Math.sin(a), heading, corner: true };
    }
    d -= arcHalf;
    if (d <= straightLen) return { x: rightCenterX - d, y: trackH / 2 + laneR, heading: Math.PI, corner: false };
    d -= straightLen;
    const a = Math.PI / 2 + (d / arcHalf) * Math.PI;
    const heading = a + Math.PI / 2;
    return { x: leftCenterX + laneR * Math.cos(a), y: trackH / 2 + laneR * Math.sin(a), heading, corner: true };
  };

  let speedMult = 4; // 기본 재생 속도 4x
  const runnersById = new Map(runners.map((r) => [r.dataset.horse, r]));
  const tableBody = document.getElementById("horseResultTableBody");
  const card = document.getElementById("horseResultCard");
  const pickedEl = document.getElementById("horsePickedRow");
  const winnerEl = document.getElementById("horseWinnerRow");
  const payoutEl = document.getElementById("horsePayoutRow");
  const speedValEl = document.getElementById(speedValId);
  const rankEl = document.getElementById(rankId);

  if (tableBody) {
    tableBody.innerHTML = horses
      .map((h) => {
        const stats = h.stats || {};
        const condMap = detail.conditions || {};
        const cond = condMap[h.id] ?? h.condition;
        const fmt = (v) => (v === 0 ? 0 : v ? v : "-");
        return `
        <tr data-horse-row="${h.id}">
          <td>${h.name}</td>
          <td>${typeof cond === "number" ? cond.toFixed(3) : "-"}</td>
          <td>${fmt(stats.speed)}</td>
          <td>${fmt(stats.accel)}</td>
          <td>${fmt(stats.stamina)}</td>
          <td>${fmt(stats.stability)}</td>
          <td>${fmt(stats.cornering)}</td>
        </tr>
      `;
      })
      .join("");
  }

  const applySpeed = (mult) => {
    speedMult = Math.max(0.2, mult);
    if (speedValEl) speedValEl.textContent = `${speedMult.toFixed(1)}x`;
  };
  const speedUpBtn = document.getElementById(`${speedCtrlId}-up`);
  const speedDownBtn = document.getElementById(`${speedCtrlId}-down`);
  if (speedUpBtn) speedUpBtn.onclick = () => applySpeed(speedMult * 1.1);
  if (speedDownBtn) speedDownBtn.onclick = () => applySpeed(speedMult * 0.9);
  applySpeed(speedMult);

  const applyWinner = () => {
    if (winnerEl) winnerEl.textContent = `우승 말: ${horses.find((h) => h.id === winnerId)?.name || winnerId || "-"}`;
    const pickedId = detail.bet_choice;
    if (tableBody) {
      tableBody.querySelectorAll("tr").forEach((row) => row.classList.remove("table-success", "table-warning"));
      const winRow = tableBody.querySelector(`tr[data-horse-row="${winnerId}"]`);
      if (winRow) winRow.classList.add("table-success");
      const pickedRow = pickedId ? tableBody.querySelector(`tr[data-horse-row="${pickedId}"]`) : null;
      if (pickedRow) pickedRow.classList.add("table-warning");
    }
    runnersById.forEach((el, horseId) => {
      el.classList.remove("winner", "picked-horse");
      if (horseId === winnerId) el.classList.add("winner");
      if (horseId === pickedId) el.classList.add("picked-horse");
    });
    if (card) card.classList.remove("d-none");
  };

  const renderPositions = (positions) => {
    positions.forEach((pos, idx) => {
      const horse = horses[idx];
      const el = horse ? runnersById.get(horse.id) : null;
      if (!horse || !el) return;
      const lapFrac = ((pos % trackLenUnits) / trackLenUnits) * totalLen;
      const p = pointAt(lapFrac);
      const heading = p.heading ?? 0;
      el.style.transform = `translate(${p.x - runnerW / 2}px, ${p.y - runnerH / 2}px) rotate(${heading}rad)`;
    });
    if (rankEl) {
      const rank = horses
        .map((h, idx) => [h, positions[idx] ?? 0])
        .sort((a, b) => b[1] - a[1])
        .map(([h]) => h.name)
        .join(" > ");
      rankEl.textContent = `현재 순위: ${rank}`;
    }
  };

  const playTimeline = () => {
    if (!timeline.length) {
      renderPositions(horses.map(() => finishDist));
      applyWinner();
      selectionLocked = false;
      updateGameLock();
      setGameMarqueePaused(false);
      return;
    }
    const start = performance.now();
    const lastT = timeline[timeline.length - 1].t || 0;

    const step = (now) => {
      const elapsed = (now - start) / 1000;
      const simT = Math.min(lastT, elapsed * speedMult);
      let prev = timeline[0];
      let next = timeline[timeline.length - 1];
      for (let i = 1; i < timeline.length; i += 1) {
        if (timeline[i].t >= simT) {
          next = timeline[i];
          prev = timeline[i - 1];
          break;
        }
      }
      const span = Math.max(0.0001, next.t - prev.t);
      const k = Math.min(1, Math.max(0, (simT - prev.t) / span));
      const interp = prev.positions.map((p, idx) => {
        const n = next.positions[idx] ?? p;
        return p + (n - p) * k;
      });
      renderPositions(interp);

      if (simT >= lastT - 1e-3) {
        renderPositions(next.positions || interp);
        applyWinner();
        selectionLocked = false;
        updateGameLock();
        setGameMarqueePaused(false);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (pickedEl) pickedEl.textContent = `선택 말: ${detail.bet_choice || "-"}`;
  if (payoutEl) payoutEl.textContent = `배당: ${payload.payout_multiplier?.toFixed ? payload.payout_multiplier.toFixed(2) : payload.payout_multiplier || 0}x / 증감: ${payload.delta || 0} pt / 잔액: ${payload.balance || ""} pt`;

  playTimeline();
};

const renderSlot = (detail, payload) => {
  const finalSymbols = detail.symbols || [];
  const anim = detail.anim || {};
  const betValue = getBetAmount() || 1;
  gameBoard.innerHTML = `
    ${slotControlsMarkup(betValue)}
    <div class="text-center">
      <div class="d-flex justify-content-center gap-3 mb-3" id="slotRow"></div>
      <p class="mb-1" id="slotStatus">스핀 중...</p>
      <p class="mb-0" id="slotResult"></p>
    </div>
  `;
  attachInlinePlayHandler();
  const row = document.getElementById("slotRow");
  const statusEl = document.getElementById("slotStatus");
  const resultEl = document.getElementById("slotResult");
  const allSymbols = ["A", "B", "C", "D", "7"];
  const cellHeight = 60;
  const baseSteps = [
    anim.steps1 || 24,
    anim.steps2 || 34,
    anim.steps3 || 48,
  ];
  let finished = 0;
  const stepMs = anim.step_ms || 60;
  const startStagger = [
    anim.stagger_ms || 0,
    anim.stagger_ms || 0,
    anim.stagger_ms || 0,
  ];
  const reelSteps = [...baseSteps];
  let smoothStopThird = false;
  let smoothStopFactor = anim.smooth_strength || 1;
  const matchProb = anim.match_prob ?? 1.0;
  const matchMin = anim.match_min_pct ?? 0.1;
  const matchMax = anim.match_max_pct ?? 0.4;
  const match7Min = anim.match7_min_pct ?? 0.3;
  const match7Max = anim.match7_max_pct ?? 0.6;
  const extraProb = anim.extra_prob ?? 0.2;
  const extraMin = anim.extra_pct_min ?? 0.0;
  const extraMax = anim.extra_pct_max ?? 0.1;
  const extra25Prob = anim.extra25_prob ?? 0.15;
  const extra25Pct = anim.extra25_pct ?? 0.25;
  const smoothThreshold = anim.smooth_threshold ?? 0.25;

  if (finalSymbols[0] && finalSymbols[1] && finalSymbols[0] === finalSymbols[1]) {
    const sameSymbol = finalSymbols[0];
    if (Math.random() < matchProb) {
      const extra =
        sameSymbol === "7"
          ? match7Min + Math.random() * (match7Max - match7Min)
          : matchMin + Math.random() * (matchMax - matchMin);
      const factor = 1 + extra;
      reelSteps[2] = Math.max(reelSteps[2], Math.round(baseSteps[2] * factor));
      if (extra >= smoothThreshold) {
        smoothStopThird = true;
      }
    }
  }
  if (Math.random() < extraProb) {
    const factor = 1 + (extraMin + Math.random() * (extraMax - extraMin));
    reelSteps[2] = Math.max(reelSteps[2], Math.round(baseSteps[2] * factor));
  }
  if (Math.random() < extra25Prob) {
    const factor = 1 + extra25Pct;
    reelSteps[2] = Math.max(reelSteps[2], Math.round(baseSteps[2] * factor));
    smoothStopThird = true;
  }

  const makeReel = (idx) => {
    const reel = document.createElement("div");
    reel.className = "slot-reel";
    reel.dataset.slotIndex = idx;
    reel.style.cssText =
      "width:60px;height:60px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;background:#f1f3f5;margin:0 10px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.15);overflow:hidden;position:relative;";
    const strip = document.createElement("div");
    strip.className = "slot-strip";
    strip.style.cssText =
      "position:absolute;top:0;left:0;right:0;transition:transform 0.12s ease-out;";
    reel.appendChild(strip);
    row.appendChild(reel);
    return strip;
  };

  const spinReel = (strip, totalSteps, smoothStop = false) => {
    const fillers = [];
    for (let i = 0; i < totalSteps; i += 1) {
      fillers.push(allSymbols[i % allSymbols.length]);
    }
    const finalSymbol =
      finalSymbols[Number(strip.parentElement.dataset.slotIndex)] ||
      allSymbols[Math.floor(Math.random() * allSymbols.length)];
    const seq = [finalSymbol, ...fillers]; // 마지막에 최종 심볼이 내려오도록 앞에 배치
    strip.innerHTML = seq.map((s) => `<div class="slot-cell" style="height:${cellHeight}px;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;">${s}</div>`).join("");
    let current = 0;
    const total = seq.length - 1;
    // 시작은 리스트 맨 끝(필러)에서 최종 심볼이 아래로 내려오도록 위쪽에 올려둔다
    strip.style.transform = `translateY(${-total * cellHeight}px)`;

    const step = () => {
      const progress = total === 0 ? 1 : current / total;
      const easeFactor = smoothStop
        ? 1 + (Math.exp(Math.min(progress, 1) * 2) - 1) / 3 // 완만하게 늘어나는 지연
        : 1;
      const transDur = smoothStop ? 0.12 * (1 + progress * 1.2) * smoothStopFactor : 0.12;
      strip.style.transition = `transform ${transDur.toFixed(3)}s cubic-bezier(0.16, 1, 0.3, 1)`;
      const offset = -(total - current) * cellHeight;
      strip.style.transform = `translateY(${offset}px)`;
      if (current >= total) {
        finished += 1;
        if (finished === 3) {
          statusEl.textContent = `결과: ${payload.result} / 배당 x${payload.payout_multiplier.toFixed(2)}`;
          resultEl.textContent = `증감: ${payload.delta} pt / 잔액: ${payload.balance} pt`;
          if (typeof payload.balance === "number") balanceLabel.textContent = payload.balance;
          slotAnimating = false;
          selectionLocked = false;
          updateGameLock();
          setGameMarqueePaused(false);
        }
        return;
      }
      current += 1;
      const delay = stepMs * easeFactor * (smoothStop ? smoothStopFactor : 1);
      setTimeout(step, delay);
    };

    setTimeout(step, stepMs);
  };

  const strips = [makeReel(0), makeReel(1), makeReel(2)];
  strips.forEach((strip, idx) => {
    const smooth = idx === 2 && smoothStopThird;
    setTimeout(() => spinReel(strip, reelSteps[idx], smooth), startStagger[idx]);
  });
};

const renderUpdown = (detail, payload) => {
  const target = detail.target;
  const guesses = detail.guesses || [];
  const rows = guesses
    .map((g) => {
      let hint = "?";
      if (g < target) hint = "UP";
      else if (g > target) hint = "DOWN";
      else hint = "CORRECT";
      return `<tr><td>${g}</td><td>${hint}</td></tr>`;
    })
    .join("");
  setUpdownContent(`
    <p>정답: ${target}</p>
    <table class="table table-sm">
      <thead><tr><th>추측</th><th>결과</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="mb-0">배당 x${payload.payout_multiplier.toFixed(2)} / 증감 ${payload.delta} pt / 잔액 ${payload.balance} pt</p>
  `);
};

const renderUpdownPending = (detail) => {
  const maxAttempts = detail.max_attempts || (detail.payouts ? detail.payouts.length : 5);
  const remaining = maxAttempts - (detail.attempts || 0);
  const hint = detail.hint || "?";
  const statusEl = document.getElementById("updownStatusDynamic");
  if (statusEl) {
    statusEl.textContent = `남은 시도: ${remaining}회 / 힌트: ${hint}`;
  }
};

const renderBaccarat = async (detail, payload) => {
  const playerHand = detail.player_hand || [];
  const bankerHand = detail.banker_hand || [];
  const playerValue = detail.player_value || 0;
  const bankerValue = detail.banker_value || 0;
  const outcome = detail.outcome || "";
  const betValue = getBetAmount() || 1;
  const choice = getBaccaratChoice();

  gameBoard.innerHTML = `
    ${baccaratControlsMarkup(betValue, choice)}
    <div class="row g-3">
      <div class="col-md-6">
        <h6 id="playerTitle">PLAYER</h6>
        <div class="card-pile" id="playerPile"></div>
      </div>
      <div class="col-md-6">
        <h6 id="bankerTitle">BANKER</h6>
        <div class="card-pile" id="bankerPile"></div>
      </div>
    </div>
    <p class="mt-3" id="baccaratStatus">카드를 배분합니다...</p>
  `;

  attachInlinePlayHandler();
  const playerPile = document.getElementById("playerPile");
  const bankerPile = document.getElementById("bankerPile");
  const statusEl = document.getElementById("baccaratStatus");
  const emptySlot = "\u00a0";
  const blankCard = "?"; // 숨김 상태 표시

  const appendCard = (pile, card) => {
    const span = document.createElement("span");
    span.className = "baccarat-card";
    span.textContent = card && card.trim() ? card : emptySlot;
    pile.appendChild(span);
  };

  const ensurePlaceholders = (pile) => {
    for (let i = 0; i < 2; i += 1) {
      const child = pile.children[i];
      if (child) {
        child.textContent = emptySlot;
        child.classList.remove("reveal-anim");
      } else {
        appendCard(pile, emptySlot);
      }
    }
  };

  const revealHiddenMarks = async () => {
    const slots = [...playerPile.children, ...bankerPile.children];
    for (const slot of slots) {
      slot.textContent = blankCard;
      slot.classList.remove("reveal-anim");
      await sleep(200); // 왼쪽→오른쪽 순차 등장
    }
  };

  // 초기 UI가 사라지지 않도록 즉시 2장씩 채워 둔다.
  ensurePlaceholders(playerPile);
  ensurePlaceholders(bankerPile);
  await revealHiddenMarks();

  const sequence = async () => {
    // 처음 2장 상태는 유지된 채, 순차적으로 값만 갱신
    await sleep(600);
    playerPile.children[0].textContent = playerHand[0] || blankCard;
    statusEl.textContent = "Player 첫 카드 공개";
    await sleep(600);
    bankerPile.children[0].textContent = bankerHand[0] || blankCard;
    statusEl.textContent = "Banker 첫 카드 공개";
    await sleep(600);
    playerPile.children[1].textContent = playerHand[1] || blankCard;
    statusEl.textContent = "Player 두 번째 카드 공개";
    await sleep(600);
    bankerPile.children[1].textContent = bankerHand[1] || blankCard;
    statusEl.textContent = "Banker 두 번째 카드 공개";

    if (playerHand.length > 2) {
      appendCard(playerPile, "");
      await sleep(800);
      playerPile.children[2].textContent = playerHand[2] || blankCard;
      statusEl.textContent = "Player 세 번째 카드";
    }
    if (bankerHand.length > 2) {
      appendCard(bankerPile, "");
      await sleep(800);
      bankerPile.children[bankerPile.children.length - 1].textContent =
        bankerHand[2] || blankCard;
      statusEl.textContent = "Banker 세 번째 카드";
    }

    await sleep(800);
    statusEl.innerHTML = `최종: ${outcome} / Player ${playerValue} vs Banker ${bankerValue}<br>배당 x${payload.payout_multiplier.toFixed(2)} / 증감 ${payload.delta} pt / 잔액 ${payload.balance} pt`;
    if (typeof payload.balance === "number") balanceLabel.textContent = payload.balance;
    baccaratAnimating = false;
    selectionLocked = false;
    updateGameLock();
    setGameMarqueePaused(false);
  };

  await sequence();
};

const playGame = async () => {
  if (!currentGame) {
    gameBoard.innerHTML = "<p>게임을 선택하세요.</p>";
    return;
  }
  if (currentGame === "dummy2") {
    // 도움말 카드에서는 게임 실행을 막는다
    return;
  }
  setGameMarqueePaused(true);
  selectionLocked = true;
  updateGameLock();
  if (currentGame === "slot") return startSlotFlow();
  if (currentGame === "baccarat") return startBaccaratFlow();
  if (currentGame === "horse") return startHorseFlow();
  const bet = getBetAmount();
  if (!bet || bet < 1) {
    gameBoard.innerHTML = "<p>베팅 포인트를 입력하세요.</p>";
    return;
  }

  let endpoint = API[currentGame];
  let body = { bet_amount: bet };
  if (currentGame === "updown") {
    // updown 인터랙티브 시작
  try {
    const res = await fetch(`${API.updownStart}?bet_amount=${bet}`, {
      method: "POST",
      headers: { ...auth.headers() },
    });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "게임 시작에 실패했습니다.");
      }
    const startData = await res.json();
    if (typeof startData.balance === "number") balanceLabel.textContent = startData.balance;
    const remainingText = typeof startData.remaining === "number" ? `${startData.remaining}회` : "계산 중...";
    updownInProgress = true;
    updateGameLock();
    if (playCard) playCard.classList.remove("d-none");
      setUpdownContent(`
        <div class="mb-2">숫자를 입력하고 판정 버튼을 눌러주세요.</div>
        <div class="input-group mb-2" style="max-width:320px;">
          <input type="number" class="form-control" id="guessInputDynamic" min="1" max="100" placeholder="1~100" />
          <button class="btn btn-outline-primary" id="submitGuessDynamic" type="button">판정</button>
        </div>
        <div id="updownStatusDynamic" class="text-muted">게임 시작! 남은 시도 ${remainingText}</div>
        <div id="updownTableWrapper" class="mt-3"></div>
      `);
      const submitBtn = document.getElementById("submitGuessDynamic");
      submitBtn.addEventListener("click", submitUpdownGuess);
    } catch (error) {
      gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    }
    return;
  }
  if (currentGame === "baccarat") {
    body.bet_choice = getBaccaratChoice();
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "게임 실행에 실패했습니다.");
    }
    const data = await res.json();
    balanceLabel.textContent = data.balance;
    if (playCard) playCard.classList.remove("d-none");
    if (currentGame === "updown") renderUpdown(data.detail || {}, data);
    else if (currentGame === "slot") renderSlot(data.detail || {}, data);
    else renderBaccarat(data.detail || {}, data);
  } catch (error) {
    gameBoard.innerHTML = `<p class="text-danger">오류: ${error.message}</p>`;
    setGameMarqueePaused(false);
  }
};

playSelectedBtn.addEventListener("click", playGame);

const sendHorseForfeit = () => {
  if (horseSessionId && horseSessionStatus === "running") {
    const data = JSON.stringify({ session_id: horseSessionId });
    const blob = new Blob([data], { type: "application/json" });
    navigator.sendBeacon(API.horseForfeit, blob);
  }
};

window.addEventListener("beforeunload", sendHorseForfeit);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") sendHorseForfeit();
});

const submitUpdownGuess = async () => {
  if (!updownInProgress) {
    const statusEl = document.getElementById("updownStatusDynamic");
    if (statusEl) statusEl.textContent = "게임 시작 후 입력하세요.";
    return;
  }
  const guessInput = document.getElementById("guessInputDynamic");
  const guessVal = Number(guessInput.value);
  const statusEl = document.getElementById("updownStatusDynamic");
  if (!guessVal || guessVal < 1 || guessVal > 100) {
    if (statusEl) statusEl.textContent = "1~100 사이 숫자를 입력하세요.";
    return;
  }
  try {
    const res = await fetch(API.updownGuess, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers() },
      body: JSON.stringify({ guess: guessVal }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "요청 실패");
    }
    const data = await res.json();
    if (data.result === "pending") {
      renderUpdownPending(data.detail || {});
    } else {
      updownInProgress = false;
      selectionLocked = false;
      balanceLabel.textContent = data.balance;
      renderUpdown(data.detail || {}, data);
      updateGameLock();
      setGameMarqueePaused(false); // 게임 종료 시 다시 이동 허용
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = `오류: ${error.message}`;
    setGameMarqueePaused(false);
  }
};

requireLoginUI();
updateGameLock();
setupGameMarquee();
bindGameSelectButtons();
selectGuideDefault();
