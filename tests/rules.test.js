const test = require("node:test");
const assert = require("node:assert/strict");
const { TARGETS } = require("../src/core/targets");
const {
  matchTarget,
  isCounting,
  formatDuration,
} = require("../src/core/rules");

test("プロセス名で対象を判定する（大文字小文字は無視）", () => {
  const t = matchTarget({ processName: "clipstudiopaint", title: "" }, TARGETS);
  assert.equal(t.key, "clipstudio");
});

test("プロセス名が一致しなければタイトルで判定する", () => {
  const t = matchTarget(
    { processName: "explorer", title: "Slay the Spire" },
    TARGETS,
  );
  assert.equal(t.key, "slaythespire");
});

test("どちらも一致しなければ null、前面なしも null", () => {
  assert.equal(
    matchTarget({ processName: "notepad", title: "memo" }, TARGETS),
    null,
  );
  assert.equal(matchTarget(null, TARGETS), null);
});

test("対象が前面で入力が閾値以内なら計測する", () => {
  const t = TARGETS[0];
  assert.equal(isCounting(t, 30000, 30), true);
  assert.equal(isCounting(t, 30001, 30), false);
  assert.equal(isCounting(null, 0, 30), false);
});

test("formatDuration は既存 PS1 と同じ表記にする", () => {
  assert.equal(formatDuration(45), "45秒");
  assert.equal(formatDuration(205), "3分25秒");
  assert.equal(formatDuration(3930), "1時間5分30秒");
});
