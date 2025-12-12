const adminSecretInput = document.getElementById("adminSecret");
const adminFeedback = document.getElementById("adminFeedback");
const adminAuthBtn = document.getElementById("adminAuthBtn");
const userCreateForm = document.getElementById("userCreateForm");
const userTableBody = document.getElementById("userTableBody");
const searchUserInput = document.getElementById("searchUser");
const refreshUsersBtn = document.getElementById("refreshUsers");
const saveGameSettingsBtn = document.getElementById("saveGameSettings");
const gameSettingsFeedback = document.getElementById("gameSettingsFeedback");
const refreshLogsBtn = document.getElementById("refreshLogs");
const gameLogList = document.getElementById("gameLogList");
const gameLogStatus = document.getElementById("gameLogStatus");
let gameLogTimer = null;

const getAdminHeader = () => ({
  "admin-secret": adminSecretInput.value || "",
});

const showAdminFeedback = (msg, variant = "info") => {
  if (!adminFeedback) return;
  adminFeedback.classList.remove("alert-info", "alert-success", "alert-danger");
  adminFeedback.classList.add(`alert-${variant}`);
  adminFeedback.textContent = msg;
};

const renderUsers = (users) => {
  userTableBody.innerHTML = users
    .map(
      (u) => `
      <tr>
        <td>${u.name}</td>
        <td>${u.pin || "----"}</td>
        <td>${u.balance}</td>
        <td>
          <div class="input-group input-group-sm">
            <input type="number" class="form-control adjust-input" data-user-id="${u.id}" placeholder="±포인트" />
            <button class="btn btn-outline-primary adjust-btn" data-user-id="${u.id}">적용</button>
            <button class="btn btn-outline-danger delete-btn" data-user-id="${u.id}">삭제</button>
          </div>
          <div class="mt-2">
            <button class="btn btn-link btn-sm detail-btn" data-user-id="${u.id}">상세 정보</button>
            <div class="transaction-log" id="txn-${u.id}" style="display:none;"></div>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
  bindAdjustButtons();
  bindDeleteButtons();
  bindDetailButtons();
};

const fetchUsers = async () => {
  const query = searchUserInput.value.trim();
  const res = await fetch(`/api/admin/users${query ? `?search=${encodeURIComponent(query)}` : ""}`, {
    headers: getAdminHeader(),
  });
  if (res.status === 401) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }
  if (!res.ok) throw new Error("계정 목록을 불러오지 못했습니다.");
  const data = await res.json();
  renderUsers(data);
  showAdminFeedback("계정 목록을 불러왔습니다.", "success");
};

const renderGameLogs = (logs) => {
  if (!gameLogList) return;
  if (!logs.length) {
    gameLogList.innerHTML = "<div class='text-muted small'>로그 없음</div>";
    return;
  }
  gameLogList.innerHTML = logs
    .map(
      (log) => `
        <div class="game-log-item">
          <div class="small text-muted">${log.created_at_kst}</div>
          <div><strong>${log.user_name || "알 수 없음"}</strong> / ${log.game_id || "-"}</div>
          <div class="text-break">${log.action}${log.detail ? ` - ${log.detail}` : ""}</div>
        </div>
      `
    )
    .join("");
};

const fetchGameLogs = async () => {
  if (!gameLogList) return;
  if (gameLogStatus) gameLogStatus.textContent = "로그 불러오는 중...";
  const res = await fetch("/api/admin/game_logs?limit=200", {
    headers: getAdminHeader(),
  });
  if (res.status === 401) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }
  if (!res.ok) throw new Error("게임 로그를 불러오지 못했습니다.");
  const data = await res.json();
  renderGameLogs(data);
  if (gameLogStatus) {
    gameLogStatus.textContent = `총 ${data.length}건 / KST`;
  }
};

const startGameLogPolling = () => {
  if (gameLogTimer) {
    clearInterval(gameLogTimer);
  }
  fetchGameLogs().catch((e) => {
    if (gameLogStatus) gameLogStatus.textContent = `오류: ${e.message}`;
  });
  gameLogTimer = setInterval(() => {
    fetchGameLogs().catch((e) => {
      if (gameLogStatus) gameLogStatus.textContent = `오류: ${e.message}`;
    });
  }, 5000);
};

const bindAdjustButtons = () => {
  document.querySelectorAll(".adjust-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-user-id");
      const input = document.querySelector(
        `.adjust-input[data-user-id='${userId}']`
      );
      const delta = Number(input.value);
      if (!delta) {
        showAdminFeedback("금액을 입력하세요.", "danger");
        return;
      }
      try {
        const res = await fetch(`/api/admin/users/${userId}/adjust_balance`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAdminHeader() },
          body: JSON.stringify({ delta, reason: "manual" }),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "잔액 조정에 실패했습니다.");
        }
        await fetchUsers();
      } catch (error) {
        showAdminFeedback(error.message, "danger");
      }
    });
  });
};

const bindDeleteButtons = () => {
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-user-id");
      if (!window.confirm("이 계정을 삭제할까요? 모든 기록이 제거됩니다.")) return;
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: "DELETE",
          headers: getAdminHeader(),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "삭제 실패");
        }
        await fetchUsers();
      } catch (error) {
        showAdminFeedback(error.message, "danger");
      }
    });
  });
};

const bindDetailButtons = () => {
  document.querySelectorAll(".detail-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-user-id");
      const container = document.getElementById(`txn-${userId}`);
      const isOpen = container.style.display === "block";
      container.style.display = isOpen ? "none" : "block";
      if (isOpen) return;
      container.innerHTML = "<div class='text-muted small'>불러오는 중...</div>";
      try {
        const res = await fetch(`/api/admin/users/${userId}/transactions`, {
          headers: getAdminHeader(),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "로그를 불러오지 못했습니다.");
        }
        const data = await res.json();
        if (!data.length) {
          container.innerHTML = "<div class='text-muted small'>기록 없음</div>";
          return;
        }
        const rows = data
          .map(
            (t) => `
            <div class="border rounded p-2 mb-2">
              <div class="small text-muted">${t.created_at}</div>
              <div>유형: ${t.type} ${t.game_type ? `/ ${t.game_type}` : ""}</div>
              <div>금액: ${t.amount} (잔액 ${t.before_balance} → ${t.after_balance})</div>
              <div>${t.description || ""}</div>
            </div>
          `
          )
          .join("");
        container.innerHTML = rows;
      } catch (error) {
        container.innerHTML = `<div class='text-danger small'>오류: ${error.message}</div>`;
      }
    });
  });
};

if (userCreateForm) {
  userCreateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("userName").value.trim();
    const pin = document.getElementById("userPin").value.trim();
    const initial_balance = Number(
      document.getElementById("initialBalance").value || 0
    );
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminHeader() },
        body: JSON.stringify({ name, pin, initial_balance }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "생성 실패");
      }
      userCreateForm.reset();
      await fetchUsers();
    } catch (error) {
      showAdminFeedback(error.message, "danger");
    }
  });
}

if (refreshUsersBtn) {
  refreshUsersBtn.addEventListener("click", () =>
    fetchUsers().catch((e) => showAdminFeedback(e.message, "danger"))
  );
}

if (refreshLogsBtn) {
  refreshLogsBtn.addEventListener("click", () =>
    fetchGameLogs().catch((e) => showAdminFeedback(e.message, "danger"))
  );
}

// 로그 패널 자동 갱신도 관리자 인증 후 시작됨

const collectGameSettings = () => {
  const settings = [];
  const gameIds = new Set();
  document.querySelectorAll(".game-setting-toggle").forEach((el) => {
    gameIds.add(el.dataset.gameId);
  });
  gameIds.forEach((gameId) => {
    const riskEnabled = document.querySelector(
      `#risk_${gameId}`
    )?.checked;
    const riskThreshold = Number(
      document.querySelector(`#threshold_${gameId}`)?.value || 0
    );
    const casinoAdvantage = Number(
      document.querySelector(`#advantage_${gameId}`)?.value || 0
    );
    const assistEnabled = document.querySelector(
      `#assist_${gameId}`
    )?.checked;
    const assistThreshold = Number(
      document.querySelector(`#assist_threshold_${gameId}`)?.value || 0
    );
    const playerAdvantage = Number(
      document.querySelector(`#assist_advantage_${gameId}`)?.value || 0
    );
    settings.push({
      game_id: gameId,
      risk_enabled: !!riskEnabled,
      risk_threshold: riskThreshold,
      casino_advantage_percent: casinoAdvantage,
      assist_enabled: !!assistEnabled,
      assist_max_bet: assistThreshold,
      player_advantage_percent: playerAdvantage,
    });
  });
  return settings;
};

if (saveGameSettingsBtn) {
  saveGameSettingsBtn.addEventListener("click", async () => {
    try {
      const settings = collectGameSettings();
      const res = await fetch("/game_settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminHeader() },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "저장 실패");
      }
      showAdminFeedback("설정 저장 완료", "success");
    } catch (error) {
      showAdminFeedback(error.message, "danger");
    }
  });
}

if (adminAuthBtn) {
  adminAuthBtn.addEventListener("click", () => {
    const secret = adminSecretInput.value.trim();
    if (!secret) {
      showAdminFeedback("관리자 비밀번호를 입력하세요.", "danger");
      return;
    }
    Promise.all([fetchUsers(), fetchGameLogs()])
      .then(() => {
        startGameLogPolling();
        showAdminFeedback("인증 및 갱신 완료", "success");
      })
      .catch((e) => showAdminFeedback(e.message, "danger"));
  });
}

// 기본 자동 호출 제거 (비밀번호 입력 후 확인 버튼으로 갱신)
