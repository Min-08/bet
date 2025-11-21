const sessionForm = document.getElementById("sessionForm");
const sessionFeedback = document.getElementById("sessionFeedback");
const sessionTableBody = document.getElementById("sessionTableBody");
const resultTableBody = document.getElementById("resultTableBody");
const refreshSessionsBtn = document.getElementById("refreshSessions");
const refreshResultsBtn = document.getElementById("refreshResults");

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
  sessionFeedback.classList.remove("d-none", "alert-success", "alert-danger");
  sessionFeedback.classList.add(`alert-${variant}`);
  sessionFeedback.textContent = message;
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
        <td>${formatDate(row.timestamp)}</td>
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

refreshSessionsBtn.addEventListener("click", () =>
  fetchSessions().catch((error) => console.error(error))
);
refreshResultsBtn.addEventListener("click", () =>
  fetchResults().catch((error) => console.error(error))
);

fetchSessions().catch((error) => console.error(error));
fetchResults().catch((error) => console.error(error));
