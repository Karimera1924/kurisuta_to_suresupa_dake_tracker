const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TARGETS } = require("../src/core/targets");
const {
  writeSummary,
  appendSession,
  loadTotals,
  localDate,
  summaryPath,
  sessionsPath,
} = require("../src/storage/csv");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apptime-"));
}

test("summary を書いて、同じ合計を読み戻せる（再起動の引き継ぎ）", () => {
  const dir = tmpDir();
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const date = localDate(now);
  writeSummary({
    dir,
    date,
    targets: TARGETS,
    totals: { clipstudio: 600, slaythespire: 90 },
    now,
  });

  const text = fs.readFileSync(summaryPath(dir, date), "utf8");
  assert.ok(
    text.startsWith(
      String.fromCharCode(0xfeff) +
        "date,app,total_seconds,total_minutes,updated_at",
    ),
  );
  assert.ok(text.includes("2026-10-31,クリスタ,600,10,12:00:00"));

  assert.deepEqual(loadTotals({ dir, date, targets: TARGETS }), {
    clipstudio: 600,
    slaythespire: 90,
  });
});

test("summary が無い日は空の合計を返す", () => {
  assert.deepEqual(
    loadTotals({ dir: tmpDir(), date: "2000-01-01", targets: TARGETS }),
    {},
  );
});

test("sessions はヘッダを 1 回だけ書き、以後は追記する", () => {
  const dir = tmpDir();
  const start = new Date(2026, 9, 31, 9, 0, 0).getTime();
  const end = new Date(2026, 9, 31, 9, 1, 0).getTime();
  const date = "2026-10-31";
  appendSession({
    dir,
    date,
    event: { label: "クリスタ", start, end, seconds: 65 },
  });
  appendSession({
    dir,
    date,
    event: { label: "スレスパ", start, end, seconds: 60 },
  });

  const lines = fs
    .readFileSync(sessionsPath(dir, date), "utf8")
    .replace(new RegExp("^" + String.fromCharCode(0xfeff)), "")
    .split("\r\n")
    .filter(Boolean);
  assert.deepEqual(lines, [
    "date,app,start,end,seconds",
    "2026-10-31,クリスタ,09:00:00,09:01:00,65",
    "2026-10-31,スレスパ,09:00:00,09:01:00,60",
  ]);
});
