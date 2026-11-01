const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hourlyBuckets,
  splitByTop,
  toSecondOfDay,
  topApps,
} = require("../src/core/report");

test("toSecondOfDay は HH:mm:ss を 0 時からの秒数にし、形式が違えば null", () => {
  assert.equal(toSecondOfDay("01:02:03"), 3723);
  assert.equal(toSecondOfDay("23:59:59"), 86399);
  assert.equal(toSecondOfDay("1:02:03"), null);
  assert.equal(toSecondOfDay("bad"), null);
});

test("hourlyBuckets は時間をまたぐ区間を両方の時間帯に分ける", () => {
  const buckets = hourlyBuckets([
    { label: "A", start: "09:59:30", seconds: 60 },
  ]);
  assert.equal(buckets[9], 30);
  assert.equal(buckets[10], 30);
  assert.equal(
    buckets.reduce((a, b) => a + b, 0),
    60,
  );
});

test("hourlyBuckets は 0 時をまたぐ分を捨てる", () => {
  const buckets = hourlyBuckets([
    { label: "A", start: "23:59:00", seconds: 300 },
  ]);
  assert.equal(buckets[23], 60);
  assert.equal(
    buckets.reduce((a, b) => a + b, 0),
    60,
  );
});

test("hourlyBuckets は開始時刻が不正な区間を無視する", () => {
  const buckets = hourlyBuckets([{ label: "A", start: "??", seconds: 60 }]);
  assert.equal(buckets.length, 24);
  assert.equal(
    buckets.reduce((a, b) => a + b, 0),
    0,
  );
});

test("topApps は大文字小文字を区別せず合算し、秒数の多い順に n 件出す", () => {
  const result = topApps(
    [
      { label: "Chrome", seconds: 30 },
      { label: "chrome", seconds: 50 },
      { label: "Paint", seconds: 100 },
      { label: "Notepad", seconds: 10 },
    ],
    2,
  );
  assert.deepEqual(result, [
    { label: "Paint", seconds: 100 },
    { label: "Chrome", seconds: 80 },
  ]);
});

test("topApps は秒数 0 のアプリを含めない", () => {
  const result = topApps(
    [
      { label: "A", seconds: 0 },
      { label: "B", seconds: 5 },
    ],
    5,
  );
  assert.deepEqual(result, [{ label: "B", seconds: 5 }]);
});

test("splitByTop は top のアプリを大文字小文字を区別せず突き合わせ、残りを other にまとめる", () => {
  const result = splitByTop(
    [
      { label: "ClipStudioPaint", seconds: 100 },
      { label: "Chrome", seconds: 50 },
    ],
    200,
    ["clipstudiopaint"],
  );
  assert.deepEqual(result, {
    top: [{ label: "clipstudiopaint", seconds: 100 }],
    other_seconds: 100,
  });
});

test("splitByTop は top に無いアプリの秒数を 0 にし、other_seconds を負にしない", () => {
  const result = splitByTop([{ label: "Paint", seconds: 100 }], 50, [
    "Paint",
    "Missing",
  ]);
  assert.deepEqual(result.top, [
    { label: "Paint", seconds: 100 },
    { label: "Missing", seconds: 0 },
  ]);
  assert.equal(result.other_seconds, 0);
});
