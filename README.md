# 徳原家 家計管理アプリ

徳原家で使用している家計管理Webアプリの本番リポジトリです。  
GitHub Pagesで公開し、Firebase Authentication / Realtime Database、Firebase App Check、Cloudflare Worker を利用しています。

## 現在の安定版

- アプリバージョン: `v2026.09.27.0012`
- 公開先: https://tdragon-nogardt.github.io/tokuhara-kakeibo/
- デプロイ: GitHub Pages（`main` ブランチ）
- アプリ本体: `index.html`
- 財務計算コア: `finance-core.mjs`
- Service Worker: `sw.js`

## 現在の構成

```text
tokuhara-kakeibo/
├─ index.html
├─ finance-core.mjs
├─ sw.js
├─ CHANGELOG.md
├─ README.md
├─ SUPPLY_CHAIN_AUDIT.md
├─ security/
│  └─ check-supply-chain.mjs
└─ .github/
   └─ workflows/
      └─ supply-chain-check.yml
```

### 主なファイル

| ファイル | 役割 |
|---|---|
| `index.html` | 家計管理アプリ本体。UI、Firebase連携、AI機能等を含む |
| `finance-core.mjs` | 共同口座精算・個人間立替精算等の財務計算ロジック |
| `sw.js` | アプリシェルのキャッシュとオフライン起動補助 |
| `security/check-supply-chain.mjs` | CSP・外部スクリプト・Firebase CDN等の自動検査 |
| `.github/workflows/supply-chain-check.yml` | push / pull request 時にSupply Chain Checkを実行 |
| `SUPPLY_CHAIN_AUDIT.md` | Supply Chain Security監査結果・運用方針 |
| `CHANGELOG.md` | 主要な変更履歴 |
| `.gitignore` | 秘密情報・依存関係・バックアップ等の誤コミット防止 |

## 財務計算の扱い

`v2026.09.27.0012` から、従来 `index.html` 内に埋め込まれていた主要な財務計算を `finance-core.mjs` へ分離しています。

Finance Coreには、特に次のロジックを集約しています。

- 8% / 10%税計算と品目単位の端数処理
- `rawAmt` による二重課税防止
- 半々 / とっくん全額 / さえさん全額 / 個別分担
- 共同費の収入処理
- 共同口座精算
- 個人間立替精算
- 貯蓄口座払い・その場で精算済みの除外
- 固定費・毎月の個人費のスナップショットを使った月次集計

財務計算を変更する場合は、画面上の見た目だけで判断せず、既存仕様・Golden Test・実データ比較で差額0円を確認してから本番へ反映します。

## セキュリティ

現在、主に次の対策を導入しています。

- Firebase Authentication
- Realtime Database Rules
- Firebase App Check + reCAPTCHA Enterprise
- Realtime DatabaseでApp Checkを強制適用
- Cloudflare WorkerでFirebase ID Token / App Check Tokenを検証
- Anthropic APIキーをCloudflare Worker側のSecretとして管理
- UID単位のAIレート制限
- Origin / CORS制限
- CSP（Content Security Policy）
  - `unsafe-inline` 不使用
  - `unsafe-eval` 不使用
  - インラインスクリプトをSHA-256ハッシュで許可
- GitHub Secret Protection / Push Protection
- Supply Chain Checkの自動実行
- CSV Formula Injection対策
- ローカルキャッシュのUID分離・ログアウト時削除

## Supply Chain Check

`main` へのpushおよびPull Request時にGitHub Actionsで自動実行します。

主な確認内容:

- CSPに `unsafe-inline` / `unsafe-eval` が混入していない
- インラインスクリプトのSHA-256とCSPが一致する
- 未承認の外部JavaScript配信元が追加されていない
- Firebase CDNの固定バージョンが意図せず変更されていない
- 予期しない外部moduleが追加されていない

GitHub Actionsで `Supply Chain Check` が緑の✓になっていることを確認します。

## 更新時の重要ルール

### 1. `index.html` と `sw.js` のバージョンを同期する

`index.html` 側のアプリバージョンを更新した場合は、`sw.js` の `CACHE_VERSION` も対応するバージョンへ更新します。

片方だけ更新すると、Service Workerのキャッシュにより古い画面が表示される原因になります。

### 2. Finance Core変更時は互換性を検証する

`finance-core.mjs` を変更する場合は、少なくとも以下を確認します。

1. 財務計算の自動テストがすべて合格
2. Golden Testで旧計算結果と一致
3. 実バックアップデータによる月次比較で差額0円
4. 共同口座精算と個人間立替精算の二重計上がない
5. 本番反映後に主要金額が変更前と一致

### 3. 秘密情報をGitへ保存しない

次のような情報は、この公開リポジトリへコミットしません。

- Anthropic APIキー
- Cloudflare WorkerのSecret
- Firebaseの秘密鍵
- Realtime Databaseの本番エクスポート
- 家計バックアップJSON
- `.env` 等のローカル環境ファイル

Cloudflare WorkerのSecretは `wrangler secret put` で管理します。

### 4. 本番データの保護

家計データはFirebase Realtime Databaseに保存し、Firebase Authentication / Database Rules / App Checkでアクセスを制限しています。

このリポジトリには、本番の家計データそのものを保存しません。

## デプロイ後の確認

本番更新後は最低限、次を確認します。

1. アプリが正常に起動する
2. 正しいアプリバージョンが表示される
3. ログインできる
4. 家計データが正常に表示される
5. 月切替が正常
6. 共同費・個人費の保存・更新が正常
7. レポートが正常
8. AIカテゴリ提案等が正常
9. バックアップJSONを保存できる
10. ログアウト → 再ログイン後も正常
11. GitHub ActionsのSupply Chain Checkが成功
12. Finance Core変更時は主要財務金額が変更前と一致

## 開発上の注意

現行版は、アプリ全体を元のReactソース一式から完全再生成できる状態にはまだ戻っていません。

一方で、`v2026.09.27.0011` を基準にビルド済みHTMLを分解・再結合してバイト単位で再現する基準環境を作成し、その後、財務計算部分を `finance-core.mjs` として可読なモジュールへ分離しました。

今後は巨大なビルド済みバンドルを一度に書き直さず、テストを追加しながら機能単位で可読なソースへ段階的に移行します。

大きな変更の前にはGitチェックポイントまたはバックアップを確保し、構文確認・自動テスト・実機確認を行ってから本番へ反映します。

## 変更履歴

詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。
