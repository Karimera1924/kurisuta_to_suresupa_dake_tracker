// 計測ルールの純粋関数。Windows API には依存しない。

function includesIgnoreCase(text, pattern) {
  if (!text || !pattern) return false;
  return text.toLowerCase().includes(pattern.toLowerCase());
}

// 前面ウィンドウから対象を決める。プロセス名を先に見て、次にタイトルを見る。
// 一致しなければ null。
function matchTarget(foreground, targets) {
  if (!foreground) return null;
  for (const t of targets) {
    if (includesIgnoreCase(foreground.processName, t.processPattern)) return t;
    if (includesIgnoreCase(foreground.title, t.titlePattern)) return t;
  }
  return null;
}

// 対象が前面で、最後の入力が idleSeconds 以内なら計測する。
function isCounting(target, idleMs, idleSeconds) {
  return target !== null && idleMs <= idleSeconds * 1000;
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

module.exports = { matchTarget, isCounting, formatDuration };
