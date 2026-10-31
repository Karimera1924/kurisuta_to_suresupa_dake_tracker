// 計測の集計ステート。時刻は epoch ミリ秒で受け取る。副作用は持たない。
const { matchTarget, isCounting } = require("./rules");

function createAccumulator({
  targets,
  pollSeconds,
  idleSeconds,
  initialTotals = {},
}) {
  const totals = {};
  for (const t of targets) totals[t.key] = initialTotals[t.key] ?? 0;

  // 開いている区間: { target, start, end }。対象が変わる、または待機になると閉じる。
  let open = null;

  function closeSegment(events) {
    if (!open) return;
    events.push({
      key: open.target.key,
      label: open.target.label,
      start: open.start,
      end: open.end,
      seconds: Math.round((open.end - open.start) / 1000) + pollSeconds,
    });
    open = null;
  }

  // observation: { foreground: {processName, title} | null, idleMs }
  // 戻り値: { counting, target, events }（events は今回閉じた区間）
  function tick(now, observation) {
    const target = matchTarget(observation.foreground, targets);
    const counting = isCounting(target, observation.idleMs, idleSeconds);
    const events = [];

    if (counting) {
      if (!open || open.target.key !== target.key) {
        closeSegment(events);
        open = { target, start: now, end: now };
      }
      open.end = now;
      totals[target.key] += pollSeconds;
    } else {
      closeSegment(events);
    }

    return { counting, target: counting ? target.key : null, events };
  }

  // 終了時に開いている区間を閉じる。
  function flush() {
    const events = [];
    closeSegment(events);
    return events;
  }

  return {
    tick,
    flush,
    totals: () => ({ ...totals }),
  };
}

module.exports = { createAccumulator };
