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

- [x] `tray/tray.py`（pystray + Pillow）。`/api/status` を 5 秒おきに取得し、ツールチップを更新
- [x] メニュー: 「WebUI を開く」「終了」。tracker 未接続なら「未接続」と表示
- [x] `tray/requirements.txt`（pystray, Pillow のバージョン固定）
- [ ] 検証: 実機で `pythonw tray/tray.py` を起動し、タスクバーに出ること（ユーザー目視待ち）

## フェーズ 4: 常駐化と旧版の整理

- [ ] `scripts/register-tasks.ps1`: tracker と tray を「ログオン時」に登録する（登録・削除の両方）
- [ ] 新旧の CSV が一致することを 1 日分で確認したら、`AppTimeTracker.ps1` を削除するかユーザーに確認する（削除は破壊的なので、ユーザーの了承を得てから）

## リスクと対応

| リスク | 対応 |
|--------|------|
| koffi の prebuild が合わない | Task 1 で早期に確認。ダメなら PowerShell 常駐子プロセス経由に切り替える |
| 10 万トークンを超える | フェーズ単位でコミットし、計画の進捗チェックを更新して区切る |
| PostToolUse の `npx prettier --write . && npx eslint .` が毎回全体を走る | 遅くなったら対象ファイルだけに絞る（`.claude/settings.json` の変更はユーザー確認後） |
| Serena MCP が接続失敗、Context7 が未認可 | 本計画では必須でない。使えなくても進める |
