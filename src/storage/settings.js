// タスクバーに出すアプリ（ピン留め）と、その別名の保存と検証。保存先は data/settings.json。
const fs = require("node:fs");
const path = require("node:path");
const { MAX_PINNED } = require("../core/targets");

const MAX_NAME_LENGTH = 260;
const MAX_ALIAS_CHARS = 8; // タスクバーの表示欄が狭いので短く保つ
const MAX_ALIASES = 100;

// 入力を検証して、重複を除いたプロセス名の配列にする。不正なら Error。
function validatePinned(input) {
  if (!Array.isArray(input)) throw new Error("pinned は配列");
  const seen = new Set();
  const names = [];
  for (const name of input) {
    if (typeof name !== "string") throw new Error("名前は文字列");
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) {
      throw new Error("名前の長さが不正");
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }
  if (names.length > MAX_PINNED) throw new Error("ピン留めは最大 2 件");
  return names;
}

// 入力を検証して、{ [小文字のプロセス名]: 別名 } にする。値が空の項目は別名を消す意味なので除く。不正なら Error。
function validateAliases(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("aliases はオブジェクト");
  }
  const aliases = {};
  for (const [name, alias] of Object.entries(input)) {
    const key = name.trim().toLowerCase();
    if (!key || key.length > MAX_NAME_LENGTH)
      throw new Error("名前の長さが不正");
    if (typeof alias !== "string") throw new Error("別名は文字列");
    const trimmed = alias.trim();
    if (!trimmed) continue;
    if (Array.from(trimmed).length > MAX_ALIAS_CHARS) {
      throw new Error(`別名は ${MAX_ALIAS_CHARS} 文字まで`);
    }
    aliases[key] = trimmed;
  }
  if (Object.keys(aliases).length > MAX_ALIASES) {
    throw new Error(`別名は最大 ${MAX_ALIASES} 件`);
  }
  return aliases;
}

// 設定ファイルを読む。無い・壊れている・オブジェクトでない場合は空。
function readSettings(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// 他のキー（pinned と aliases の片方）を消さないように、既存の設定に patch をかぶせて書く。
function writeSettings(file, patch) {
  const data = { ...readSettings(file), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 一時ファイルに書いてから置き換える（書き込み中に落ちても壊れた JSON を残さない）
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// 保存済みのピン留めを読む。無い・壊れている場合はピン留め無し。
function loadPinned(file) {
  try {
    return validatePinned(readSettings(file).pinned);
  } catch {
    return [];
  }
}

// 保存済みの別名を読む。無い・壊れている場合は別名無し。
function loadAliases(file) {
  try {
    return validateAliases(readSettings(file).aliases);
  } catch {
    return {};
  }
}

function savePinned(file, pinned) {
  const names = validatePinned(pinned);
  writeSettings(file, { pinned: names });
  return names;
}

function saveAliases(file, aliases) {
  const map = validateAliases(aliases);
  writeSettings(file, { aliases: map });
  return map;
}

module.exports = {
  validatePinned,
  validateAliases,
  loadPinned,
  loadAliases,
  savePinned,
  saveAliases,
};
