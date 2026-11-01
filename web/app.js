// /api/status を 5 秒おき、/api/history を 30 秒おき、/api/sessions を 5 秒おきに取得して画面に出す。
// 取得に失敗したら「未接続」や「取得できませんでした」と出して、次の周期で再試行する。
// DOM は textContent と createElement だけで組み立てる（データを innerHTML に入れない）。
const POLL_MS = 5000;
const HISTORY_POLL_MS = 30000;
const MAX_PINNED = 2;
const MAX_ALIAS_CHARS = 8; // タスクバーの表示欄が狭いので短く保つ（サーバ側の上限と同じ）
// 履歴の積み上げ色。期間内の稼働時間の上位 5 件に順位順で割り当てる（色盲でも区別できるよう選定、validate_palette で検証済み）。
const PALETTE = ["#0072B2", "#C27C00", "#00806A", "#D55E00", "#B94E8A"];
// 6 位以下の「その他」は全部この灰色。
const OTHER_COLOR = "#B4BAC4";

const $ = (id) => document.getElementById(id);
const el = {
  date: $("date"),
  connection: $("connection"),
  updated: $("updated"),
  pinnedCards: $("pinned-cards"),
  todayBody: $("today-body"),
  pinForm: $("pin-form"),
  pinList: $("pin-list"),
  pinNew: $("pin-new"),
  pinAdd: $("pin-add"),
  pinSave: $("pin-save"),
  pinMsg: $("pin-msg"),
  aliasForm: $("alias-form"),
  aliasList: $("alias-list"),
  aliasSave: $("alias-save"),
  aliasMsg: $("alias-msg"),
  bars: $("bars"),
  legend: $("legend"),
  rangeBody: $("range-body"),
  rangeNote: $("range-note"),
  sessionsDate: $("sessions-date"),
  sessionsToday: $("sessions-today"),
  sessionsNote: $("sessions-note"),
  hourly: $("hourly"),
  sessionsBody: $("sessions-body"),
};

const state = {
  status: null,
  draft: [], // 編集中のピン留め（プロセス名）。編集していない間はサーバの値に追従する
  editing: false,
  extra: [], // 手入力で追加した候補名
  pinSig: null, // チェックボックスを作り直すかの判定に使う候補一覧
  aliasSig: null, // 別名の入力欄を作り直すかの判定に使う候補一覧
  history: null, // 最後に受けた履歴（別名を保存した時に描き直す）
  days: 7,
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

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// プロセス名に付いた別名（無ければプロセス名）。現在のステータスの aliases から引く。
function aliasLabelFor(name) {
  const aliases = (state.status && state.status.aliases) || {};
  return aliases[name.toLowerCase()] || name;
}

function renderPinnedCards(status) {
  const cards = status.pinned.map((p) => {
    const card = h("section", p.counting ? "card counting" : "card");
    card.append(h("div", "name", p.label));
    // 別名を付けている時は、元のプロセス名も小さく出す
    if (p.label !== p.name) card.append(h("div", "muted", p.name));
    card.append(
      h("div", "time", formatSeconds(p.seconds)),
      h("div", "state", p.counting ? "計測中" : "待機中"),
    );
    return card;
  });
  if (cards.length === 0) {
    cards.push(
      h("p", "muted", "ピン留めはありません。下のリストから選んでください。"),
    );
  }
  el.pinnedCards.replaceChildren(...cards);
}

function renderToday(status) {
  const rows = Object.entries(status.totals)
    .sort(([, a], [, b]) => b.seconds - a.seconds)
    .map(([key, info]) => {
      const tr = h(
        "tr",
        status.counting && status.target === key ? "counting" : "",
      );
      tr.append(
        h("td", null, info.label),
        h("td", "num", formatSeconds(info.seconds)),
      );
      return tr;
    });
  el.todayBody.replaceChildren(...rows);
}

// 候補 = 今日計測されたアプリ + 現在のピン留め + 手入力の名前（大文字小文字は同一扱い）
function candidateNames(status) {
  const seen = new Map();
  const add = (name) => {
    const k = name.toLowerCase();
    if (!seen.has(k)) seen.set(k, name);
  };
  Object.values(status.totals).forEach((info) => add(info.label));
  status.pinned.forEach((p) => add(p.name));
  state.extra.forEach(add);
  return [...seen.values()];
}

function toggle(name, on) {
  state.draft = on
    ? [...state.draft.filter((n) => n !== name), name]
    : state.draft.filter((n) => n !== name);
  state.editing = true;
  el.pinMsg.textContent = "";
  renderPinForm(state.status);
}

function renderPinForm(status) {
  const names = candidateNames(status);
  const sig = names.join("\n");
  if (sig !== state.pinSig) {
    // 候補が変わった時だけ作り直す（毎回作り直すとクリックを取りこぼすため）
    state.pinSig = sig;
    el.pinList.replaceChildren(
      ...names.map((name) => {
        const box = h("input");
        box.type = "checkbox";
        box.value = name;
        box.addEventListener("change", () => toggle(name, box.checked));
        const label = h("label", "pin-item");
        label.append(box, document.createTextNode(` ${name}`));
        return label;
      }),
    );
  }
  const full = state.draft.length >= MAX_PINNED;
  for (const box of el.pinList.querySelectorAll("input")) {
    box.checked = state.draft.includes(box.value);
    box.disabled = !box.checked && full;
  }
  el.pinSave.disabled = !state.editing;
}

function addExtra() {
  const name = el.pinNew.value.trim();
  if (!name || !state.status) return;
  if (!state.extra.some((n) => n.toLowerCase() === name.toLowerCase())) {
    state.extra.push(name);
  }
  el.pinNew.value = "";
  renderPinForm(state.status);
}

async function savePinned(event) {
  event.preventDefault();
  el.pinSave.disabled = true;
  el.pinMsg.textContent = "保存中…";
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: state.draft }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
    state.draft = body.pinned;
    state.editing = false;
    el.pinMsg.textContent = "保存しました（タスクバーへは次の更新で反映）";
  } catch (err) {
    el.pinMsg.textContent = `保存に失敗: ${err.message}`;
  }
  renderPinForm(state.status);
}

// 別名の入力欄。編集中（dirty）の欄は、サーバの値で上書きしない。
function renderAliasForm(status) {
  const names = candidateNames(status);
  const sig = names.join("\n");
  if (sig !== state.aliasSig) {
    // 作り直す前に、編集中の入力を覚えておく
    const typed = new Map();
    for (const input of el.aliasList.querySelectorAll("input")) {
      if (input.dataset.dirty) typed.set(input.dataset.key, input.value);
    }
    state.aliasSig = sig;
    el.aliasList.replaceChildren(
      ...names.map((name) => {
        const key = name.toLowerCase();
        const input = h("input", "alias-input");
        input.type = "text";
        input.maxLength = MAX_ALIAS_CHARS;
        input.placeholder = name;
        input.dataset.key = key;
        if (typed.has(key)) {
          input.value = typed.get(key);
          input.dataset.dirty = "1";
        }
        input.addEventListener("input", () => {
          input.dataset.dirty = "1";
          el.aliasSave.disabled = false;
        });
        const row = h("div", "alias-row");
        row.append(h("span", "alias-name", name), input);
        return row;
      }),
    );
  }
  const aliases = status.aliases || {};
  for (const input of el.aliasList.querySelectorAll("input")) {
    if (input.dataset.dirty) continue;
    input.value = aliases[input.dataset.key] || "";
  }
  // 編集中の欄が残っていれば保存できるようにする
  el.aliasSave.disabled = !el.aliasList.querySelector("[data-dirty]");
}

async function saveAliases(event) {
  event.preventDefault();
  if (!state.status) return;
  // 画面に出ていない既存の別名は残す。空欄の項目は別名を消す
  const aliases = { ...(state.status.aliases || {}) };
  for (const input of el.aliasList.querySelectorAll("input")) {
    const alias = input.value.trim();
    if (alias) aliases[input.dataset.key] = alias;
    else delete aliases[input.dataset.key];
  }
  el.aliasSave.disabled = true;
  el.aliasMsg.textContent = "保存中…";
  try {
    const res = await fetch("/api/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aliases }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
    state.status.aliases = body.aliases;
    for (const input of el.aliasList.querySelectorAll("input")) {
      delete input.dataset.dirty;
    }
    el.aliasMsg.textContent = "保存しました（タスクバーへは次の更新で反映）";
  } catch (err) {
    el.aliasSave.disabled = false;
    el.aliasMsg.textContent = `保存に失敗: ${err.message}`;
    return;
  }
  renderAliasForm(state.status);
  // 凡例と棒と表の別名を新しい値で描き直す
  if (state.history) renderHistory(state.history);
}

function render(status) {
  state.status = status;
  if (!state.editing) {
    state.draft = status.pinned.map((p) => p.name);
  }
  el.date.textContent = `対象日: ${status.date}`;
  el.updated.textContent = `最終更新: ${status.updatedAt}`;
  el.connection.textContent = "接続中";
  el.connection.className = "muted";
  renderPinnedCards(status);
  renderToday(status);
  renderPinForm(status);
  renderAliasForm(status);
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

function legendItem(color, text) {
  const item = h("span", "legend-item");
  const swatch = h("span", "swatch");
  swatch.style.background = color;
  item.append(swatch, document.createTextNode(text));
  return item;
}

// 履歴の凡例。top の label にはプロセス名が入っている（別名は aliasLabelFor で引く）。
function renderLegend(top) {
  const items = top.map((t, i) =>
    legendItem(PALETTE[i % PALETTE.length], aliasLabelFor(t.label)),
  );
  items.push(legendItem(OTHER_COLOR, "その他"));
  el.legend.replaceChildren(...items);
}

// 1 日分の積み上げ棒。上から「その他」、その下に上位アプリを順に積む。高さは期間内の最大値に対する割合。
function barColumn(day, max) {
  const stack = h("div", "stack");
  stack.style.height = `${(day.total_seconds / max) * 100}%`;
  const parts = [
    { label: "その他", seconds: day.other_seconds, color: OTHER_COLOR },
    ...day.top.map((t, i) => ({
      label: aliasLabelFor(t.label),
      seconds: t.seconds,
      color: PALETTE[i % PALETTE.length],
    })),
  ];
  for (const part of parts) {
    if (part.seconds <= 0) continue;
    const seg = h("div", "seg");
    // flex-grow を秒数にして、積み上げの比率を出す
    seg.style.flex = `${part.seconds} 1 0px`;
    seg.style.background = part.color;
    seg.title = `${day.date}  ${part.label}  ${formatSeconds(part.seconds)}`;
    stack.append(seg);
  }
  const col = h("div", "bar-col");
  col.title = `${day.date}  合計 ${formatSeconds(day.total_seconds)}`;
  col.append(h("div", "bar-track"), h("div", "bar-label", day.date.slice(5)));
  col.querySelector(".bar-track").append(stack);
  return col;
}

function renderHistory(data) {
  const days = data.days;
  const max = Math.max(1, ...days.map((d) => d.total_seconds));
  el.bars.replaceChildren(...days.map((d) => barColumn(d, max)));
  renderLegend(data.top);

  // 期間合計の表（サーバ側で小文字キー合算・秒数順済み）
  const total = days.reduce((sum, d) => sum + d.total_seconds, 0);
  const rows = data.apps.map((r) => {
    const share =
      total > 0 ? `${Math.round((r.seconds / total) * 1000) / 10}%` : "-";
    const tr = h("tr");
    tr.append(
      h("td", null, aliasLabelFor(r.label)),
      h("td", "num", formatSeconds(r.seconds)),
      h("td", "num", share),
    );
    return tr;
  });
  el.rangeBody.replaceChildren(...rows);
  el.rangeNote.textContent = `${days[0].date} 〜 ${days[days.length - 1].date}（合計 ${formatSeconds(total)}）`;
}

async function loadHistory() {
  try {
    // 別名は状態（status）から引くので、先に状態を取っておく（起動直後の競合対策）
    if (!state.status) await refresh();
    const res = await fetch(`/api/history?days=${state.days}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.history = await res.json();
    renderHistory(state.history);
  } catch {
    el.rangeNote.textContent = "履歴を取得できませんでした";
  }
}

// 時間帯別の秒数（0〜23 時）。3 時間ごとに時刻を出す。
function renderHourly(hourly) {
  const max = Math.max(1, ...hourly);
  el.hourly.replaceChildren(
    ...hourly.map((sec, hour) => {
      const track = h("div", "bar-track");
      if (sec > 0) {
        const fill = h("div", "bar-fill");
        fill.style.height = `${(sec / max) * 100}%`;
        fill.title = `${String(hour).padStart(2, "0")}時台  ${formatSeconds(sec)}`;
        track.append(fill);
      }
      const col = h("div", "bar-col");
      col.append(
        track,
        h("div", "bar-label", hour % 3 === 0 ? String(hour) : ""),
      );
      return col;
    }),
  );
}

function renderSessions(data) {
  const total = data.sessions.reduce((sum, s) => sum + s.seconds, 0);
  el.sessionsNote.textContent = `対象日: ${data.date}（区間 ${data.sessions.length} 件・合計 ${formatSeconds(total)}）`;
  renderHourly(data.hourly);
  // 新しい順に並べる
  const rows = data.sessions
    .slice()
    .reverse()
    .map((s) => {
      const tr = h("tr");
      tr.append(
        h("td", null, s.start),
        h("td", null, s.end),
        h("td", null, s.label),
        h("td", "num", formatSeconds(s.seconds)),
      );
      return tr;
    });
  el.sessionsBody.replaceChildren(...rows);
}

// 日付欄が空なら今日（サーバ側で決める）
async function loadSessions() {
  const date = el.sessionsDate.value;
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  try {
    const res = await fetch(`/api/sessions${query}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderSessions(await res.json());
  } catch {
    el.sessionsNote.textContent = "区間を取得できませんでした";
  }
}

el.pinForm.addEventListener("submit", savePinned);
el.pinAdd.addEventListener("click", addExtra);
el.pinNew.addEventListener("keydown", (e) => {
  // Enter で保存ではなく候補追加にする
  if (e.key === "Enter") {
    e.preventDefault();
    addExtra();
  }
});
el.aliasForm.addEventListener("submit", saveAliases);
for (const radio of document.querySelectorAll('input[name="range"]')) {
  radio.addEventListener("change", () => {
    state.days = Number(radio.value);
    loadHistory();
  });
}
el.sessionsDate.addEventListener("change", loadSessions);
el.sessionsToday.addEventListener("click", () => {
  el.sessionsDate.value = "";
  loadSessions();
});

refresh();
setInterval(refresh, POLL_MS);
loadHistory();
setInterval(loadHistory, HISTORY_POLL_MS);
loadSessions();
// 日付を指定して見ている時は、今日の区間を追いかけ続けない
setInterval(() => {
  if (!el.sessionsDate.value) loadSessions();
}, POLL_MS);
