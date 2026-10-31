const test = require("node:test");
const assert = require("node:assert/strict");
const { TARGETS } = require("../src/core/targets");
const { createAccumulator } = require("../src/core/accumulator");

const CS = { processName: "ClipStudioPaint", title: "" };
const SPIRE = { processName: "SlayTheSpire", title: "" };
const OTHER = { processName: "explorer", title: "" };

function make(initialTotals) {
  return createAccumulator({
    targets: TARGETS,
    pollSeconds: 5,
    idleSeconds: 30,
    initialTotals,
  });
}

test("対象が前面で入力があれば、ポーリング秒数ずつ加算する", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  const r = acc.tick(5000, { foreground: CS, idleMs: 0 });
  assert.equal(r.counting, true);
  assert.equal(acc.totals().clipstudio, 10);
});

test("待機になると区間が閉じ、秒数が events に出る（PS1 と同じく +PollSeconds）", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  acc.tick(5000, { foreground: CS, idleMs: 0 });
  const r = acc.tick(10000, { foreground: CS, idleMs: 60000 });
  assert.equal(r.counting, false);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].label, "クリスタ");
  assert.equal(r.events[0].seconds, 10); // 開始→最後の計測 5秒 + 5秒
});

test("対象Aから対象Bに変わると、前の区間を閉じて新しい区間を開く", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  const r = acc.tick(5000, { foreground: SPIRE, idleMs: 0 });
  assert.equal(r.events[0].key, "clipstudio");
  assert.equal(r.target, "slaythespire");
  assert.equal(acc.totals().slaythespire, 5);
});

test("対象外のアプリは計測せず、開いていた区間は閉じる", () => {
  const acc = make();
  acc.tick(0, { foreground: CS, idleMs: 0 });
  const r = acc.tick(5000, { foreground: OTHER, idleMs: 0 });
  assert.equal(r.counting, false);
  assert.equal(r.events.length, 1);
  assert.equal(acc.totals().clipstudio, 5);
});

test("initialTotals から再開できる", () => {
  const acc = make({ clipstudio: 600 });
  acc.tick(0, { foreground: CS, idleMs: 0 });
  assert.equal(acc.totals().clipstudio, 605);
  assert.equal(acc.totals().slaythespire, 0);
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
