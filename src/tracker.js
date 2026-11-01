// エントリポイント: 計測ループと HTTP サーバを起動する。
// 起動: node src/tracker.js（Task Scheduler からの常駐登録は後半フェーズ）
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAccumulator } = require("./core/accumulator");
const {
  writeSummary,
  appendSession,
  loadTotals,
  loadSessions,
  localDate,
  localTime,
} = require("./storage/csv");
const {
  loadPinned,
  savePinned,
  loadAliases,
  saveAliases,
} = require("./storage/settings");
const { hourlyBuckets, splitByTop, topApps } = require("./core/report");
const { observe } = require("./platform/win32");
const { createServer, HOST, DEFAULT_PORT } = require("./server");

const ROOT = path.resolve(__dirname, "..");
const LOG_FILE = path.join(ROOT, "data", "tracker.log");
const SETTINGS_FILE = path.join(ROOT, "data", "settings.json");
const HISTORY_DAY_MS = 24 * 60 * 60 * 1000;
// 履歴グラフで色を割り当てるアプリ数（期間内の稼働時間の上位から）。残りは「その他」。
const TOP_APP_COUNT = 5;

function numberFromEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function loadConfig() {
  return {
    idleSeconds: numberFromEnv("APPTIME_IDLE_SECONDS", 30),
    pollSeconds: numberFromEnv("APPTIME_POLL_SECONDS", 5),
    port: numberFromEnv("APPTIME_PORT", DEFAULT_PORT),
    outDir:
      process.env.APPTIME_OUT_DIR ||
      path.join(os.homedir(), "Documents", "AppTime"),
    webDir: process.env.APPTIME_WEB_DIR || path.join(ROOT, "web"),
  };
}

// 例外はログに残す（標準エラーと data/tracker.log の両方）。ログ書き込み自体の失敗は無視する。
function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stderr.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {
    // ログが書けなくても計測は続ける
  }
}

// 過去 days 日分（古い順）の、アプリ別の合計。今日を含む。
// top: 期間内の上位 TOP_APP_COUNT 件（色の割り当て対象）。apps: 期間内の全アプリの合計（期間合計の表用）。
// 各日は top のアプリごとの秒数（top）と、それ以外の合計（other_seconds）に分ける。
function readHistory(outDir, now, days) {
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = localDate(now - i * HISTORY_DAY_MS);
    const totals = loadTotals({ dir: outDir, date });
    const apps = Object.values(totals);
    perDay.push({
      date,
      apps,
      total: apps.reduce((sum, a) => sum + a.seconds, 0),
    });
  }
  const allApps = perDay.flatMap((d) => d.apps);
  const top = topApps(allApps, TOP_APP_COUNT);
  const topNames = top.map((t) => t.label);
  return {
    top,
    apps: topApps(allApps, Infinity),
    days: perDay.map((d) => ({
      date: d.date,
      total_seconds: d.total,
      ...splitByTop(d.apps, d.total, topNames),
    })),
  };
}

// 指定日（省略時は今日）の区間一覧と、時間帯別の秒数。
function readSessions(outDir, now, date) {
  const day = date || localDate(now);
  const sessions = loadSessions({ dir: outDir, date: day });
  return { date: day, sessions, hourly: hourlyBuckets(sessions) };
}

function main() {
  const cfg = loadConfig();
  let day = null;
  let last = { counting: false, target: null, now: Date.now() };
  let pinned = loadPinned(SETTINGS_FILE);
  let aliases = loadAliases(SETTINGS_FILE);

  function openDay(now) {
    const date = localDate(now);
    const initialTotals = loadTotals({ dir: cfg.outDir, date });
    const acc = createAccumulator({
      pollSeconds: cfg.pollSeconds,
      idleSeconds: cfg.idleSeconds,
      initialTotals,
    });
    return { date, acc };
  }

  // 書けなかった区間はキューに残し、書けた分だけ取り除く（Excel で開かれていて一時的に書けない場合など）
  const pending = [];

  // 開いている区間を閉じて、その日の CSV を書く
  function saveDay(now, events) {
    for (const e of events) pending.push({ date: day.date, event: e });
    while (pending.length > 0) {
      const { date, event } = pending[0];
      appendSession({ dir: cfg.outDir, date, event });
      pending.shift();
    }
    writeSummary({
      dir: cfg.outDir,
      date: day.date,
      totals: day.acc.totals(),
      now,
    });
  }

  function step() {
    const now = Date.now();
    try {
      if (!day || localDate(now) !== day.date) {
        if (day) saveDay(now, day.acc.flush());
        day = openDay(now);
      }
      const r = day.acc.tick(now, observe());
      saveDay(now, r.events);
      last = { counting: r.counting, target: r.target, now };
    } catch (err) {
      log(`計測エラー: ${err.stack || err}`);
    }
  }

  // タスクバーに出すアプリ。秒数と計測中かどうかは、今日の合計から引く。
  // label はタスクバーに出す文字（別名があれば別名、無ければプロセス名）。
  function pinnedStatus(totals) {
    return pinned.map((name) => {
      const key = name.toLowerCase();
      const seconds = totals[key] ? totals[key].seconds : 0;
      return {
        key,
        name,
        label: aliases[key] || name,
        seconds,
        counting: last.counting && last.target === key,
      };
    });
  }

  function status() {
    const totals = day ? day.acc.totals() : {};
    return {
      date: day ? day.date : localDate(last.now),
      counting: last.counting,
      target: last.target,
      idleSeconds: cfg.idleSeconds,
      pinned: pinnedStatus(totals),
      aliases,
      totals,
      updatedAt: localTime(last.now),
    };
  }

  function setPinned(names) {
    pinned = savePinned(SETTINGS_FILE, names);
    return pinned;
  }

  function setAliases(map) {
    aliases = saveAliases(SETTINGS_FILE, map);
    return aliases;
  }

  const server = createServer({
    getStatus: status,
    getHistory: (days) => readHistory(cfg.outDir, Date.now(), days),
    getSessions: (date) => readSessions(cfg.outDir, Date.now(), date),
    setPinned,
    setAliases,
    webDir: cfg.webDir,
  });
  server.listen(cfg.port, HOST, () => {
    log(`起動: http://${HOST}:${cfg.port}  出力先: ${cfg.outDir}`);
  });

  step();
  const timer = setInterval(step, cfg.pollSeconds * 1000);

  // 終了時: 開いている区間を閉じて保存してから止める
  function shutdown(signal) {
    clearInterval(timer);
    log(`終了 (${signal})`);
    if (day) {
      try {
        saveDay(Date.now(), day.acc.flush());
      } catch (err) {
        log(`終了時の保存に失敗: ${err.stack || err}`);
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log(`予期しない例外: ${err.stack || err}`);
    try {
      if (day) saveDay(Date.now(), day.acc.flush());
    } catch (saveErr) {
      log(`例外後の保存に失敗: ${saveErr.stack || saveErr}`);
    }
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { loadConfig, readHistory, readSessions };
