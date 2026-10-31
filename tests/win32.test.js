const test = require("node:test");
const assert = require("node:assert/strict");
const { observe } = require("../src/platform/win32");

// 実機依存の確認。形だけを見る（前面のアプリ名は環境で変わるため）。
test(
  "observe は foreground と idleMs を返す",
  { skip: process.platform !== "win32" },
  () => {
    const r = observe();
    assert.equal(typeof r.idleMs, "number");
    assert.ok(r.idleMs >= 0);
    if (r.foreground !== null) {
      assert.equal(typeof r.foreground.processName, "string");
      assert.equal(typeof r.foreground.title, "string");
    }
  },
);
