const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  writeSummary,
  writeTitles,
  appendSession,
  loadTotals,
  loadTitles,
  localDate,
  loadSessions,
  summaryPath,
  titlesPath,
  sessionsPath,
} = require("../src/storage/csv");

const BOM = String.fromCharCode(0xfeff);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apptime-"));
}

test("summary を書いて、同じ合計を読み戻せる（再起動の引き継ぎ）", () => {
  const dir = tmpDir();
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const date = localDate(now);
  const totals = {
    clipstudiopaint: { label: "ClipStudioPaint", seconds: 600 },
    slaythespire: { label: "SlayTheSpire", seconds: 90 },
  };
  writeSummary({ dir, date, totals, now });

  const text = fs.readFileSync(summaryPath(dir, date), "utf8");
  assert.ok(
    text.startsWith(BOM + "date,app,total_seconds,total_minutes,updated_at"),
  );
  assert.ok(text.includes("2026-10-31,ClipStudioPaint,600,10,12:00:00"));
  assert.deepEqual(loadTotals({ dir, date }), totals);
});

test("total_minutes は PowerShell の [math]::Round と同じ偶数丸め", () => {
  const dir = tmpDir();
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const date = "2026-10-31";
  writeSummary({
    dir,
    date,
    totals: {
      a: { label: "A", seconds: 15 },
      b: { label: "B", seconds: 75 },
    },
    now,
  });
  const text = fs.readFileSync(summaryPath(dir, date), "utf8");
  assert.ok(text.includes("2026-10-31,A,15,0.2,12:00:00"));
  assert.ok(text.includes("2026-10-31,B,75,1.2,12:00:00"));
});

test("titles を書いて、同じ合計を読み戻せる（タイトルに「,」があっても壊れない）", () => {
  const dir = tmpDir();
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const date = localDate(now);
  const totals = {
    "GitHub, Inc": { label: "GitHub_ Inc", seconds: 600 },
    Docs: { label: "Docs", seconds: 90 },
  };
  writeTitles({ dir, date, totals, now });

  const text = fs.readFileSync(titlesPath(dir, date), "utf8");
  assert.ok(
    text.startsWith(BOM + "date,title,total_seconds,total_minutes,updated_at"),
  );
  assert.ok(text.includes("2026-10-31,GitHub_ Inc,600,10,12:00:00"));
  assert.deepEqual(loadTitles({ dir, date }), {
    "GitHub_ Inc": { label: "GitHub_ Inc", seconds: 600 },
    Docs: { label: "Docs", seconds: 90 },
  });
});

test("titles が無い日は空の合計を返す", () => {
  assert.deepEqual(loadTitles({ dir: tmpDir(), date: "2000-01-01" }), {});
});

test("summary が無い日は空の合計を返す", () => {
  assert.deepEqual(loadTotals({ dir: tmpDir(), date: "2000-01-01" }), {});
});

test("loadSessions は BOM を外して区間を読み戻す", () => {
  const dir = tmpDir();
  const start = new Date(2026, 9, 31, 9, 0, 0).getTime();
  const end = new Date(2026, 9, 31, 9, 1, 0).getTime();
  appendSession({
    dir,
    date: "2026-10-31",
    event: { label: "ClipStudioPaint", start, end, seconds: 65 },
  });
  assert.deepEqual(loadSessions({ dir, date: "2026-10-31" }), [
    {
      label: "ClipStudioPaint",
      start: "09:00:00",
      end: "09:01:00",
      seconds: 65,
    },
  ]);
});

test("loadSessions は区間が無い日（ファイル無し・空ファイル）で空配列", () => {
  const dir = tmpDir();
  assert.deepEqual(loadSessions({ dir, date: "2000-01-01" }), []);
  fs.writeFileSync(sessionsPath(dir, "2000-01-02"), "");
  assert.deepEqual(loadSessions({ dir, date: "2000-01-02" }), []);
});

test("sessions はヘッダを 1 回だけ書き、以後は追記する", () => {
  const dir = tmpDir();
  const start = new Date(2026, 9, 31, 9, 0, 0).getTime();
  const end = new Date(2026, 9, 31, 9, 1, 0).getTime();
  const date = "2026-10-31";
  appendSession({
    dir,
    date,
    event: { label: "ClipStudioPaint", start, end, seconds: 65 },
  });
  appendSession({
    dir,
    date,
    event: { label: "SlayTheSpire", start, end, seconds: 60 },
  });

  const lines = fs
    .readFileSync(sessionsPath(dir, date), "utf8")
    .replace(new RegExp("^" + BOM), "")
    .split("\r\n")
    .filter(Boolean);
  assert.deepEqual(lines, [
    "date,app,start,end,seconds",
    "2026-10-31,ClipStudioPaint,09:00:00,09:01:00,65",
    "2026-10-31,SlayTheSpire,09:00:00,09:01:00,60",
  ]);
});
