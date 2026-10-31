# App Tracker 実装計画

Written for: 実装を担当するエージェント（Haiku 5.5）と、後でレビューする人。
設計は [../specs/2026-10-31-app-tracker-design.md](../specs/2026-10-31-app-tracker-design.md) を正とする。

## 運用ルール

- 実行方法は Native（CLAUDE.md に従う）。
- 実装は Haiku 5.5、フェーズ末のレビューだけ `claude-sonnet-5-5` を明示して dispatch する。
- 1 タスクごとに「テスト → 実装 → テスト通過 → コミット」の順で進める（TDD）。
- コミットは `main` に直接入れず、`feature/app-tracker` ブランチで作業する。
- コミットメッセージ末尾に `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` を付ける。
- push はしない（リモート無し）。
- 1 セッションの目安は 10 万トークン。超えそうなら、そのフェーズを区切ってコミットし、次セッションに引き継ぐ。

## フェーズ 0: 環境確認（完了）

- [x] git 初期化、ベースラインのコミット（`main`）
- [x] `.gitignore` / `.prettierignore` / `.gitattributes` の整備
- [x] `.claude/settings.json` と `CLAUDE.md` の JSON・記述を確認（構文エラー無し）
- [x] 設計書の作成

## フェーズ 1: tracker（バックエンド）

ブランチ: `feature/app-tracker`（フェーズ 1 の最初に作成）

### Task 1: 依存導入と koffi の動作確認
- [ ] `npm install koffi --save`（runtime 依存として追加）
- [ ] `node -e "require('koffi')"` が通ること
- [ ] `GetForegroundWindow` を1回呼び、ハンドル（0 でも可）が返ることを確認
- 検証: 出力を貼ってから次へ。失敗したら設計書 §8 に記録し、Python 側で ctypes 実装に切り替える案を検討する

### Task 2: 対象定義と判定ルール（純粋関数）
ファイル: `src/core/targets.js`, `src/core/rules.js`, `tests/rules.test.js`
- [ ] `targets.js`: clipstudio（ProcessPattern `ClipStudio` / TitlePattern `CLIP STUDIO PAINT`）、slaythespire（`SlayTheSpire` / `Slay the Spire`）
- [ ] `matchTarget({processName, title}, targets)`: プロセス名 → タイトルの順で部分一致（大文字小文字は無視）。一致なしは `null`
- [ ] `isCounting({target, idleMs}, idleSeconds)`: target があり、`idleMs <= idleSeconds*1000` のとき true
- [ ] `formatDuration(sec)`: 既存 PS1 と同じ表記（`45秒` / `3分25秒` / `1時間15分30秒`）
- 検証: `node --test tests/rules.test.js` が全部通る

### Task 3: 集計ステート（純粋関数）
ファイル: `src/core/accumulator.js`, `tests/accumulator.test.js`
- [ ] `createAccumulator({targets, pollSeconds, idleSeconds, initialTotals})`
- [ ] `tick(now, observation)`: 加算と区間（segment）の開閉を行い、閉じた区間をイベントとして返す
- [ ] 対象が変わったら前の区間を閉じる。対象外・待機になったら閉じる
- [ ] `totals()` と `flush(now)`（終了時に開いている区間を閉じる）
- 検証: 「対象→待機→対象」「対象A→対象B」「initialTotals からの再開」の3ケースをテストで確認

### Task 4: CSV 保存
ファイル: `src/storage/csv.js`, `tests/csv.test.js`
- [ ] `writeSummary(dir, date, totals, now)`: 既存 PS1 と同じ列・同じ文字コード（UTF-8）
- [ ] `appendSession(dir, date, segment)`: sessions CSV にヘッダ付きで追記（無ければヘッダを書く）
- [ ] `loadTotals(dir, date)`: summary があれば合計を読み戻す（再起動の引き継ぎ）
- [ ] テストは一時ディレクトリを使う（実際の Documents は触らない）
- 検証: `node --test tests/csv.test.js`

### Task 5: Win32 アダプタ
ファイル: `src/platform/win32.js`
- [ ] `GetForegroundWindow`, `GetWindowTextW`, `GetWindowThreadProcessId`, `GetLastInputInfo`（user32）
- [ ] `OpenProcess` + `QueryFullProcessImageNameW`（kernel32）でプロセス名（拡張子無し）を取得
- [ ] `observe()` → `{ foreground: {processName, title} | null, idleMs }`。失敗時は `null` と 0 を返し、例外で止めない
- [ ] 外部からは `observe()` だけが見えること（koffi の詳細を漏らさない）
- 検証: 実機で `node -e "console.log(require('./src/platform/win32').observe())"` を実行し、前面のアプリ名が出ること

### Task 6: HTTP サーバ
ファイル: `src/server/index.js`, `src/server/routes.js`, `tests/server.test.js`
- [ ] `createServer({getStatus, webDir})`、`127.0.0.1` のみで listen
- [ ] `/api/health`、`/api/status`、`/`（web 配信。パストラバーサル対策を入れる）
- [ ] テストは `listen(0)` でランダムポートを使い、`fetch` で確認
- 検証: `node --test tests/server.test.js`

### Task 7: エントリポイント
ファイル: `src/tracker.js`
- [ ] 設定（既定値: IdleSeconds 30、PollSeconds 5、Port 17600、出力先 `%USERPROFILE%\Documents\AppTime`）。環境変数で上書き可
- [ ] 起動時に `loadTotals` で引き継ぐ → `setInterval` で tick → 判定ごとに `writeSummary`
- [ ] SIGINT / SIGTERM で `flush` → `writeSummary` → 終了
- [ ] 例外は握りつぶさずログに出す（ログは `data/` に書くが、gitignore 済み）
- 検証: 実機で 1 分ほど起動し、`/api/status` と CSV の両方が増えることを確認

### フェーズ 1 の完了条件
- [ ] `npm test` が通る（package.json の test を `node --test tests/` に差し替える）
- [ ] `npm run lint` が通る
- [ ] Sonnet 5.5 によるレビュー（フェーズ末に 1 回）
- [ ] ブランチへのコミット後、`main` へのマージ可否をユーザーに確認

## フェーズ 2: WebUI（後半）

- [x] `web/index.html` と `web/app.js`（素の JS、`/api/status` を 5 秒おきに取得）
- [x] 今日の合計と、対象の計測中・待機中の表示
- [ ] `/api/summary` と日付選択（余力があれば）※任意、未着手

## フェーズ 3: tray（Python）

- [x] `tray/tray.py`（pystray + Pillow）。`/api/status` を 5 秒おきに取得し、トレイのツールチップを更新
- [x] `tray/overlay.py`: タスクバーウィンドウ（最前面の `WS_POPUP` 窓）を、通知領域の左隣に高さ一杯で表示する。クリスタとスレスパの今日の合計を表示（子ウィンドウにはしない。描画が XAML 層の下に回るため）
- [x] メニュー: 「WebUI を開く」「終了」。トレイのクリックで WebUI を開く。tracker 未接続なら「未接続」と表示
- [x] `tray/requirements.txt`（pystray, Pillow のバージョン固定）
- [x] 検証: 実機スクリーンショットで、通知領域の左に「クリスタ 12分 / スレスパ 0分」が出ることを確認
- [ ] 検証（ユーザー目視待ち）: トレイのクリックで WebUI が開くこと、「終了」でアイコンとオーバーレイが消えること

## フェーズ 4: 常駐化と旧版の整理

- [ ] `scripts/register-tasks.ps1`: tracker と tray を「ログオン時」に登録する（登録・削除の両方）
- [ ] 新旧の CSV が一致することを 1 日分で確認したら、`AppTimeTracker.ps1` を削除するかユーザーに確認する（削除は破壊的なので、ユーザーの了承を得てから）

## フェーズ 3 の決定事項（タスクバーウィンドウ）

- 表示位置: 通知領域（TrayNotifyWnd）の左隣。窓の右端を通知領域の左端に揃え、高さはタスクバーに収める。子窓ではなく、最前面の `WS_POPUP`（`WS_EX_LAYERED` + `UpdateLayeredWindow`、ピクセル単位アルファ）で描く。子窓は XAML 層の下に回って見えないため。
- 見た目: 半透明の pill（角丸、`PILL_ALPHA = 210`、余白 4 論理px）。背景の透過は番兵色 `0xFF00FF` を alpha 0 にして行う。
- トレイ: 残す。左クリックで WebUI（`http://127.0.0.1:17600/`）を開く。「終了」も残す。
- 全画面の判定: `SHQueryUserNotificationState` は使わない（システム全体で判定するため、サブモニタの全画面でメイン側の表示まで消えてしまう）。代わりに、タスクバーのモニタ（`MonitorFromWindow` + `GetMonitorInfoW`）の `rcMonitor` を前面窓の矩形が覆うかで判定する。`Progman` / `WorkerW` / `Shell_TrayWnd` / `Shell_SecondaryTrayWnd` は除外する。
  - **ユーザー決定**: サブモニタの全画面では、メイン側のオーバーレイを隠さない。
- 自動非表示: `SHAppBarMessage(ABM_GETSTATE)` で `ABS_AUTOHIDE` を見る。
- 更新契機: `EVENT_SYSTEM_FOREGROUND` のフック（`WINEVENT_OUTOFCONTEXT`、メインスレッドのメッセージループで配送）と、300 ms 間隔の `SetTimer` 再判定（メッセージ専用窓の上）。
- 採用しない案:
  - `ABN_FULLSCREENAPP`: `ABM_NEW` で登録した appbar にしか届かない。オーバーレイを appbar にすると作業領域が変わりうるため不採用。
  - `SHQueryUserNotificationState`: 上記の理由で不採用。
- カーソル: ウィンドウクラスの `hCursor` が NULL だと直前のスレッドカーソル（砂時計）が出る。`LoadCursorW(None, IDC_ARROW)` を設定して解決（ユーザー確認済み）。
- 既知のトレードオフ: 排他的全画面で解像度を下げて表示（レターボックス）すると、窓の矩形がモニタ全体を覆わず、全画面として検出できないことがある。

## フェーズ 3 のレビュー指摘への対応状況

Sonnet 5.5 のレビュー（aa2935dc5a56d7e8e）の指摘への対応。

| ID | 内容 | 状態 |
|----|------|------|
| I-4 | サブモニタの全画面でメインのオーバーレイが隠れる | 対応済み（上記の決定どおり） |
| I-1 | `run()` の後始末（フック解除・タイマー解除・窓の破棄） | 対応済み（`run()` を try/finally、`_teardown()` を追加） |
| I-3 | tray の更新で例外が出るとポーリングスレッドが止まる | 対応済み（`tray/tray.py` の `refresh_once` で受け、`log_error` へ） |
| I-5 | 例外の握りつぶし・ログの肥大化 | 対応済み（`log_error`: 同じ内容は連続で書かない。1 MB を超えたら書き直し） |
| M-1 | `self.cells` を複数回読んでいる | 対応済み（`_paint` の冒頭で一度だけ読む） |
| M-2 | `_paint` の後始末が無条件（GDI ハンドルが NULL でも解放を呼ぶ） | 対応済み（確保できたものだけ解放） |
| M-3 | 文字の描画フラグ（省略記号・プレフィックス） | 対応済み（`DT_NOPREFIX \| DT_END_ELLIPSIS` を追加） |
| M-4 | 角丸の aliasing による縁の色にじみ | 対応しない（スーパーサンプリングが必要で、描画方式の変更になるため） |
| M-5 | `_refresh` の例外経路 | 対応済み（例外時は窓を破棄し、次回に作り直す） |
| M-6 | `ABM_GETSTATE` が同期呼び出し | 対応しない（軽い呼び出しのため。変更予定なし） |
| M-7 | プロキシ経由で `127.0.0.1` へ接続してしまう | 対応済み（`ProxyHandler({})` の opener を使う） |
| M-8 | `web/app.js` の「5 秒ごと」の文言がハードコード | 未対応（任意。Phase 2 側の対応） |
| M-9 | `eslint.config.mjs` で `web/**/*.js` に Node のグローバルを指定 | 未対応（Phase 2 側の対応） |

### 完了した作業と検証結果

1. `tray/overlay.py` の `_paint` を書き換えた（M-1・M-2・M-3）。
2. `tray/tray.py` に `refresh_once`（I-3）、`status_from_json`、`_OPENER`（M-7）を入れた。
3. テストを更新した: `OverlayVisibleTest` を 2 引数に直し、QUNS を削除。`LogErrorTest` と `tray/test_tray.py` の `StatusFromJsonTest` / `RefreshOnceTest` を追加。
4. 検証: `.venv\Scripts\python.exe -m unittest test_overlay test_tray` は 31 件すべて OK。`npx eslint .` は出力なし（問題なし）。tray を再起動し、`/api/health` が 200。

### 次にやること

- 実機で `_paint` の描画結果（pill の見た目）を確認する。
- Sonnet による最終レビュー（`claude-sonnet-5-5` を明示して dispatch）。

### 実機確認の結果・未確認の項目

- 確認済み（ユーザー目視, 2026-10-31）: 全画面に入った時と抜けた時の追従は速い（300 ms 再判定で即時になった）
- 確認済み: サブモニタを全画面にしてもメインのオーバーレイは隠れない（許容）
- 確認済み: pill の見た目に問題なし
- 確認済み: 「終了」でアイコンとオーバーレイが消える
- 確認済み: 自動非表示の切り替えで隠れる・戻る
- 確認済み: トレイのクリックで WebUI が開く（フェーズ 3 の検証欄の 2 項目目）

フェーズ 3 の実機確認は、これで全項目が済んでいます。

### 変更していない・未コミットの状態（2026-10-31 時点）

- 未コミット: `.claude/settings.json`（ユーザー承認済み。PostToolUse フックの cwd 修正）、`tray/overlay.py`、`tray/tray.py`、`tray/test_overlay.py`、`tray/test_tray.py`。
- コミットは、ユーザーが頼んだ時だけ行う。
- ブランチ: `feature/webui`。`main` へのマージはユーザーの確認待ち。

### 未決事項

- フェーズ 1 の完了条件（81〜84 行）と Tasks 1〜7（28〜78 行）は、チェックを付けていない。ユーザーの確認後に付ける。Sonnet レビュー（83 行）は 834fd66 で実施済み。
- フェーズ 2 の任意項目（`/api/summary`、日付選択、90 行）は未着手。やるかどうかはユーザーが決める。
- Plugin の利用状況（どれを使っていないか）の確認は未完了。
- 排他的全画面の検出（上記のトレードオフ）を、このまま受け入れるかどうかはユーザーの判断。

## リスクと対応

| リスク | 対応 |
|--------|------|
| koffi の prebuild が合わない | Task 1 で早期に確認。ダメなら PowerShell 常駐子プロセス経由に切り替える |
| 10 万トークンを超える | フェーズ単位でコミットし、計画の進捗チェックを更新して区切る |
| PostToolUse の `npx prettier --write . && npx eslint .` が毎回全体を走る | 遅くなったら対象ファイルだけに絞る（`.claude/settings.json` の変更はユーザー確認後） |
| Serena MCP が接続失敗、Context7 が未認可 | 本計画では必須でない。使えなくても進める |
