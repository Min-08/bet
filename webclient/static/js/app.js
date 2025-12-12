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
const updownExtra = document.getElementById("updownExtra");
const baccaratExtra = document.getElementById("baccaratExtra");
const betAmountInput = document.getElementById("betAmount");
const betChoiceBaccarat = document.getElementById("betChoiceBaccarat");
const playSelectedBtn = document.getElementById("playSelected");
const gameBoard = document.getElementById("gameBoard");

let currentGame = null;
let updownInProgress = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const requireLoginUI = async () => {
  if (!auth.token) return;
  try {
    await updateMe();
    authCard.classList.add("d-none");
    appArea.classList.remove("d-none");
  } catch (e) {
    auth.clear();
    authCard.classList.remove("d-none");
    appArea.classList.add("d-none");
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
    if (!res.ok) throw new Error("로그인 실패: 이름/PIN을 확인하세요.");
    const data = await res.json();
    auth.save(data.token);
    hideAlert(loginFeedback);
    await requireLoginUI();
  } catch (err) {
    showAlert(loginFeedback, err.message, "danger");
  }
});

logoutBtn.addEventListener("click", () => {
  auth.clear();
  appArea.classList.add("d-none");
  authCard.classList.remove("d-none");
});

refreshBalanceBtn.addEventListener("click", () => {
  updateMe().catch((err) => showAlert(loginFeedback, err.message, "danger"));
});

gameSelectButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentGame = btn.dataset.game;
    updownInProgress = false;
    selectedGameTitle.textContent = `선택된 게임: ${btn.textContent}`;
    updownExtra.style.display = currentGame === "updown" ? "block" : "none";
    baccaratExtra.style.display = currentGame === "baccarat" ? "block" : "none";
    gameBoard.innerHTML = `<p class="text-muted mb-0">${btn.textContent}을 선택했습니다. 베팅 후 게임 시작을 눌러주세요.</p>`;
  });
});

const renderSlot = (detail, payload) => {
  const finalSymbols = detail.symbols || [];
  const slots = ["?", "?", "?"]; // initial placeholder
  gameBoard.innerHTML = `
    <div class="text-center">
      <div class="d-flex justify-content-center gap-3 mb-3" id="slotRow">
        ${slots.map((s, idx) => `<div class="slot-symbol" data-slot-index="${idx}">${s}</div>`).join("")}
      </div>
      <p class="mb-1" id="slotStatus">스핀 중...</p>
      <p class="mb-0" id="slotResult"></p>
    </div>
  `;
  const row = document.getElementById("slotRow");
  const statusEl = document.getElementById("slotStatus");
  const resultEl = document.getElementById("slotResult");
  const allSymbols = ["A", "B", "C", "D", "7"];
  let spinIndex = 0;
  let ticks = 0;
  const spin = setInterval(() => {
    Array.from(row.children).forEach((node) => {
      const symbol = allSymbols[(spinIndex + Number(node.dataset?.slotIndex || 0)) % allSymbols.length];
      node.textContent = symbol;
    });
    spinIndex = (spinIndex + 1) % allSymbols.length;
    ticks += 1;
    if (ticks > 15) {
      clearInterval(spin);
      Array.from(row.children).forEach((node, idx) => {
        node.textContent = finalSymbols[idx] || "?";
      });
      statusEl.textContent = `결과: ${payload.result} / 배당 x${payload.payout_multiplier.toFixed(2)}`;
      resultEl.textContent = `증감: ${payload.delta} pt / 잔액: ${payload.balance} pt`;
    }
  }, 80);
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
  const remaining = 5 - (detail.attempts || 0);
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

  gameBoard.innerHTML = `
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
  const bet = Number(betAmountInput.value);
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
      updownInProgress = true;
      gameBoard.innerHTML = `
        <div class="mb-2">숫자를 입력하고 판정 버튼을 눌러주세요.</div>
        <div class="input-group mb-2" style="max-width:320px;">
          <input type="number" class="form-control" id="guessInputDynamic" min="1" max="100" placeholder="1~100" />
          <button class="btn btn-outline-primary" id="submitGuessDynamic" type="button">판정</button>
        </div>
        <div id="updownStatusDynamic" class="text-muted">게임 시작! 남은 시도 5회</div>
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
    body.bet_choice = betChoiceBaccarat.value;
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
