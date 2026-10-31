// 計測対象の定義。増やすときはここに 1 件足す。
// ProcessPattern / TitlePattern は部分一致（大文字小文字は無視）で判定する。
const TARGETS = [
  {
    key: "clipstudio",
    label: "クリスタ",
    processPattern: "ClipStudio",
    titlePattern: "CLIP STUDIO PAINT",
  },
  {
    key: "slaythespire",
    label: "スレスパ",
    processPattern: "SlayTheSpire",
    titlePattern: "Slay the Spire",
  },
];

module.exports = { TARGETS };
