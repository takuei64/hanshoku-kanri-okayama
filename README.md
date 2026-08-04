# 岡山農場 繁殖管理

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
