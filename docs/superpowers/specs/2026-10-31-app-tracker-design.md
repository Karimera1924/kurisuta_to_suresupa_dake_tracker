# App Tracker 設計書

Written for: このリポジトリを後から読む開発者本人（Windows / Node.js / Python の知識がある前提）。

## 1. 目的

既存の `AppTimeTracker.ps1`（クリスタ / スレスパの操作時間計測）を、次の3つの責務に分けて作り直す。

| 責務 | 役割 | 実装言語 |
|------|------|----------|
| tracker（バックエンド） | 前面アプリ・最終入力の観測、集計、CSV 保存、ローカル HTTP API、WebUI の配信 | Node.js 24 |
| web（WebUI） | API を呼んで集計を表示する。データは持たない | 素の HTML / JS（ビルド無し） |
| tray（タスクバー常駐） | 本日の合計をツールチップに出し、WebUI を開く。データは持たない | Python 3.12（pystray + Pillow） |

3つは **HTTP の API だけで会話する**。tray と web は tracker の中身（Win32 やファイル形式）を知らない。
これにより、どれか1つを作り直しても他に影響しない。

## 2. 言語の選定（Python 案への回答）

- バックエンドは **Node.js のままにする**。理由: 既に Node 24 が入っている、`node:http` と `node:test` で依存ゼロに近く書ける、Win32 は `koffi`（npm 最新 3.x）で DLL を直接呼べる。
- **タスクバー常駐だけ Python を推奨する**。`systray2`（npm）は最終更新が 2022 年で、保守が止まっている。Python の `pystray` は 0.19.5（2023-09）が最新で、Windows の通知領域で広く使われている。Python 3.12.10 は導入済み。
- Python を tracker 側まで広げる案も検討したが、Win32 を `ctypes` で書く手間は koffi と大差なく、Node 側の HTTP / テスト基盤を捨てる理由がない。よって採用しない。
- 言語が2つになる代償は、tray が独立した小さなプロセス（約100行想定）になることで相殺できる。

## 3. 計測ルール（既存 PS1 から変えない）

- 対象は **クリスタ** と **スレスパ** の2つ。判定はプロセス名（部分一致）またはウィンドウタイトル（部分一致）。
- 対象アプリが前面、かつ最後の入力（キーボード / マウス / ペン）から `IdleSeconds`（既定 30 秒）以内なら加算する。
- 判定間隔は `PollSeconds`（既定 5 秒）。
- キー入力の中身、ファイル名、ウィンドウタイトルは **保存しない**（判定にだけ使い、ディスクには書かない）。
- 出力は既存と同じ形式を維持する（PS1 の CSV を引き継げるように）。
  - `ドキュメント\AppTime\YYYY-MM-DD-summary.csv`: `date,app,total_seconds,total_minutes,updated_at`
  - `ドキュメント\AppTime\YYYY-MM-DD-sessions.csv`: `date,app,start,end,seconds`
- 再起動したら、同じ日の summary CSV から合計を引き継ぐ。

## 4. 構成

```
app_tracking/
  AppTimeTracker.ps1        旧版。新版が同等になるまで残す
  CLAUDE.md                 Superpowers の運用ルール
  docs/
    superpowers/specs/      設計書（本ファイル）
    superpowers/plans/      実装計画
    README.md               docs の索引と運用メモ
  src/                      tracker（Node.js）
    core/                   計測ルール（純粋関数。Windows 非依存）
    platform/win32.js       koffi による Win32 呼び出し（前面窓・プロセス名・最終入力）
    storage/csv.js          summary / sessions の CSV 書き込み
    server/                 HTTP API と web/ の静的配信
    tracker.js              エントリポイント（計測ループ + サーバ起動）
  web/                      WebUI（index.html ほか）
  tray/                     タスクバー常駐（Python）
    tray.py
  scripts/                  Task Scheduler 登録用 ps1（後半フェーズ）
  tests/                    node:test によるテスト
```

## 5. API 契約（tracker ⇄ web / tray）

ベース URL: `http://127.0.0.1:17600`（ループバックのみ。外部には公開しない）

| メソッド | パス | 応答 |
|----------|------|------|
| GET | `/api/health` | `{ "ok": true, "version": "..." }` |
| GET | `/api/status` | `{ "date", "counting": bool, "target": "clipstudio" \| null, "idleSeconds", "totals": { "clipstudio": {"label","seconds"}, "slaythespire": {...} }, "updatedAt" }` |
| GET | `/api/summary?date=YYYY-MM-DD` | 後半フェーズ。summary CSV を JSON にして返す |
| GET | `/` | `web/index.html` |

- 応答は常に JSON（`Content-Type: application/json; charset=utf-8`）。
- 不明なパスは 404 の JSON を返す。
- API の形を変えるときは、この表を先に更新する。

## 6. 起動と常駐

- tracker は `node src/tracker.js` で起動する。Task Scheduler に「ログオン時」で登録する（登録スクリプトは後半フェーズで `scripts/` に置く）。
- tray は `pythonw tray/tray.py` で起動し、同じくログオン時に登録する。
- tray は tracker が落ちていれば「未接続」と表示するだけで、自分では起動しない（責務を分けるため）。

## 7. 非機能

- ネットワーク送信なし。待ち受けは 127.0.0.1 のみ。
- 合計は判定のたびに保存する（強制終了しても直近の判定までは残る）。
- 1 回の API 応答は小さく保つ（ポーリングは 5 秒おき程度）。

## 8. 既知の制約・未検証事項

- ペン入力が最終入力時刻に反映されるかは環境依存（PS1 の注意書きを踏襲。実機で確認が必要）。
- koffi の Windows 向け prebuild が Node 24 で動くかは、実機で `npm install` して確認する（計画の Task 1）。
- Documents フォルダがリダイレクトされている場合の扱いは、初版では `%USERPROFILE%\Documents` 固定とする。
- 対象アプリを増やすときは `src/core/targets.js` を編集する（コードの変更で対応。設定ファイル化は後回し）。
