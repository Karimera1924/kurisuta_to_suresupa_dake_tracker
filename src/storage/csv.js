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

// CSV のセルを壊す文字（区切り・改行）を取り除く。プロセス名には普通含まれない。
function cell(text) {
  return String(text).replace(/[,\r\n]/g, "_");
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

// 今日の合計を書き直す。totals は { [key]: { label, seconds } }。秒の多い順に 1 行ずつ。
function writeSummary({ dir, date, totals, now }) {
  fs.mkdirSync(dir, { recursive: true });
  const updatedAt = localTime(now);
  const lines = [SUMMARY_HEADER];
  const rows = Object.values(totals).sort((a, b) => b.seconds - a.seconds);
  for (const { label, seconds } of rows) {
    lines.push(
      `${date},${cell(label)},${seconds},${roundHalfEvenToTenth(seconds / 60)},${updatedAt}`,
    );
  }
  writeFileBom(summaryPath(dir, date), lines.join("\r\n") + "\r\n");
}

// 区間を 1 行追記する。ファイルが無ければヘッダを書く。
function appendSession({ dir, date, event }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = sessionsPath(dir, date);
  if (!fs.existsSync(file)) writeFileBom(file, SESSIONS_HEADER + "\r\n");
  const row = `${date},${cell(event.label)},${localTime(event.start)},${localTime(event.end)},${event.seconds}`;
  fs.appendFileSync(file, row + "\r\n", "utf8");
}

// 指定日の summary を読む。無ければ空。形式は { [key]: { label, seconds } }。
// 再起動の引き継ぎと、履歴表示の両方で使う。
function loadTotals({ dir, date }) {
  const totals = {};
  const file = summaryPath(dir, date);
  if (!fs.existsSync(file)) return totals;
  const text = fs.readFileSync(file, "utf8").replace(new RegExp("^" + BOM), "");
  const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
  for (const row of rows) {
    const cols = row.split(",");
    const label = cols[1];
    totals[label.toLowerCase()] = { label, seconds: Number(cols[2]) || 0 };
  }
  return totals;
}

// 指定日の区間（sessions）を読む。無ければ空。形式は [{ label, start, end, seconds }]。
function loadSessions({ dir, date }) {
  const file = sessionsPath(dir, date);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").replace(new RegExp("^" + BOM), "");
  const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
  return rows.map((row) => {
    const cols = row.split(",");
    return {
      label: cols[1],
      start: cols[2],
      end: cols[3],
      seconds: Number(cols[4]) || 0,
    };
  });
}

module.exports = {
  writeSummary,
  appendSession,
  loadTotals,
  loadSessions,
  localDate,
  localTime,
  summaryPath,
  sessionsPath,
};
