// CSV の読み書き。形式は旧 AppTimeTracker.ps1 と同じにする（既存データを引き継ぐため）。
// Excel で日本語が文字化けしないよう、書き込みは UTF-8 BOM 付き。読み込みでは BOM を外す。
const fs = require("node:fs");
const path = require("node:path");

const BOM = String.fromCharCode(0xfeff);
const SUMMARY_HEADER = "date,app,total_seconds,total_minutes,updated_at";
const SESSIONS_HEADER = "date,app,start,end,seconds";

function pad2(n) {
  return String(n).padStart(2, "0");
}

// ローカル時刻の日付 (YYYY-MM-DD) と時刻 (HH:mm:ss)
function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTime(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function summaryPath(dir, date) {
  return path.join(dir, `${date}-summary.csv`);
}

function sessionsPath(dir, date) {
  return path.join(dir, `${date}-sessions.csv`);
}

function writeFileBom(file, text) {
  fs.writeFileSync(file, BOM + text, "utf8");
}

// PowerShell の [math]::Round(x, 1) と同じ偶数丸め（0.25 → 0.2、0.75 → 0.8）
function roundHalfEvenToTenth(x) {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let n;
  if (diff === 0.5) n = floor % 2 === 0 ? floor : floor + 1;
  else n = Math.round(scaled);
  return n / 10;
}

// 今日の合計を書き直す。targets の順に 1 行ずつ。
function writeSummary({ dir, date, targets, totals, now }) {
  fs.mkdirSync(dir, { recursive: true });
  const updatedAt = localTime(now);
  const lines = [SUMMARY_HEADER];
  for (const t of targets) {
    const sec = totals[t.key] ?? 0;
    lines.push(
      `${date},${t.label},${sec},${roundHalfEvenToTenth(sec / 60)},${updatedAt}`,
    );
  }
  writeFileBom(summaryPath(dir, date), lines.join("\r\n") + "\r\n");
}

// 区間を 1 行追記する。ファイルが無ければヘッダを書く。
function appendSession({ dir, date, event }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = sessionsPath(dir, date);
  if (!fs.existsSync(file)) writeFileBom(file, SESSIONS_HEADER + "\r\n");
  const row = `${date},${event.label},${localTime(event.start)},${localTime(event.end)},${event.seconds}`;
  fs.appendFileSync(file, row + "\r\n", "utf8");
}

// 同じ日の summary があれば合計を読み戻す（再起動の引き継ぎ）。無ければ空。
function loadTotals({ dir, date, targets }) {
  const totals = {};
  const file = summaryPath(dir, date);
  if (!fs.existsSync(file)) return totals;
  const text = fs.readFileSync(file, "utf8").replace(new RegExp("^" + BOM), "");
  const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
  for (const row of rows) {
    const cols = row.split(",");
    const target = targets.find((t) => t.label === cols[1]);
    if (target) totals[target.key] = Number(cols[2]) || 0;
  }
  return totals;
}

module.exports = {
  writeSummary,
  appendSession,
  loadTotals,
  localDate,
  localTime,
  summaryPath,
  sessionsPath,
};
