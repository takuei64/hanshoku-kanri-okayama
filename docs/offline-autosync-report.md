# オフライン起動・自動同期の再調査と修正

調査日: 2026-10-09（日本時間）。取得した最新main: `e7a05b4a44260cc189641c6163df30f1b8f5ba68`。修正ブランチ: `fix/offline-autosync`。

本番母豚へのテスト登録、スプレッドシートの削除、端末キューの一括削除、認証情報の初期化は行っていない。パスワード値を取得・記録していない。以下の検証は合成データとローカル模擬APIで行った。

## 確認した原因と修正

| 症状 | 最新mainで確認した原因 | 修正と主なコード位置 |
|---|---|---|
| 弱電波時にログインが前面に出る | `navigator.onLine`とトークン有無を優先し、保存済みデータがあっても全面ログインを表示。JSONPタイムアウトは22秒 | `pwa-runtime.js`の`PwaNetwork`、`PwaAuth.showLogin`、`PwaShell.init`。保存済み画面は即時表示。3.5秒の実ping。認証切れは画面を塞がない案内。明示ログインにも「オフラインで続ける」 |
| 繁殖上部の移動が見えない | キュー追加だけでローカル更新なし | `js_breeding.js`の`submitMove`と`js_sow.js`の`SowLocation.applyMovementLocal` |
| 現在地・分娩・離乳で表示が食い違う | 各経路が自身の一覧だけ更新。移動日・関連一覧・移動先作業Penの更新不足 | `js_sow.js`、`js_farrowing.js`、`js_weaning.js`、`js_pentask.js`。共通更新でPen・エリア・最新移動日・一覧・作業対象を統一 |
| 再表示しても送信されない | `focus/pageshow`未対応、表示復帰では再送待機を解除しない。認証待ちが独立していない | `js_offline.js`の`init`、`retryPendingNow`、`process`。起動・online・pageshow・focus・表示復帰・ログイン後に再試行。恒久エラーは自動解除しない |
| 閉画面中に送信されない | Service Workerにsyncハンドラーもキュー参照手段もない | `sync-store.js`、`sw.js`。IndexedDBへ複製しBackground Syncで順次送信。非対応時は起動・復帰時に処理 |
| 複数画面で入力を上書きする | キュー全体をlocalStorageへ上書き。古い応答や古い画面の保存も無条件 | `js_offline.js`の操作別保存・完了印・`mutationRevision`、`js_app.js`と`js_snapshot.js`の差分統合・復元。保存成功前には画面を変更しない |
| 対象のない削除を勝手に消す | 存在しない種付削除を成功とみなし、起動時にも失敗キューを削除 | 自動破棄を廃止。「要確認」で内容・理由・個別再送・確認付き個別破棄を表示 |
| 重複防止が限定的 | UserLock、履歴の直近5000件だけ検索、古い履歴削除、業務書込み後の履歴保存失敗を握りつぶす | `apps-script-project/offline_sync.js`。ScriptLock、全履歴の完全一致検索、操作内容の照合、書込み前の永続受付、完了結果の再利用 |
| 公開後も旧コード | v5のcache-firstだけで更新検出・通知不足 | `sw.js`のv6、`index.html`の`updateViaCache: none`、実行時の更新チェック・通知。全シェルをまとめて取得し、別農場のキャッシュは残す |
| 未閲覧個体の修正を圏外で開けない | 個体履歴は個別画面を開いたときだけ取得 | `api_sow.js`の一括カード構築を初回データへ追加。5シートを各1回読込。カードは別キャッシュに保存 |

`js_*`の変更はApps Script側の対応するHTMLにも反映。新しい`js_snapshot`も両側から読み込む。Apps ScriptのURLそのものはGoogleのサーバー描画を要するため、圏外からの新規起動にはGitHub PagesのPWAを使用する。

## 保存・同期の動作

1. 操作IDと入力値を端末へ保存する。失敗したら入力欄を残し、成功表示しない。
2. 保存成功後に画面を更新し、一覧の差分も操作へ保存する。古い画面と差分を統合し、再起動時には未適用分を復元する。
3. 実通信を確認して順番に送信する。通信待ちは再試行、認証待ちは再ログイン後に同じIDで再開、恒久エラーは要確認として保持する。
4. 成功した操作だけを完了扱いにし、全件処理後に最新一覧を取得する。最新一覧取得前は「一覧更新待ち」、取得後に「同期済」。
5. Background Syncの完了・失敗も画面側へ取り込む。古い画面や遅い通信結果が、完了済み操作や要確認状態を復活・上書きさせない。

## 自動検証

実行方法（Node.jsとnpmが利用可能な環境）:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:pwa
```

Playwrightは`tests/serve.cjs`を自動起動する。テスト時の接続先設定は必ずローカルAPIへ置換する。Service Workerがページ側のモックを経由しない場合も本番APIへ到達しない。

| 依頼された確認 | 実施内容・結果 |
|---|---|
| 完全オフライン起動 | 実Chromiumのoffline状態、Service Worker再読込、保存済み画面、全タブを確認 |
| BT | 登録・削除・未送信保持・再起動後の復元。保存不可時に画面を変更しないことも確認 |
| 4経路の移動 | 繁殖上部・現在地Pen・分娩舎移動・離乳同時移動。Pen/エリア/日付/作業対象の即時反映と再起動を確認 |
| その他の入力 | 種付・状態変更・妊鑑・空胎・分娩・離乳・事故・作業・取消・削除・履歴修正の保存失敗時保持を検証。主要入力・取消・編集は保存成功時のローカル更新も検証 |
| 起動・復帰自動同期 | 起動、online、pageshow、focus、visibilitychangeそれぞれで長い待機を解除し、手動クリックなしで全件送信・最新取得・同期済 |
| 認証切れ | キューと操作IDを維持し、新しい模擬トークンでログイン後に自動再開 |
| 見かけ上オンライン | navigatorがtrueのまま通信中断・無応答を再現。ログインで保存済み画面を塞がない |
| 重複登録 | 応答消失、タイムアウト、再起動、複数ユーザー/タブ/SW、5000件超の後の再送。同じIDによる業務書込みは1回 |
| Background Sync | 実Chromium、実IndexedDB、開いているページ0件でSW処理による送信・完了保存。ただしハンドラーの起動はテストから行い、AndroidのOS発火を検証したものではない |
| 複数画面・遅延 | 同時入力、完了後に届く古い一覧/個体応答、古い画面のpagehide、同じBT値2件、保存差分の再適用を検証 |
| 保存障害 | 端末保存拒否、壊れた旧キュー、一覧保存だけの失敗と差分復元、送信履歴書込み失敗を検証 |
| SW更新 | v6の必要資材を取得、岡山アプリの旧キャッシュだけ削除、他農場キャッシュ・キュー・スナップショット・認証を保持 |

最終実行: Node自動テスト72件成功、実Chromium統合テスト29件成功。JavaScript構文確認30ファイル、両側の画面実装一致、差分の空白検査も成功。Git commit SHAとPR URLは納品報告書に記載する。

## 重複防止の範囲と未解決事項

- Sheetsには複数シートをまとめるトランザクションがない。業務書込み開始後に停止した場合は、同じ操作IDを再実行せず「要確認」を保持する。管理者が実データと履歴を照合する必要がある。「再送」を押すだけでは結果不明の書込みを重複実行しない。
- 書込み前の入力不正・マスタ不足は、原因修正後に同じIDで明示再送できる。
- 過去の版がすでに削除した同期履歴は復元できない。保持されている旧履歴と本修正後の操作履歴について重複防止を検証した。
- Background SyncのOSによる起動、電池制限、完全終了後の実動作、実際の電波断・DNS障害・ルーター外部回線断はAndroid実機で未確認。ブラウザ試験はこれらの通信失敗相当を模擬したもの。
- 実運用スプレッドシートへの認証付き登録・反映は行っていない。Apps Scriptの新しいデプロイと、その環境でのJSONリダイレクト/CORSをまだ確認していない。
- 端末の空き容量が不足して入力値の保存にも失敗した場合は、保存成功とは扱わず入力を保持する。入力値は保存できたが一覧の保存ができない場合は、一覧保存不可を表示する。

## Apps Scriptを先に反映する手順

1. このブランチを取得し、現在のApps Scriptのソース・デプロイ番号を別の場所へ控える。リポジトリ外の編集があれば比較して統合する。
2. `apps-script-project/.clasp.json`の対象が岡山版のスクリプトIDであることを確認する。別農場へ反映しない。
3. 所有者の環境で`clasp login`後、`apps-script-project`を作業フォルダーとして`clasp push`を実行する。全サーバーJS、対応HTML、新しい`js_snapshot.html`を含める。パスワード設定をコードへ移さない。
4. Apps Scriptエディターの「デプロイ」→「デプロイを管理」で、現在の固定デプロイを編集し、「新バージョン」を選択する。実行者・公開範囲・固定URLを維持し、古いデプロイを削除しない。
5. リポジトリルートで`node scripts/check-deployment.cjs --backend-only`を実行する。認証なしで`protocolVersion: 2`、到達可能、認証要求が返ることを確認する。この確認はデータを書き込まない。
6. 次にPRをmainへマージしてPagesの反映を待つ。`node scripts/check-deployment.cjs`でAPIと公開v6を確認する。
7. 現場端末をオンラインで開き、「アプリ更新」の通知から反映する。未送信件数と既存入力が保持されていることを確認する。ストレージの消去・アプリデータ初期化は行わない。
8. 次項の実機試験を行い、デプロイ番号、端末/OS/ブラウザの版、試験日時、送信件数、スプレッドシート反映を記録する。本番母豚を試験対象にせず、承認された検証用環境を使う。

この作業環境にはApps Scriptのデプロイ用CLI認証がなく、新バージョンをデプロイしていない。公開APIの読取専用確認では新JSON pingは確認できず、別試行ではタイムアウトした。新デプロイ反映済みとは報告しない。

公式手順: [clasp](https://developers.google.com/apps-script/guides/clasp)、[既存デプロイの更新](https://developers.google.com/apps-script/concepts/deployments)、[Content Serviceのリダイレクト](https://developers.google.com/apps-script/guides/content)。

## Android実機で追加する試験

- オンラインで新しい初回準備→ホーム画面へインストール→完全終了→機内モード起動。全タブが開くこと。
- BTと4経路の移動、その他必要な入力を行い、終了・再起動後も画面と通信待ち件数が保持されること。
- アプリ表示中の通信復帰、バックグラウンド中の通信復帰→再表示、完全終了後のオンライン起動で、左上に触れず全件同期されること。
- トークン期限切れ中も入力でき、再ログイン後に同じ操作IDで同期されること。
- Wi-Fi外部回線断、DNS失敗、弱電波、Apps Scriptのみ到達不能を個別確認すること。
- Background Sync対応端末では、ページが閉じた状態でOSが同期を実行するかを確認すること。非対応またはOSが実行しない場合も次回起動で送信されること。
- 2画面同時使用、応答消失後の再送、更新通知からの切替で、送信件数とシート行数に重複がないこと。

## 差分と変更ファイル

PRのFiles changedが変更前後の差分。納品パッチは調査開始時のmainへ適用できる。完全なファイル一覧は納品報告書にも記載する。

変更・追加ファイル（53件）:

- `.gitignore`
- `README.md`
- `apps-script-project/api_breeding.js`
- `apps-script-project/api_pentask.js`
- `apps-script-project/api_sow.js`
- `apps-script-project/auth.js`
- `apps-script-project/index.html`
- `apps-script-project/js_app.html`
- `apps-script-project/js_breeding.html`
- `apps-script-project/js_farrowing.html`
- `apps-script-project/js_offline.html`
- `apps-script-project/js_pentask.html`
- `apps-script-project/js_postmating.html`
- `apps-script-project/js_pregcheck.html`
- `apps-script-project/js_reheatcheck.html`
- `apps-script-project/js_snapshot.html`
- `apps-script-project/js_sow.html`
- `apps-script-project/js_weaning.html`
- `apps-script-project/offline_sync.js`
- `apps-script-project/webapp.js`
- `docs/offline-autosync-report.md`
- `index.html`
- `js_app.js`
- `js_breeding.js`
- `js_farrowing.js`
- `js_offline.js`
- `js_pentask.js`
- `js_postmating.js`
- `js_pregcheck.js`
- `js_reheatcheck.js`
- `js_snapshot.js`
- `js_sow.js`
- `js_weaning.js`
- `package.json`
- `playwright.config.js`
- `pwa-config.js`
- `pwa-hooks.js`
- `pwa-runtime.js`
- `pwa.css`
- `scripts/check-deployment.cjs`
- `sw.js`
- `sync-store.js`
- `test/reproductive-history.test.cjs`
- `tests/backend-sync.test.js`
- `tests/backend-update.test.js`
- `tests/offline-inputs.test.js`
- `tests/offline-queue.test.js`
- `tests/pwa-offline.spec.js`
- `tests/pwa-runtime.spec.js`
- `tests/pwa-runtime.test.js`
- `tests/pwa-snapshot.spec.js`
- `tests/serve.cjs`
- `tests/snapshot-patch.test.js`
