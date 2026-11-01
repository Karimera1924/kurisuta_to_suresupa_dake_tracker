const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validatePinned,
  validateAliases,
  loadPinned,
  loadAliases,
  savePinned,
  saveAliases,
} = require("../src/storage/settings");

function tmpFile() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "apptime-set-")),
    "settings.json",
  );
}

test("validatePinned は空白を除き、大文字小文字の重複を除く", () => {
  assert.deepEqual(validatePinned([" Notepad ", "notepad", "Paint"]), [
    "Notepad",
    "Paint",
  ]);
});

test("validatePinned は 3 件以上・非文字列・空の名前を拒否する", () => {
  assert.throws(() => validatePinned(["a", "b", "c"]), /最大 2 件/);
  assert.throws(() => validatePinned([1]), /文字列/);
  assert.throws(() => validatePinned([" "]), /長さ/);
  assert.throws(() => validatePinned("a"), /配列/);
});

test("ファイルが無い・壊れている時はピン留め無し", () => {
  assert.deepEqual(loadPinned(tmpFile()), []);
  const file = tmpFile();
  fs.writeFileSync(file, "{ broken");
  assert.deepEqual(loadPinned(file), []);
});

test("保存した内容を読み戻せる", () => {
  const file = tmpFile();
  savePinned(file, ["Notepad"]);
  assert.deepEqual(loadPinned(file), ["Notepad"]);
});

test("validateAliases は名前を小文字にし、別名の前後の空白を除く", () => {
  assert.deepEqual(validateAliases({ " ClipStudioPaint ": " クリス " }), {
    clipstudiopaint: "クリス",
  });
});

test("validateAliases は文字数で 8 文字まで（日本語も 1 文字と数える）", () => {
  assert.deepEqual(validateAliases({ a: "12345678" }), { a: "12345678" });
  assert.deepEqual(validateAliases({ a: "あいうえおかきく" }), {
    a: "あいうえおかきく",
  });
  assert.throws(() => validateAliases({ a: "123456789" }), /8 文字まで/);
});

test("validateAliases は空の別名を除く（別名を消す操作）", () => {
  assert.deepEqual(validateAliases({ a: "  ", b: "B" }), { b: "B" });
});

test("validateAliases は 100 件を超えると拒否する", () => {
  const input = {};
  for (let i = 0; i < 101; i++) input[`app${i}`] = "x";
  assert.throws(() => validateAliases(input), /最大 100 件/);
});

test("validateAliases は非オブジェクトと非文字列の別名を拒否する", () => {
  assert.throws(() => validateAliases(["a"]), /オブジェクト/);
  assert.throws(() => validateAliases(null), /オブジェクト/);
  assert.throws(() => validateAliases({ a: 1 }), /文字列/);
  assert.throws(() => validateAliases({ "": "x" }), /長さ/);
});

test("別名は保存して読み戻せ、ピン留めを消さない", () => {
  const file = tmpFile();
  savePinned(file, ["ClipStudioPaint", "SlayTheSpire"]);
  saveAliases(file, { clipstudiopaint: "クリス" });
  assert.deepEqual(loadAliases(file), { clipstudiopaint: "クリス" });
  assert.deepEqual(loadPinned(file), ["ClipStudioPaint", "SlayTheSpire"]);
});

test("ファイルが無い・壊れている時は別名無し", () => {
  assert.deepEqual(loadAliases(tmpFile()), {});
  const file = tmpFile();
  fs.writeFileSync(file, '{"aliases": "not-an-object"}');
  assert.deepEqual(loadAliases(file), {});
});
