// Chrome のウィンドウタイトルごとの計測。アプリ単位の集計（chrome）とは別に、タイトルごとの秒数を持つ。
const CHROME_KEY = "chrome";
const UNTITLED = "(無題)";
// 末尾の「 - Google Chrome」と、その後ろに付く表示（シークレットなど）を外す
const CHROME_SUFFIX = /\s+-\s+Google Chrome(?:\s.*)?$/;

// 同じページを同じ名前で数えるための正規化。CSV を壊す区切り・改行は「_」に置き換える。
function normalizeTitle(title) {
  const t = String(title || "")
    .trim()
    .replace(CHROME_SUFFIX, "")
    .trim()
    .replace(/[,\r\n]/g, "_");
  return t || UNTITLED;
}

// initialTotals は { [label]: { label, seconds } }（再起動時に CSV から読み戻した分）。
// totals() の形式は accumulator と同じ { [key]: { label, seconds } } で、key は label と同じ。
function createTitleTally({ pollSeconds, initialTotals = {} }) {
  const seconds = new Map();
  for (const { label, seconds: s } of Object.values(initialTotals)) {
    seconds.set(label, s);
  }
  return {
    record(rawTitle) {
      const label = normalizeTitle(rawTitle);
      seconds.set(label, (seconds.get(label) || 0) + pollSeconds);
    },
    totals() {
      const out = {};
      for (const [label, s] of seconds) out[label] = { label, seconds: s };
      return out;
    },
  };
}

module.exports = { CHROME_KEY, UNTITLED, normalizeTitle, createTitleTally };
