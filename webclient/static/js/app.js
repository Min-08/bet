const API = {
  login: "/api/login",
  me: "/api/me",
  updown: "/api/game/updown",
  updownStart: "/api/game/updown/start",
  updownGuess: "/api/game/updown/guess",
  slot: "/api/game/slot",
  baccarat: "/api/game/baccarat",
};

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
const gameSelectButtons = document.querySelectorAll(".game-select");
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
const gameCols = document.querySelectorAll(".game-col");

let currentGame = null;
let updownInProgress = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const attachInlinePlayHandler = () => {
  const inlineBtn = document.getElementById("inlinePlayBtn");
  if (inlineBtn) inlineBtn.onclick = () => playGame();
};

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
        <label class="form-label" for="inlineBetChoiceBaccarat">베팅 선택</label>
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
    <p class="mt-3 text-muted mb-0">카드 배분 후 ? 가 나타납니다.</p>
  `;
  attachInlinePlayHandler();
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
    return true;
  } catch (e) {
    if (showError) showAlert(loginFeedback, e.message || "세션 오류로 로그인에 실패했습니다.", "danger");
    auth.clear();
    authCard.classList.remove("d-none");
    appArea.classList.add("d-none");
    return false;
  }
};

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("loginName").value.trim();
  const pin = document.getElementById("loginPin").value.trim();
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

logoutBtn.addEventListener("click", () => {
  auth.clear();
  appArea.classList.add("d-none");
  authCard.classList.remove("d-none");
  resetSelection();
});

refreshBalanceBtn.addEventListener("click", () => {
  updateMe().catch((err) => showAlert(loginFeedback, err.message, "danger"));
});

gameSelectButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentGame = btn.dataset.game;
    updownInProgress = false;
    const card = btn.closest(".card");
    const titleEl = card ? card.querySelector(".card-title") : null;
    const descEl = card ? card.querySelector("p.text-muted") : null;
    const gameName = titleEl ? titleEl.textContent.trim() : btn.textContent.trim();
    selectedGameTitle.textContent = gameName;
    setPlayTitle(gameName);
    if (baccaratExtra)
      baccaratExtra.classList.toggle("d-none", currentGame !== "baccarat");
    if (selectedGameDetail) {
      if (descEl && descEl.textContent.trim()) {
        selectedGameDetail.textContent = descEl.textContent.trim();
      } else {
        const detailMap = {
          updown: "1~100 숫자 맞히기, 최대 10회 시도",
          slot: "3릴 슬롯, 777=10x / 같은 심볼=5x/1.5x",
          baccarat: "플레이어/뱅커/타이 중 선택",
        };
        selectedGameDetail.textContent = detailMap[currentGame] || "";
      }
    }
    if (currentGame === "slot") {
      renderSlotSetup(gameName);
      return;
    }
    if (currentGame === "baccarat") {
      renderBaccaratSetup(gameName);
      return;
    }
    gameBoard.innerHTML = `<p class="text-muted mb-0">${btn.textContent}을 선택했습니다. 베팅 후 게임 시작을 눌러주세요.</p>`;
    if (betCard) betCard.classList.remove("d-none");
    if (playCard) playCard.classList.add("d-none");
  });
});

const resetSelection = () => {
  currentGame = null;
  updownInProgress = false;
  selectedGameTitle.textContent = "게임을 선택하세요";
  setPlayTitle("플레이 화면");
  if (selectedGameDetail) selectedGameDetail.textContent = "";
  if (betCard) betCard.classList.add("d-none");
  if (playCard) playCard.classList.add("d-none");
  gameBoard.innerHTML = `<p class="text-muted mb-0">게임을 선택하고 시작하면 여기에서 진행됩니다.</p>`;
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
  gameBoard.innerHTML = `
    <p>정답: ${target}</p>
    <table class="table table-sm">
      <thead><tr><th>추측</th><th>결과</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="mb-0">배당 x${payload.payout_multiplier.toFixed(2)} / 증감 ${payload.delta} pt / 잔액 ${payload.balance} pt</p>
  `;
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

const renderBaccarat = (detail, payload) => {
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
  const playerCards = ["?", "?", playerHand[2] || null].filter(Boolean);
  const bankerCards = ["?", "?", bankerHand[2] || null].filter(Boolean);

  const appendCard = (pile, card) => {
    const span = document.createElement("span");
    span.className = "baccarat-card";
    span.textContent = card;
    pile.appendChild(span);
  };

  const sequence = async () => {
    playerPile.innerHTML = "";
    bankerPile.innerHTML = "";
    appendCard(playerPile, "?");
    appendCard(bankerPile, "?");
    await sleep(600);
    playerPile.children[0].textContent = playerHand[0] || "?";
    statusEl.textContent = "Player 첫 카드 공개";
    appendCard(bankerPile, "?");
    await sleep(600);
    bankerPile.children[0].textContent = bankerHand[0] || "?";
    statusEl.textContent = "Banker 첫 카드 공개";
    appendCard(playerPile, "?");
    await sleep(600);
    playerPile.children[1].textContent = playerHand[1] || "?";
    statusEl.textContent = "Player 두 번째 카드 공개";
    bankerPile.children[1].textContent = "?";
    await sleep(600);
    bankerPile.children[1].textContent = bankerHand[1] || "?";
    statusEl.textContent = "Banker 두 번째 카드 공개";

    if (playerHand.length > 2) {
      appendCard(playerPile, "?");
      await sleep(800);
      playerPile.children[2].textContent = playerHand[2];
      statusEl.textContent = "Player 세 번째 카드";
    }
    if (bankerHand.length > 2) {
      appendCard(bankerPile, "?");
      await sleep(800);
      bankerPile.children[bankerPile.children.length - 1].textContent =
        bankerHand[2];
      statusEl.textContent = "Banker 세 번째 카드";
    }

    await sleep(800);
    statusEl.innerHTML = `최종: ${outcome} / Player ${playerValue} vs Banker ${bankerValue}<br>배당 x${payload.payout_multiplier.toFixed(2)} / 증감 ${payload.delta} pt / 잔액 ${payload.balance} pt`;
  };

  sequence();
};

const playGame = async () => {
  if (!currentGame) {
    gameBoard.innerHTML = "<p>게임을 선택하세요.</p>";
    return;
  }
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
      const remainingText = typeof startData.remaining === "number" ? `${startData.remaining}회` : "계산 중...";
      updownInProgress = true;
      if (playCard) playCard.classList.remove("d-none");
      gameBoard.innerHTML = `
        <div class="mb-2">숫자를 입력하고 판정 버튼을 눌러주세요.</div>
        <div class="input-group mb-2" style="max-width:320px;">
          <input type="number" class="form-control" id="guessInputDynamic" min="1" max="100" placeholder="1~100" />
          <button class="btn btn-outline-primary" id="submitGuessDynamic" type="button">판정</button>
        </div>
        <div id="updownStatusDynamic" class="text-muted">게임 시작! 남은 시도 ${remainingText}</div>
        <div id="updownTableWrapper" class="mt-3"></div>
      `;
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
  }
};

playSelectedBtn.addEventListener("click", playGame);

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
      balanceLabel.textContent = data.balance;
      renderUpdown(data.detail || {}, data);
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = `오류: ${error.message}`;
  }
};

requireLoginUI();
