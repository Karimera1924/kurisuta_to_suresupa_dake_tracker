// 計測ルールの純粋関数。Windows API には依存しない。

// 集計に入れない前面プロセス（デスクトップ・ロック画面・検索など、作業時間ではないもの）
const IGNORED_PROCESSES = new Set([
  "explorer",
  "shellexperiencehost",
  "startmenuexperiencehost",
  "searchhost",
  "lockapp",
]);

// 前面ウィンドウのプロセス名から、集計のキーと表示名を決める。
// プロセス名が取れない（権限不足など）・除外対象・前面なしは null。
// キーは小文字化したプロセス名（同じ exe を大文字小文字違いで二重に数えないため）。
function appOf(foreground) {
  if (!foreground || !foreground.processName) return null;
  const name = foreground.processName;
  if (IGNORED_PROCESSES.has(name.toLowerCase())) return null;
  return { key: name.toLowerCase(), label: name };
}

// 前面のアプリが決まっていて、最後の入力が idleSeconds 以内なら計測する。
function isCounting(app, idleMs, idleSeconds) {
  return app !== null && idleMs <= idleSeconds * 1000;
}

// 秒を読みやすい表記にする（例: 45秒 / 3分25秒 / 1時間15分30秒）。
function formatDuration(sec) {
  if (sec < 60) return `${sec}秒`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}時間${m}分${s}秒`;
  return `${m}分${s}秒`;
}

module.exports = { appOf, isCounting, formatDuration };
