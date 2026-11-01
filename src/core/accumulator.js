// 計測の集計ステート。時刻は epoch ミリ秒で受け取る。副作用は持たない。
// totals の形: { [key]: { label, seconds } }（/api/status の totals と同じ形）
const { appOf, isCounting } = require("./rules");

function createAccumulator({ pollSeconds, idleSeconds, initialTotals = {} }) {
  const totals = {};
  for (const [key, info] of Object.entries(initialTotals)) {
    totals[key] = { label: info.label, seconds: info.seconds };
  }

  // 開いている区間: { key, label, start, end }。アプリが変わる、または待機になると閉じる。
  let open = null;

  function closeSegment(events) {
    if (!open) return;
    events.push({
      key: open.key,
      label: open.label,
      start: open.start,
      end: open.end,
      seconds: Math.round((open.end - open.start) / 1000) + pollSeconds,
    });
    open = null;
  }

  // observation: { foreground: {processName, title} | null, idleMs }
  // 戻り値: { counting, target, events }（events は今回閉じた区間）
  function tick(now, observation) {
    const app = appOf(observation.foreground);
    const counting = isCounting(app, observation.idleMs, idleSeconds);
    const events = [];

    if (counting) {
      if (!open || open.key !== app.key) {
        closeSegment(events);
        open = { key: app.key, label: app.label, start: now, end: now };
      }
      open.end = now;
      if (!totals[app.key]) totals[app.key] = { label: app.label, seconds: 0 };
      totals[app.key].seconds += pollSeconds;
    } else {
      closeSegment(events);
    }

    return { counting, target: counting ? app.key : null, events };
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
    totals: () => structuredClone(totals),
  };
}

module.exports = { createAccumulator };
