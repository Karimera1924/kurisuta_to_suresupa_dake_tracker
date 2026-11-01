const test = require("node:test");
const assert = require("node:assert/strict");
const { appOf, isCounting, formatDuration } = require("../src/core/rules");

test("プロセス名からキーと表示名を決める（キーは小文字）", () => {
  assert.deepEqual(appOf({ processName: "ClipStudioPaint", title: "" }), {
    key: "clipstudiopaint",
    label: "ClipStudioPaint",
  });
});

test("除外対象・プロセス名なし・前面なしは null", () => {
  assert.equal(appOf({ processName: "explorer", title: "" }), null);
  assert.equal(appOf({ processName: "ShellExperienceHost", title: "" }), null);
  assert.equal(appOf({ processName: "", title: "x" }), null);
  assert.equal(appOf(null), null);
});

test("前面のアプリがあって入力が閾値以内なら計測する", () => {
  const app = { key: "x", label: "X" };
  assert.equal(isCounting(app, 30000, 30), true);
  assert.equal(isCounting(app, 30001, 30), false);
  assert.equal(isCounting(null, 0, 30), false);
});

test("formatDuration は既存 PS1 と同じ表記にする", () => {
  assert.equal(formatDuration(45), "45秒");
  assert.equal(formatDuration(205), "3分25秒");
  assert.equal(formatDuration(3930), "1時間5分30秒");
});
