const sessionForm = document.getElementById("sessionForm");
const sessionFeedback = document.getElementById("sessionFeedback");
const sessionTableBody = document.getElementById("sessionTableBody");
const resultTableBody = document.getElementById("resultTableBody");
const refreshSessionsBtn = document.getElementById("refreshSessions");
const refreshResultsBtn = document.getElementById("refreshResults");
const adjustmentForm = document.getElementById("adjustmentForm");
const adjustmentFeedback = document.getElementById("adjustmentFeedback");
const deleteSessionForm = document.getElementById("deleteSessionForm");
const deleteFeedback = document.getElementById("deleteFeedback");
const resetDatabaseBtn = document.getElementById("resetDatabase");
const saveGameSettingsBtn = document.getElementById("saveGameSettings");
const gameSettingsFeedback = document.getElementById("gameSettingsFeedback");

const formatBetChoice = (value) =>
  value === null || typeof value === "undefined" ? "-" : value;

const formatDate = (value) => {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const showFeedback = (message, variant = "success") => {
  if (!sessionFeedback) return;
  sessionFeedback.classList.remove("d-none", "alert-success", "alert-danger");
  sessionFeedback.classList.add(`alert-${variant}`);
  sessionFeedback.textContent = message;
};

const showAdjustmentFeedback = (message, variant = "success") => {
  if (!adjustmentFeedback) return;
  adjustmentFeedback.classList.remove("d-none", "alert-success", "alert-danger");
  adjustmentFeedback.classList.add(`alert-${variant}`);
  adjustmentFeedback.textContent = message;
};

const showGameSettingsFeedback = (message, variant = "info") => {
  if (!gameSettingsFeedback) return;
  gameSettingsFeedback.classList.remove(
    "d-none",
    "alert-success",
    "alert-danger",
    "alert-info"
  );
  gameSettingsFeedback.classList.add(`alert-${variant}`);
  gameSettingsFeedback.textContent = message;
};

const showDeleteFeedback = (message, variant = "info") => {
  if (!deleteFeedback) return;
  deleteFeedback.classList.remove(
    "d-none",
    "alert-success",
    "alert-danger",
    "alert-info"
  );
  deleteFeedback.classList.add(`alert-${variant}`);
  deleteFeedback.textContent = message;
};
const renderSessions = (sessions) => {
  sessionTableBody.innerHTML = sessions
    .map((session) => {
      const badge = session.used
        ? '<span class="badge bg-success">완료</span>'
        : '<span class="badge bg-secondary">미사용</span>';
      return `
        <tr>
          <td><code>${session.session_key}</code></td>
          <td>${session.game_id}</td>
          <td>${session.bet_amount}</td>
          <td>${formatDate(session.created_at)}</td>
          <td>${badge}</td>
        </tr>
      `;
    })
    .join("");
};

const renderResults = (results) => {
  resultTableBody.innerHTML = results
    .map(
      (row) => `
      <tr>
        <td><code>${row.session_key}</code></td>
        <td>${row.game_id}</td>
        <td>${formatBetChoice(row.bet_choice)}</td>
        <td>${row.result}</td>
        <td>x${row.payout_multiplier.toFixed(2)}</td>
        <td>${row.payout_amount.toFixed(2)}</td>
      </tr>
    `
    )
    .join("");
};

const fetchSessions = async () => {
  const res = await fetch("/sessions?limit=25");
  if (!res.ok) throw new Error("세션 목록을 불러오지 못했습니다.");
  const data = await res.json();
  renderSessions(data);
};

const fetchResults = async () => {
  const res = await fetch("/results?limit=25");
  if (!res.ok) throw new Error("결과 목록을 불러오지 못했습니다.");
  const data = await res.json();
  renderResults(data);
};

if (sessionForm) {
  sessionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const gameId = document.getElementById("gameSelect").value;
    const betAmount = Number(document.getElementById("betAmount").value);

    try {
      const res = await fetch("/create_session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: gameId, bet_amount: betAmount }),
      });

      if (!res.ok) {
        throw new Error("세션 생성에 실패했습니다.");
      }

      const data = await res.json();
      showFeedback(
        `새 세션 키: ${data.session_key} / 게임: ${data.game_id}`,
        "success"
      );
      sessionForm.reset();
      await fetchSessions();
    } catch (error) {
      console.error(error);
      showFeedback(error.message, "danger");
    }
  });
}

refreshSessionsBtn.addEventListener("click", () =>
  fetchSessions().catch((error) => console.error(error))
);
refreshResultsBtn.addEventListener("click", () =>
  fetchResults().catch((error) => console.error(error))
);

fetchSessions().catch((error) => console.error(error));
fetchResults().catch((error) => console.error(error));

const collectGameSettings = () => {
  const toggles = document.querySelectorAll(".game-setting-toggle");
  const assistToggles = document.querySelectorAll(
    ".game-setting-assist-toggle"
  );
  const thresholds = document.querySelectorAll(".game-setting-threshold");
  const advantages = document.querySelectorAll(".game-setting-advantage");
  const assistThresholds = document.querySelectorAll(
    ".game-setting-assist-threshold"
  );
  const assistAdvantages = document.querySelectorAll(
    ".game-setting-assist-advantage"
  );

  const map = {};
  toggles.forEach((el) => {
    map[el.dataset.gameId] = {
      game_id: el.dataset.gameId,
      risk_enabled: el.checked,
      risk_threshold: 50,
      casino_advantage_percent: 0,
      assist_enabled: false,
      assist_max_bet: 50,
      player_advantage_percent: 0,
    };
  });
  assistToggles.forEach((el) => {
    if (!map[el.dataset.gameId]) return;
    map[el.dataset.gameId].assist_enabled = el.checked;
  });
  thresholds.forEach((el) => {
    if (!map[el.dataset.gameId]) return;
    map[el.dataset.gameId].risk_threshold = Number(el.value);
  });
  advantages.forEach((el) => {
    if (!map[el.dataset.gameId]) return;
    map[el.dataset.gameId].casino_advantage_percent = Number(el.value);
  });
  assistThresholds.forEach((el) => {
    if (!map[el.dataset.gameId]) return;
    map[el.dataset.gameId].assist_max_bet = Number(el.value);
  });
  assistAdvantages.forEach((el) => {
    if (!map[el.dataset.gameId]) return;
    map[el.dataset.gameId].player_advantage_percent = Number(el.value);
  });
  return Object.values(map);
};

if (saveGameSettingsBtn) {
  saveGameSettingsBtn.addEventListener("click", async () => {
    try {
      const settings = collectGameSettings();
      const res = await fetch("/game_settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "설정 저장에 실패했습니다.");
      }
      showGameSettingsFeedback("저장되었습니다.", "success");
    } catch (error) {
      console.error(error);
      showGameSettingsFeedback(error.message, "danger");
    }
  });
}

if (adjustmentForm) {
  adjustmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amountInput = document.getElementById("adjustmentAmount");
    const noteInput = document.getElementById("adjustmentNote");
    const amount = parseFloat(amountInput.value);
    const description = noteInput.value.trim();

    if (Number.isNaN(amount) || amount === 0) {
      showAdjustmentFeedback("0이 아닌 숫자를 입력하세요.", "danger");
      return;
    }

    try {
      const res = await fetch("/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, description }),
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "조정 저장에 실패했습니다.");
      }
      const data = await res.json();
      showAdjustmentFeedback(
        `기록되었습니다. 최신 총 이익: ${data.total_profit.toFixed(
          2
        )} pts`,
        "success"
      );
      adjustmentForm.reset();
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      console.error(error);
      showAdjustmentFeedback(error.message, "danger");
    }
  });
}

const bindAdjustmentDeleteButtons = () => {
  document.querySelectorAll(".adjustment-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const adjustmentId = button.getAttribute("data-adjustment-id");
      if (
        !adjustmentId ||
        !window.confirm("이 조정 기록을 삭제할까요?")
      ) {
        return;
      }
      try {
        const res = await fetch(`/adjustments/${adjustmentId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "조정 삭제에 실패했습니다.");
        }
        const data = await res.json();
        showAdjustmentFeedback(
          `삭제되었습니다. 최신 총 이익: ${data.total_profit.toFixed(
            2
          )} pts`,
          "success"
        );
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        console.error(error);
        showAdjustmentFeedback(error.message, "danger");
      }
    });
  });
};

bindAdjustmentDeleteButtons();

if (deleteSessionForm) {
  deleteSessionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sessionKey = document
      .getElementById("deleteSessionKey")
      .value.trim();
    if (!sessionKey) {
      showDeleteFeedback("세션 키를 입력하세요.", "danger");
      return;
    }
    try {
      const res = await fetch(`/sessions/${sessionKey}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "세션 삭제에 실패했습니다.");
      }
      const data = await res.json();
      showDeleteFeedback(
        `세션 ${sessionKey} 삭제 완료. 현재 총 이익: ${data.total_profit.toFixed(
          2
        )} pts`,
        "success"
      );
      deleteSessionForm.reset();
      await fetchSessions();
      await fetchResults();
    } catch (error) {
      console.error(error);
      showDeleteFeedback(error.message, "danger");
    }
  });
}

if (resetDatabaseBtn) {
  resetDatabaseBtn.addEventListener("click", async () => {
    if (!window.confirm("세션/결과 데이터를 모두 삭제할까요?")) {
      return;
    }
    try {
      const res = await fetch("/reset", {
        method: "DELETE",
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "초기화에 실패했습니다.");
      }
      const data = await res.json();
      showDeleteFeedback(
        `전체 삭제 완료 (세션 ${data.deleted_sessions}건, 결과 ${data.deleted_results}건)`,
        "info"
      );
      await fetchSessions();
      await fetchResults();
    } catch (error) {
      console.error(error);
      showDeleteFeedback(error.message, "danger");
    }
  });
}
