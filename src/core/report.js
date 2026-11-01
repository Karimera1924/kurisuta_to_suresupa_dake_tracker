// 表示用の集計。ファイルも時計も触らない純粋な関数だけを置く。
const DAY_SECONDS = 24 * 60 * 60;

// "HH:mm:ss" を、その日の 0 時からの秒数にする。形式が違えば null。
function toSecondOfDay(hms) {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(hms);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// 区間を 0〜23 時の時間帯ごとの秒数に配る。開始時刻から秒数ぶんを進め、
// 時間をまたぐ区間は両方の時間帯に分けて入れる。0 時をまたぐ分は捨てる。
function hourlyBuckets(sessions) {
  const buckets = new Array(24).fill(0);
  for (const s of sessions) {
    const start = toSecondOfDay(s.start);
    if (start === null) continue;
    const end = Math.min(start + s.seconds, DAY_SECONDS);
    for (let from = start; from < end;) {
      const hour = Math.floor(from / 3600);
      const next = Math.min((hour + 1) * 3600, end);
      buckets[hour] += next - from;
      from = next;
    }
  }
  return buckets;
}

// 複数日の apps（{label, seconds} の配列をまとめたもの）から、秒数が多い順に上位 n 件を出す。
// 名前は大文字小文字を区別せず合算し、表示名は最初に出たものを使う。秒数 0 のアプリは含めない。
function topApps(apps, n) {
  const sums = new Map();
  for (const a of apps) {
    const key = a.label.toLowerCase();
    const cur = sums.get(key) || { label: a.label, seconds: 0 };
    cur.seconds += a.seconds;
    sums.set(key, cur);
  }
  return [...sums.values()]
    .filter((a) => a.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, n);
}

// 1 日分の apps（{label, seconds}）から、top に入っているアプリごとの秒数と、残りの秒数を出す。
// 名前は大文字小文字を区別しない。top に無いアプリは other_seconds にまとめる。
function splitByTop(apps, totalSeconds, topNames) {
  const byKey = new Map(apps.map((a) => [a.label.toLowerCase(), a.seconds]));
  const top = topNames.map((name) => ({
    label: name,
    seconds: byKey.get(name.toLowerCase()) || 0,
  }));
  const topSum = top.reduce((sum, t) => sum + t.seconds, 0);
  return { top, other_seconds: Math.max(0, totalSeconds - topSum) };
}

module.exports = { hourlyBuckets, splitByTop, toSecondOfDay, topApps };
