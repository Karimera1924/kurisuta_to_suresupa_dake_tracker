// /api/status を 5 秒おきに取得して画面に出す。
// 取得に失敗したら「未接続」と出して、次の周期で再試行する。
const POLL_MS = 5000;

const el = {
  date: document.getElementById("date"),
  connection: document.getElementById("connection"),
  cards: document.getElementById("cards"),
  updated: document.getElementById("updated"),
};

// 秒を「h時間mm分ss秒」形式にする（1 時間未満は「mm分ss秒」）
function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}時間${mm}分${ss}秒` : `${mm}分${ss}秒`;
}

function renderCard(key, info, counting, target) {
  const isCounting = counting && target === key;
  const card = document.createElement("section");
  card.className = isCounting ? "card counting" : "card";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = info.label;

  const time = document.createElement("div");
  time.className = "time";
  time.textContent = formatSeconds(info.seconds);

  const state = document.createElement("div");
  state.className = "state";
  state.textContent = isCounting ? "計測中" : "待機中";

  card.append(name, time, state);
  return card;
}

function render(status) {
  el.date.textContent = `対象日: ${status.date}`;
  el.updated.textContent = `最終更新: ${status.updatedAt}`;
  el.connection.textContent = "接続中";
  el.connection.className = "muted";

  el.cards.replaceChildren(
    ...Object.entries(status.totals).map(([key, info]) =>
      renderCard(key, info, status.counting, status.target),
    ),
  );
}

function showError() {
  el.connection.textContent =
    "未接続（トラッカーが動いているか確認してください）";
  el.connection.className = "error";
}

async function refresh() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch {
    showError();
  }
}

refresh();
setInterval(refresh, POLL_MS);
