// エントリポイント: 計測ループと HTTP サーバを起動する。
// 起動: node src/tracker.js（Task Scheduler からの常駐登録は後半フェーズ）
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TARGETS } = require("./core/targets");
const { createAccumulator } = require("./core/accumulator");
const {
  writeSummary,
  appendSession,
  loadTotals,
  localDate,
  localTime,
} = require("./storage/csv");
const { observe } = require("./platform/win32");
const { createServer, HOST, DEFAULT_PORT } = require("./server");

const ROOT = path.resolve(__dirname, "..");
const LOG_FILE = path.join(ROOT, "data", "tracker.log");

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

function main() {
  const cfg = loadConfig();
  let day = null;
  let last = { counting: false, target: null, now: Date.now() };

  function openDay(now) {
    const date = localDate(now);
    const initialTotals = loadTotals({
      dir: cfg.outDir,
      date,
      targets: TARGETS,
    });
    const acc = createAccumulator({
      targets: TARGETS,
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
      targets: TARGETS,
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

  function status() {
    const totals = day ? day.acc.totals() : {};
    return {
      date: day ? day.date : localDate(last.now),
      counting: last.counting,
      target: last.target,
      idleSeconds: cfg.idleSeconds,
      totals: Object.fromEntries(
        TARGETS.map((t) => [
          t.key,
          { label: t.label, seconds: totals[t.key] ?? 0 },
        ]),
      ),
      updatedAt: localTime(last.now),
    };
  }

  const server = createServer({ getStatus: status, webDir: cfg.webDir });
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

module.exports = { loadConfig };
