# 徳原家 家計管理アプリ

徳原家で使用している家計管理Webアプリの本番リポジトリです。  
GitHub Pagesで公開し、Firebase Authentication / Realtime Database と Cloudflare Worker を利用しています。

## 本番環境

- 公開先: https://tdragon-nogardt.github.io/tokuhara-kakeibo/
- デプロイ: GitHub Pages（`main` ブランチ）
- アプリ本体: `index.html`
- Service Worker: `sw.js`

## リポジトリ内の主なファイル

| ファイル | 役割 |
|---|---|
| `index.html` | 家計管理アプリ本体 |
| `sw.js` | アプリシェルのキャッシュとオフライン起動補助 |
| `CHANGELOG.md` | 主要な変更履歴 |
| `.gitignore` | 秘密情報・依存関係・バックアップ等の誤コミット防止 |

## 更新時の重要ルール

### 1. `index.html` と `sw.js` のバージョンを必ず同期する

`index.html` 側のアプリバージョンを更新した場合は、`sw.js` の `CACHE_VERSION` も同じバージョンに更新します。

片方だけ更新すると、Service Workerのキャッシュにより古い画面が表示される原因になります。

### 2. 秘密情報をGitへ保存しない

次のような情報は、この公開リポジトリへコミットしません。

- Anthropic APIキー
- Cloudflare WorkerのSecret
- Firebaseの認証情報・秘密鍵
- Realtime Databaseの本番エクスポート
- `.env` 等のローカル環境ファイル

Cloudflare WorkerのSecretは `wrangler secret put` で管理します。

### 3. 本番データの保護

家計データはFirebase Realtime Databaseに保存し、Firebase AuthenticationとDatabase Rulesでアクセスを制限しています。

このリポジトリには、本番の家計データそのものを保存しません。

## デプロイ後の確認

更新後は最低限、次を確認します。

1. アプリが正常に起動する
2. ログインできる
3. 家計データが正常に表示される
4. 保存・更新が正常に反映される
5. AI機能を変更した場合は、カテゴリ提案等が正常に動作する
6. Service Worker更新後は最新版が表示される

## 開発上の注意

現行版は、ビルド元のReactソース一式から再生成する構成ではなく、**ビルド済みの `index.html` を直接改修する運用**です。

大きな変更の前にはバックアップまたはGitチェックポイントを作成し、構文確認・機能確認を行ってから本番へ反映します。

## 変更履歴

詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。
