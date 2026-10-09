# 岡山農場 繁殖管理

オフライン・自動同期の修正内容、検証範囲、Apps Script先行反映手順は[修正・検証報告](docs/offline-autosync-report.md)を参照してください。

吉備養豚合同会社の岡山農場向け繁殖管理PWAです。初回オンライン同期後は、圏外からの起動、閲覧、記録、削除、再起動後の未送信保持、通信復旧時の自動同期に対応します。

## 環境

- PWA: `https://takuei64.github.io/hanshoku-kanri-okayama/`
- Google Sheets: `1xFA8Xv8dZy-s1pSYlA7YjTsucGKxKTmF-hq1wEqWWzM`
- Apps Script: `1RX4fj78uIwib4kOGezPSVSj0PsAu3O84AQIyPizHNNVAcyT9VZVihLYd`
- 固定デプロイID: `AKfycbzEhyJyyDuSIlMo3Yek5MBVKWbkZ8ic6kKrZ5z3wNaAp1PxU9FLZYqihU4Z_IdFUFGh`

パスワードはリポジトリへ保存せず、Apps ScriptのScript Propertiesにある `BREEDING_APP_PASSWORD` で管理します。

## データ

- 繁殖舎PEN: `1`～`58`
- 分娩舎PEN: `1001`～`1011`
- 参照元の分娩舎PENは、元番号へ1000を加えて移行しています。

## 更新

静的ファイルはGitHub Pages、サーバー処理は同じApps ScriptデプロイIDの新バージョンへ反映します。協和資糧版のリポジトリ、スプレッドシート、Apps Script、デプロイは更新しません。

## 繁殖経過の表示

繁殖チェックと妊娠鑑定の各カードに、直近の分娩・離乳以降の種付回数、再発歴、空胎歴、日付付きの経過を表示します。「再発チェック」は検査対象の区分であり、再発の確定記録とは区別します。

過去データに追い種付の区別がないため、種付初日から3日以内を同じ回として集計し、回数は「目安」と表示します。再種付の理由や導入前の経歴は推測しません。未同期の変更がある場合はその旨を表示し、同期後に履歴を更新します。

Apps Script の `api_reproductive_history.js` が一覧データへ履歴を付与します。公開画面と Apps Script 側の画面に同じ表示を反映しています。両農場を同じブラウザで使う場合も、更新時のキャッシュ削除は各アプリ内に限定します。

ローカルの Apps Script ソースを用意して検証します。

```bash
node --test test/reproductive-history.test.cjs
```
