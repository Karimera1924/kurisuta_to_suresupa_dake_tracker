const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccumulator } = require("../src/core/accumulator");

const CS = { processName: "ClipStudioPaint", title: "" };
const SPIRE = { processName: "SlayTheSpire", title: "" };
const EXPLORER = { processName: "explorer", title: "" };

function make(initialTotals) {
  return createAccumulator({
    pollSeconds: 5,
    idleSeconds: 30,
    initialTotals,
  });
}

test("どのアプリでも前面で入力があれば、ポーリング秒数ずつ加算する", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  const r = acc.tick(5000, { foreground: CS, idleMs: 0 });
  assert.equal(r.counting, true);
  assert.equal(acc.totals().clipstudiopaint.seconds, 10);
  assert.equal(acc.totals().clipstudiopaint.label, "ClipStudioPaint");
});

test("大文字小文字違いの同じ exe は一つに合算する", () => {
  const acc = make();
  acc.tick(0, { foreground: { processName: "Notepad", title: "" }, idleMs: 0 });
  acc.tick(5000, {
    foreground: { processName: "notepad", title: "" },
    idleMs: 0,
  });
  assert.deepEqual(Object.keys(acc.totals()), ["notepad"]);
  assert.equal(acc.totals().notepad.seconds, 10);
});

test("待機になると区間が閉じ、秒数が events に出る（PS1 と同じく +PollSeconds）", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  acc.tick(5000, { foreground: CS, idleMs: 0 });
  const r = acc.tick(10000, { foreground: CS, idleMs: 60000 });
  assert.equal(r.counting, false);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].label, "ClipStudioPaint");
  assert.equal(r.events[0].seconds, 10); // 開始→最後の計測 5秒 + 5秒
});

test("アプリが変わると、前の区間を閉じて新しい区間を開く", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  const r = acc.tick(5000, { foreground: SPIRE, idleMs: 0 });
  assert.equal(r.events[0].key, "clipstudiopaint");
  assert.equal(r.target, "slaythespire");
  assert.equal(acc.totals().slaythespire.seconds, 5);
});

test("除外対象（デスクトップ）は計測せず、開いていた区間は閉じる", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  const r = acc.tick(5000, { foreground: EXPLORER, idleMs: 0 });
  assert.equal(r.counting, false);
  assert.equal(r.events.length, 1);
  assert.equal(acc.totals().clipstudiopaint.seconds, 5);
  assert.equal(acc.totals().explorer, undefined);
});

test("initialTotals から再開できる", () => {
  const acc = make({
    clipstudiopaint: { label: "ClipStudioPaint", seconds: 600 },
  });
  acc.tick(0, { foreground: CS, idleMs: 0 });
  assert.equal(acc.totals().clipstudiopaint.seconds, 605);
});

test("flush は開いている区間を閉じ、以後は空を返す", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  acc.tick(5000, { foreground: CS, idleMs: 0 });
  const events = acc.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].seconds, 10);
  assert.deepEqual(acc.flush(), []);
});
