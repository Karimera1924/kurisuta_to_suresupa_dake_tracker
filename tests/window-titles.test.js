const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHROME_KEY,
  UNTITLED,
  normalizeTitle,
  createTitleTally,
} = require("../src/core/window-titles");

test("末尾の「 - Google Chrome」と、その後ろの表示を外す", () => {
  assert.equal(normalizeTitle("GitHub - Google Chrome"), "GitHub");
  assert.equal(
    normalizeTitle("GitHub - Google Chrome - シークレット"),
    "GitHub",
  );
  assert.equal(normalizeTitle("Docs - Google Chrome 個人"), "Docs");
});

test("Chrome 以外のタイトルはそのまま（前後の空白だけ除く）", () => {
  assert.equal(normalizeTitle("  メモ帳  "), "メモ帳");
  assert.equal(
    normalizeTitle("README.md - Visual Studio Code"),
    "README.md - Visual Studio Code",
  );
});

test("CSV を壊す「,」と改行は「_」に置き換える", () => {
  assert.equal(normalizeTitle("a, b\r\nc"), "a_ b__c");
});

test("空や空白だけのタイトルは無題になる", () => {
  assert.equal(normalizeTitle(""), UNTITLED);
  assert.equal(normalizeTitle("   "), UNTITLED);
  assert.equal(normalizeTitle(undefined), UNTITLED);
});

test("record は同じタイトルを pollSeconds ずつ足す", () => {
  const tally = createTitleTally({ pollSeconds: 5 });
  tally.record("GitHub - Google Chrome");
  tally.record("GitHub");
  tally.record("Docs - Google Chrome");
  assert.deepEqual(tally.totals(), {
    GitHub: { label: "GitHub", seconds: 10 },
    Docs: { label: "Docs", seconds: 5 },
  });
});

test("initialTotals（再起動時に読み戻した分）の上に足す", () => {
  const tally = createTitleTally({
    pollSeconds: 5,
    initialTotals: { GitHub: { label: "GitHub", seconds: 100 } },
  });
  tally.record("GitHub - Google Chrome");
  assert.equal(tally.totals().GitHub.seconds, 105);
});

test("CHROME_KEY は accumulator のアプリ単位の key と同じ小文字の chrome", () => {
  assert.equal(CHROME_KEY, "chrome");
});
