(function () {
const jsonHeaders = { "Content-Type": "application/json" };

let gameSettingsCache = {};
const defaultSetting = {
  risk_enabled: false,
  risk_threshold: 50,
  casino_advantage_percent: 0,
  assist_enabled: false,
  assist_max_bet: 50,
  player_advantage_percent: 0,
};

const loadGameSettings = async () => {
  try {
    const res = await fetch("/game_settings");
    if (!res.ok) return;
    const data = await res.json();
    gameSettingsCache = data.reduce((acc, item) => {
      acc[item.game_id] = item;
      return acc;
    }, {});
  } catch (error) {
    console.warn("게임 설정을 불러오지 못했습니다.", error);
  }
};
const settingsPromise = loadGameSettings();

  async function verifySessionKey(sessionKey) {
    const res = await fetch("/verify_key", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ session_key: sessionKey.trim() }),
    });
    if (!res.ok) throw new Error("서버와 통신할 수 없습니다.");
    return res.json();
  }

  async function reportGameResult(payload) {
    const res = await fetch("/report_result", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || "결과 보고에 실패했습니다.");
    }
    return res.json();
  }

  const MAX_ATTEMPTS = 5;
  const MULTIPLIERS = [7, 5, 4, 3, 2];

  function renderUpDownGame(container, session, onComplete) {
    const betAmount = session.bet_amount;
    const setting = session.settings || defaultSetting;
    const riskActive =
      setting.risk_enabled && betAmount >= setting.risk_threshold;
    const playerActive =
      setting.assist_enabled && betAmount <= setting.assist_max_bet;
    const casinoProb = Math.max(
      0,
      Math.min(1, (setting.casino_advantage_percent || 0) / 100)
    );
    const playerProb = Math.max(
      0,
      Math.min(1, (setting.player_advantage_percent || 0) / 100)
    );
    container.innerHTML = "";
    let target = Math.floor(Math.random() * 100) + 1;
    let attempts = 0;
    let lowerBound = 1;
    let upperBound = 100;
    let finished = false;
    const guesses = [];

    const statusBox = document.createElement("div");
    statusBox.className = "alert alert-info";
    statusBox.innerHTML =
      "1~100 사이 숫자를 맞춰보세요. 최대 5회까지 시도할 수 있습니다.";

    const rangeInfo = document.createElement("p");
    rangeInfo.className = "text-small mt-2";
    rangeInfo.innerHTML = `현재 범위: <strong>${lowerBound}</strong> ~ <strong>${upperBound}</strong>`;

    const form = document.createElement("form");
    form.className = "row g-3 align-items-end";
    form.innerHTML = `
      <div class="col-md-6">
        <label class="form-label" for="guessInput">추측 값</label>
        <input type="number" id="guessInput" class="form-control" min="1" max="100" required />
      </div>
      <div class="col-md-3">
        <label class="form-label">남은 시도</label>
        <div id="attemptsLeft" class="fs-4 fw-bold text-primary">${MAX_ATTEMPTS}</div>
      </div>
      <div class="col-md-3 d-grid">
        <button type="submit" class="btn btn-success">판정</button>
      </div>
    `;

    const feedback = document.createElement("div");
    feedback.className = "mt-3";
    const summaryBox = document.createElement("div");

    function finishGame(didWin) {
      if (finished) return;
      finished = true;
      const multiplier = didWin ? MULTIPLIERS[attempts - 1] : 0;
      const payoutAmount = betAmount * multiplier;
      summaryBox.className = `alert mt-4 ${
        didWin ? "alert-success" : "alert-danger"
      }`;
      summaryBox.innerHTML = `
        <h5 class="alert-heading">${
          didWin ? "성공" : "실패"
        }! 정답은 ${target} 입니다.</h5>
        <p class="mb-1">총 시도: ${attempts}회</p>
        <p class="mb-1">배당 배율: x${multiplier.toFixed(2)}</p>
        <p class="mb-0">예상 획득 포인트: ${payoutAmount.toFixed(2)}</p>
      `;
      form.querySelector("button").disabled = true;
      form.querySelector("input").disabled = true;
      onComplete({
        result: didWin ? "win" : "lose",
        payoutMultiplier: multiplier,
        detail: {
          target,
          guesses,
          attempts,
          success: didWin,
        },
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (finished) return;
      const input = form.querySelector("#guessInput");
      const value = Number(input.value);
      if (Number.isNaN(value) || value < 1 || value > 100) {
        feedback.innerHTML =
          '<div class="alert alert-warning">1~100 사이 숫자를 입력하세요.</div>';
        return;
      }
      attempts += 1;
      guesses.push(value);
      form.querySelector("#attemptsLeft").textContent = `${
        MAX_ATTEMPTS - attempts
      }`;

      // 보정: 카지노/유저 우세 각각 정답을 불리/유리 방향으로 이동
      if (riskActive && value !== target && Math.random() < casinoProb) {
        if (value < target) {
          const shift = Math.max(1, Math.floor((upperBound - value) / 3));
          target = Math.min(upperBound, target + shift);
        } else {
          const shift = Math.max(1, Math.floor((value - lowerBound) / 3));
          target = Math.max(lowerBound, target - shift);
        }
      } else if (playerActive && value !== target && Math.random() < playerProb) {
        if (value < target) {
          const shift = Math.max(1, Math.floor((target - value) / 3));
          target = Math.max(value + 1, target - shift);
        } else {
          const shift = Math.max(1, Math.floor((value - target) / 3));
          target = Math.min(value - 1, target + shift);
        }
      }

      if (value === target) {
        feedback.innerHTML =
          '<div class="alert alert-success">정답입니다! 🎉</div>';
        finishGame(true);
      } else if (value < target) {
        lowerBound = Math.max(lowerBound, value + 1);
        feedback.innerHTML =
          '<div class="alert alert-secondary">UP! 더 큰 숫자입니다.</div>';
      } else {
        upperBound = Math.min(upperBound, value - 1);
        feedback.innerHTML =
          '<div class="alert alert-secondary">DOWN! 더 작은 숫자입니다.</div>';
      }
      rangeInfo.innerHTML = `현재 범위: <strong>${lowerBound}</strong> ~ <strong>${upperBound}</strong>`;

      if (attempts >= MAX_ATTEMPTS && !finished) {
        finishGame(false);
      }
      form.reset();
    });

    container.appendChild(statusBox);
    container.appendChild(rangeInfo);
    container.appendChild(form);
    container.appendChild(feedback);
    container.appendChild(summaryBox);
  }

const SLOT_SYMBOLS = ["A", "B", "C", "D", "7"];

  function getRandomSymbol() {
    return SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
  }

  function calculateSlotMultiplier(symbols) {
    const [a, b, c] = symbols;
    if (a === "7" && b === "7" && c === "7") return 10;
    if (a === b && b === c) return 5;
    if (a === b || a === c || b === c) return 1.5;
    return 0;
  }

  function renderSlotGame(container, session, onComplete) {
    const betAmount = session.bet_amount;
    const setting = session.settings || defaultSetting;
    const riskActive =
      setting.risk_enabled && betAmount >= setting.risk_threshold;
    const playerActive =
      setting.assist_enabled && betAmount <= setting.assist_max_bet;
    const casinoProb = Math.max(
      0,
      Math.min(1, (setting.casino_advantage_percent || 0) / 100)
    );
    const playerProb = Math.max(
      0,
      Math.min(1, (setting.player_advantage_percent || 0) / 100)
    );
    container.innerHTML = "";
    let spinning = false;
    let intervalId = null;

    const reelWrapper = document.createElement("div");
    reelWrapper.className = "d-flex justify-content-center gap-2 mb-4";
    for (let i = 0; i < 3; i += 1) {
      const span = document.createElement("div");
      span.className = "slot-symbol";
      span.textContent = SLOT_SYMBOLS[i];
      reelWrapper.appendChild(span);
    }

    const infoText = document.createElement("p");
    infoText.textContent = "슬롯 버튼을 눌러 결과를 확인하세요.";

    const spinButton = document.createElement("button");
    spinButton.className = "btn btn-danger btn-lg w-100";
    spinButton.textContent = "SPIN!";

    const resultBox = document.createElement("div");

    function stopAnimation() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function finishSpin() {
      spinning = false;
      stopAnimation();
      const symbols = Array.from(reelWrapper.children).map(
        (node) => node.textContent
      );
      let multiplier = calculateSlotMultiplier(symbols);
      if (riskActive && multiplier > 0 && Math.random() < casinoProb) {
        // 카지노 우세: 당첨이면 꽝이 될 때까지 재굴림 시도
        let attempts = 0;
        while (attempts < 30 && multiplier > 0) {
          Array.from(reelWrapper.children).forEach((node) => {
            node.textContent = getRandomSymbol();
          });
          const reroll = Array.from(reelWrapper.children).map(
            (node) => node.textContent
          );
          multiplier = calculateSlotMultiplier(reroll);
          attempts += 1;
        }
      } else if (playerActive && multiplier === 0 && Math.random() < playerProb) {
        // 유저 우세: 꽝이면 당첨이 될 때까지 재굴림 시도
        let attempts = 0;
        while (attempts < 30 && multiplier === 0) {
          Array.from(reelWrapper.children).forEach((node) => {
            node.textContent = getRandomSymbol();
          });
          const reroll = Array.from(reelWrapper.children).map(
            (node) => node.textContent
          );
          multiplier = calculateSlotMultiplier(reroll);
          attempts += 1;
        }
      }
      const payoutAmount = betAmount * multiplier;
      resultBox.className = `alert mt-4 ${
        multiplier > 0 ? "alert-success" : "alert-warning"
      }`;
      resultBox.innerHTML = `
        <h5 class="alert-heading">${
          multiplier > 0
            ? `축하합니다! 배당 x${multiplier.toFixed(2)}`
            : "꽝! 포인트 획득 없음"
        }</h5>
        <p class="mb-1">결과: ${symbols.join(" | ")}</p>
        <p class="mb-0">예상 획득 포인트: ${payoutAmount.toFixed(2)}</p>
      `;
      spinButton.disabled = true;
      onComplete({
        result: multiplier > 0 ? "win" : "lose",
        payoutMultiplier: multiplier,
        detail: {
          symbols,
          payoutMultiplier: multiplier,
        },
      });
    }

    spinButton.addEventListener("click", function () {
      if (spinning) return;
      spinning = true;
      resultBox.innerHTML = "";
      spinButton.disabled = true;
      const duration = 1500 + Math.random() * 1000;
      const start = performance.now();

      intervalId = setInterval(() => {
        Array.from(reelWrapper.children).forEach((node) => {
          node.textContent = getRandomSymbol();
        });
        if (performance.now() - start >= duration) {
          stopAnimation();
          Array.from(reelWrapper.children).forEach((node) => {
            node.textContent = getRandomSymbol();
          });
          finishSpin();
        }
      }, 80);
    });

    container.appendChild(infoText);
    container.appendChild(reelWrapper);
    container.appendChild(spinButton);
    container.appendChild(resultBox);
  }

  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];

  function cardValue(rank) {
    if (rank === "A") return 1;
    if (rank === "10" || rank === "J" || rank === "Q" || rank === "K") {
      return 0;
    }
    return Number(rank);
  }

  function createDeck(deckCount) {
    const deck = [];
    for (let d = 0; d < deckCount; d += 1) {
      SUITS.forEach((suit) => {
        RANKS.forEach((rank) => {
          deck.push({ suit, rank, value: cardValue(rank) });
        });
      });
    }
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = deck[i];
      deck[i] = deck[j];
      deck[j] = temp;
    }
    return deck;
  }

  function drawCard(deck) {
    if (!deck.length) throw new Error("덱이 비어 있습니다.");
    return deck.pop();
  }

  function handValue(hand) {
    return hand.reduce((acc, card) => acc + card.value, 0) % 10;
  }

  function shouldBankerDraw(bankerValue, playerThirdCardValue) {
    if (playerThirdCardValue === null) {
      return bankerValue <= 5;
    }
    if (bankerValue <= 2) return true;
    if (bankerValue === 3) return playerThirdCardValue !== 8;
    if (bankerValue === 4)
      return [2, 3, 4, 5, 6, 7].indexOf(playerThirdCardValue) >= 0;
    if (bankerValue === 5)
      return [4, 5, 6, 7].indexOf(playerThirdCardValue) >= 0;
    if (bankerValue === 6)
      return [6, 7].indexOf(playerThirdCardValue) >= 0;
    return false;
  }

  const FACE_DOWN_SYMBOL = "?";
  function renderHand(wrapper, hand, visibleCount = null, title) {
    const count =
      visibleCount !== null && typeof visibleCount !== "undefined"
        ? visibleCount
        : hand.length > 0
        ? hand.length
        : 2;
    const cardsHtml = Array.from({ length: count })
      .map((_, index) => {
        const card = hand[index];
        return `<span class="baccarat-card">${
          card ? `${card.suit}${card.rank}` : FACE_DOWN_SYMBOL
        }</span>`;
      })
      .join("");
    const totalText =
      hand.length === count && count > 0 ? handValue(hand) : "??";
    wrapper.innerHTML = `
      <p class="text-muted mb-1">${title}</p>
      <div class="card-pile mb-2">${cardsHtml}</div>
      <p class="mb-0 fw-bold">합계: ${totalText}</p>
    `;
  }

  function drawFromDeckStack(deck) {
    if (!deck.length) {
      throw new Error("덱이 비었습니다.");
    }
    return deck.pop();
  }

  function simulateBaccaratOutcome(deckSource) {
    const deck = [...deckSource];
    const draw = () => drawFromDeckStack(deck);
    const playerHand = [];
    const bankerHand = [];
    for (let i = 0; i < 2; i += 1) playerHand.push(draw());
    for (let i = 0; i < 2; i += 1) bankerHand.push(draw());

    let playerValue = handValue(playerHand);
    let bankerValue = handValue(bankerHand);
    let playerThirdCard = null;
    let bankerThirdCard = null;

    const natural =
      playerValue >= 8 || bankerValue >= 8 ? Math.max(playerValue, bankerValue) : null;
    if (natural === null) {
      if (playerValue <= 5) {
        playerThirdCard = draw();
        playerHand.push(playerThirdCard);
        playerValue = handValue(playerHand);
      }
      const playerThirdValue =
        playerThirdCard === null ? null : playerThirdCard.value;
      if (shouldBankerDraw(bankerValue, playerThirdValue)) {
        bankerThirdCard = draw();
        bankerHand.push(bankerThirdCard);
        bankerValue = handValue(bankerHand);
      }
    }

    const outcome =
      playerValue > bankerValue
        ? "player"
        : bankerValue > playerValue
        ? "banker"
        : "tie";

    return outcome;
  }

  function pickRiggedOutcome() {
    const roll = Math.random();
    if (roll < 0.7) {
      return "player";
    }
    if (roll < 0.95) {
      return "banker";
    }
    return "tie";
  }

  function generateRiggedDeck(targetOutcome, maxAttempts = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const deck = createDeck(2);
      const outcome = simulateBaccaratOutcome(deck);
      if (outcome === targetOutcome) {
        return deck;
      }
    }
    return null;
  }

  function renderBaccaratGame(container, session, onComplete) {
    container.innerHTML = `
      <p>Player / Banker / Tie 중 하나를 선택하고 게임을 진행합니다.</p>
      <div class="btn-group mb-3" role="group">
        <input type="radio" class="btn-check" name="betChoice" id="betPlayer" value="player" checked />
        <label class="btn btn-outline-primary" for="betPlayer">Player</label>

        <input type="radio" class="btn-check" name="betChoice" id="betBanker" value="banker" />
        <label class="btn btn-outline-danger" for="betBanker">Banker</label>

        <input type="radio" class="btn-check" name="betChoice" id="betTie" value="tie" />
        <label class="btn btn-outline-secondary" for="betTie">Tie</label>
      </div>
      <div class="row g-4 mb-3">
        <div class="col-md-6" id="playerHand"></div>
        <div class="col-md-6" id="bankerHand"></div>
      </div>
      <div class="d-grid mb-3">
        <button class="btn btn-success btn-lg" id="dealButton">딜 진행</button>
      </div>
      <div id="progressLog">
        <h6 class="text-muted">진행 로그</h6>
        <ol class="small" id="logList"></ol>
      </div>
      <div id="baccaratSummary"></div>
    `;

  const dealButton = container.querySelector("#dealButton");
  const playerHandEl = container.querySelector("#playerHand");
  const bankerHandEl = container.querySelector("#bankerHand");
  const logList = container.querySelector("#logList");
  const summaryEl = container.querySelector("#baccaratSummary");
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const setting = session.settings || defaultSetting;
  const casinoProb = Math.max(
    0,
    Math.min(1, (setting.casino_advantage_percent || 0) / 100)
  );
  const playerProb = Math.max(
    0,
    Math.min(1, (setting.player_advantage_percent || 0) / 100)
  );

    function appendLog(message) {
      const item = document.createElement("li");
      item.textContent = message;
      Array.from(logList.children).forEach((el) =>
        el.classList.remove("log-active")
      );
      item.classList.add("log-active");
      logList.appendChild(item);
    }

    async function revealInitialHand(
      targetHand,
      handElement,
      label,
      deck,
      visibleCount,
      perCardDelay
    ) {
      for (let i = 0; i < visibleCount; i += 1) {
        const card = drawCard(deck);
        targetHand.push(card);
        appendLog(`${label} 카드 공개: ${card.suit}${card.rank}`);
        renderHand(handElement, targetHand, visibleCount, label);
        await wait(perCardDelay);
      }
      appendLog(`${label} 카드 공개 완료`);
    }

    async function playRound() {
      const betChoice = container.querySelector(
        'input[name="betChoice"]:checked'
      ).value;

      const casinoActive =
        setting.risk_enabled &&
        session.bet_amount >= setting.risk_threshold &&
        Math.random() < casinoProb;
      const playerActive =
        setting.assist_enabled &&
        session.bet_amount <= setting.assist_max_bet &&
        Math.random() < playerProb;

      let targetOutcome = null;
      if (casinoActive) {
        if (betChoice === "player") targetOutcome = "banker";
        else if (betChoice === "banker") targetOutcome = "player";
        else targetOutcome = "banker";
      } else if (playerActive) {
        targetOutcome = betChoice;
      }

      let riggedDeck = null;
      if (targetOutcome) {
        riggedDeck = generateRiggedDeck(targetOutcome);
      }

      const deck = riggedDeck ? [...riggedDeck] : createDeck(2);
      const playerHand = [];
      const bankerHand = [];
      let playerVisible = 2;
      let bankerVisible = 2;
      let playerThirdCard = null;
      let bankerThirdCard = null;

      //if (riskMode && riggedDeck) {
      //  appendLog("리스크 판: 카지노 우세 시나리오 적용 중...");
      //}
      appendLog("카드 배분을 시작합니다.");
      renderHand(playerHandEl, playerHand, playerVisible, "PLAYER");
      renderHand(bankerHandEl, bankerHand, bankerVisible, "BANKER");
      await wait(1000);
      appendLog("PLAYER 카드 공개 중...");
      await revealInitialHand(
        playerHand,
        playerHandEl,
        "PLAYER",
        deck,
        playerVisible,
        1000
      );
      await wait(2000);
      appendLog("BANKER 카드 공개 중...");
      await revealInitialHand(
        bankerHand,
        bankerHandEl,
        "BANKER",
        deck,
        bankerVisible,
        1000
      );
      await wait(1000);

      let playerValue = handValue(playerHand);
      let bankerValue = handValue(bankerHand);

      const natural =
        playerValue >= 8 || bankerValue >= 8 ? Math.max(playerValue, bankerValue) : null;
      if (natural !== null) {
        appendLog("Natural 발생! 추가 카드는 없습니다.");
      } else {
        if (playerValue <= 5) {
          playerVisible = 3;
          renderHand(playerHandEl, playerHand, playerVisible, "PLAYER");
          await wait(1000);
          playerThirdCard = drawCard(deck);
          playerHand.push(playerThirdCard);
          appendLog("PLAYER 보충 카드 공개 중...");
          playerValue = handValue(playerHand);
          renderHand(playerHandEl, playerHand, playerVisible, "PLAYER");
          appendLog(`Player 3번째 카드: ${playerThirdCard.suit}${playerThirdCard.rank}`);
        } else {
          appendLog("Player는 추가 카드를 받지 않습니다.");
        }

        const playerThirdValue =
          playerThirdCard === null ? null : playerThirdCard.value;
        if (shouldBankerDraw(bankerValue, playerThirdValue)) {
          bankerVisible = 3;
          renderHand(bankerHandEl, bankerHand, bankerVisible, "BANKER");
          await wait(1000);
          bankerThirdCard = drawCard(deck);
          bankerHand.push(bankerThirdCard);
          appendLog("BANKER 보충 카드 공개 중...");
          appendLog(
            `Banker 3번째 카드: ${bankerThirdCard.suit}${bankerThirdCard.rank}`
          );
          bankerValue = handValue(bankerHand);
          renderHand(bankerHandEl, bankerHand, bankerVisible, "BANKER");
        } else {
          appendLog("Banker는 추가 카드를 받지 않습니다.");
        }
      }

      const outcome =
        playerValue > bankerValue
          ? "player"
          : bankerValue > playerValue
          ? "banker"
          : "tie";

      const betChoice = container.querySelector(
        'input[name="betChoice"]:checked'
      ).value;

      let payoutMultiplier = 0;
      let resultStatus = "lose";

      if (outcome === "tie") {
        if (betChoice === "tie") {
          payoutMultiplier = 8; // Tie 8:1 (some tables pay 9:1 or higher).
          resultStatus = "win";
        } else {
          resultStatus = "tie";
        }
      } else if (betChoice === outcome) {
        resultStatus = "win";
        payoutMultiplier =
          outcome === "player"
            ? 2 // Player 1:1 payout -> total return x2.
            : 1.95; // Banker 1:1 minus 5% commission -> total return x1.95.
      }

      const outcomeText =
        outcome === "tie"
          ? "Tie"
          : outcome === "player"
          ? "Player 승"
          : "Banker 승";

      appendLog(
        `최종 판정: ${outcomeText} / 베팅 결과: ${resultStatus.toUpperCase()}`
      );

      await wait(2000);
      summaryEl.className = `alert mt-3 ${
        resultStatus === "win"
          ? "alert-success"
          : resultStatus === "tie"
          ? "alert-info"
          : "alert-warning"
      }`;
      summaryEl.innerHTML = `
        <h5 class="alert-heading">베팅 결과: ${resultStatus.toUpperCase()}</h5>
        <p class="mb-1">선택: ${betChoice.toUpperCase()}</p>
        <p class="mb-1">Player 합: ${playerValue} / Banker 합: ${bankerValue}</p>
        <p class="mb-0">배당 배율: x${payoutMultiplier.toFixed(2)}</p>
      `;

      dealButton.disabled = true;
      onComplete({
        result: resultStatus,
        payoutMultiplier,
        betChoice,
        detail: {
          playerHand: playerHand.map((card) => `${card.suit}${card.rank}`),
          bankerHand: bankerHand.map((card) => `${card.suit}${card.rank}`),
          playerValue,
          bankerValue,
          outcome,
          logs: Array.from(logList.children).map((item) => item.textContent),
        },
      });
    }

    dealButton.addEventListener("click", async function () {
      if (dealButton.disabled) return;
      logList.innerHTML = "";
      summaryEl.innerHTML = "";
      dealButton.disabled = true;
      await playRound();
    });
  }

  const gameConfig = {
    updown: {
      name: "업다운 (숫자 맞추기)",
      render: renderUpDownGame,
    },
    slot: {
      name: "슬롯 머신 (3릴)",
      render: renderSlotGame,
    },
    baccarat: {
      name: "바카라",
      render: renderBaccaratGame,
    },
  };

  const keyForm = document.getElementById("keyForm");
  const keyFeedback = document.getElementById("keyFeedback");
  const sessionInfo = document.getElementById("sessionInfo");
  const gameName = document.getElementById("gameName");
  const betAmountDisplay = document.getElementById("betAmount");
  const startButton = document.getElementById("startGame");
  const gameArea = document.getElementById("gameArea");
  const gamePlaceholder = document.getElementById("gamePlaceholder");
  const resultArea = document.getElementById("resultArea");
  const resultSummary = document.getElementById("resultSummary");
  const reportButton = document.getElementById("reportResult");
  const verifyButton = keyForm
    ? keyForm.querySelector('button[type="submit"]')
    : null;

  if (!keyForm) {
    return;
  }

  let currentSession = null;
  let pendingResult = null;

  function resetUI(preserveKey) {
    if (!preserveKey) keyForm.reset();
    currentSession = null;
    pendingResult = null;
    startButton.disabled = true;
    startButton.classList.remove("d-none");
    if (verifyButton) {
      verifyButton.disabled = false;
    }
    reportButton.disabled = true;
    sessionInfo.classList.add("d-none");
    gameArea.classList.add("d-none");
    resultArea.classList.add("d-none");
    resultSummary.textContent = "아직 결과가 없습니다.";
    gamePlaceholder.innerHTML = "세션 키를 검증한 뒤 게임을 시작하세요.";
  }

  function showFeedback(message, success) {
    keyFeedback.classList.remove("d-none", "alert-success", "alert-danger");
    keyFeedback.classList.add(`alert-${success ? "success" : "danger"}`);
    keyFeedback.textContent = message;
  }

keyForm.addEventListener("submit", function (event) {
  event.preventDefault();
  const sessionKey = document.getElementById("sessionKey").value.trim();
  if (!sessionKey) {
    showFeedback("세션 키를 입력하세요.", false);
    return;
  }
  settingsPromise
    .catch(() => {})
    .then(() => verifySessionKey(sessionKey))
    .then((response) => {
      if (!response.valid) {
        showFeedback(
          response.message || "세션 키가 유효하지 않습니다.",
          false
          );
          resetUI(true);
          return;
        }
      currentSession = {
        session_key: response.session_key,
        game_id: response.game_id,
        bet_amount: response.bet_amount,
        settings: gameSettingsCache[response.game_id] || defaultSetting,
      };
        sessionInfo.classList.remove("d-none");
        const config = gameConfig[currentSession.game_id];
        gameName.textContent =
          config && config.name ? config.name : currentSession.game_id;
        betAmountDisplay.textContent = `${currentSession.bet_amount.toLocaleString()} pts`;
        startButton.disabled = false;
        startButton.classList.remove("d-none");
        keyFeedback.classList.add("d-none");
        pendingResult = null;
        if (verifyButton) {
          verifyButton.disabled = true;
        }
        reportButton.disabled = true;
        gameArea.classList.add("d-none");
        resultArea.classList.add("d-none");
        resultSummary.textContent = "아직 결과가 없습니다.";
      })
      .catch((error) => {
        showFeedback(error.message, false);
      });
  });

  startButton.addEventListener("click", function () {
    if (!currentSession) {
      showFeedback("먼저 세션 키를 확인하세요.", false);
      return;
    }
    const config = gameConfig[currentSession.game_id];
    if (!config) {
      showFeedback("지원되지 않는 게임입니다.", false);
      return;
    }
    pendingResult = null;
    reportButton.disabled = true;
    resultSummary.textContent = "게임 진행 중입니다.";
    startButton.classList.add("d-none");
    gameArea.classList.remove("d-none");
    resultArea.classList.remove("d-none");
    gamePlaceholder.innerHTML = "";
    config.render(gamePlaceholder, currentSession, function (resultPayload) {
      pendingResult = resultPayload;
      const multiplier =
        typeof resultPayload.payoutMultiplier === "number"
          ? resultPayload.payoutMultiplier
          : 0;
      resultSummary.textContent = `결과: ${
        resultPayload.result
      } / 배당 x${multiplier.toFixed(2)}`;
      reportButton.disabled = false;
    });
  });

  reportButton.addEventListener("click", function () {
    if (!currentSession || !pendingResult) {
      showFeedback("먼저 게임을 완료하세요.", false);
      return;
    }
    reportButton.disabled = true;
    reportButton.textContent = "전송 중...";
    const payoutMultiplier =
      typeof pendingResult.payoutMultiplier === "number"
        ? pendingResult.payoutMultiplier
        : 0;
    const payload = {
      session_key: currentSession.session_key,
      game_id: currentSession.game_id,
      bet_amount: currentSession.bet_amount,
      result: pendingResult.result,
      payout_multiplier: payoutMultiplier,
      payout_amount: currentSession.bet_amount * payoutMultiplier,
      timestamp: new Date().toISOString(),
      bet_choice:
        typeof pendingResult.betChoice === "undefined"
          ? null
          : pendingResult.betChoice,
      detail: pendingResult.detail
        ? JSON.stringify(pendingResult.detail)
        : null,
    };
    reportGameResult(payload)
      .then(() => {
        resultSummary.textContent += " · 서버 전송 완료 ✅";
        startButton.disabled = true;
        showFeedback("결과가 기록되었습니다.", true);
      })
      .catch((error) => {
        showFeedback(error.message, false);
        reportButton.disabled = false;
      })
      .finally(() => {
        reportButton.textContent = "서버에 결과 전송";
      });
  });
})();
