# 徳原家家計管理アプリ — Supply Chain Security監査

監査日: 2026-09-27  
基準版: v2026.09.27.0011

## 結論

現行版の外部実行コード依存はGoogle/Firebase系に限定され、CSPでも実行元が制限されています。
一方、Firebase App Check CDNは `10.14.1` に固定されており、現行Firebase JS SDKの最新版より古い状態です。

現時点では、安定稼働している単一HTMLバンドルへ直接メジャーアップグレードを当てるより、
まず供給網の意図しない変更を自動検出するガードを導入し、その後に再現可能なビルド環境を整えて
Firebase/React等を計画的に更新する方針を採用します。

## 現行依存の確認結果

### 外部から実行時に取得するコード

- Firebase App: `https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js`
- Firebase App Check: `https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js`
- reCAPTCHA Enterprise: Google/Firebase SDKにより動的取得
- Firebase Authentication関連: 必要に応じてGoogle系配信元を使用

### HTMLへバンドル済みの主な依存

- React: `18.3.1`
- React DOM
- React Is
- Recharts
- Firebase Authentication / Realtime Database関連コード

バンドル済みコードは、アプリ利用時に第三者CDNから都度取得する構成ではありません。

## 現在の防御

- CSP `script-src` を設定
- `unsafe-inline` 不使用
- `unsafe-eval` 不使用
- インラインスクリプトをSHA-256で許可
- 外部スクリプト配信元をGoogle系に限定
- Firebase CDN URLをバージョン固定
- GitHub Secret Protection / Push Protection
- mainブランチのforce push・削除を制限

## 残課題

1. Firebase 10.14.1は2024年の版であり、計画的な更新対象。
2. 現行アプリは単一HTMLの巨大バンドルで、元ソースから同一成果物を再生成する手順が未整備。
3. アプリ本体の依存関係を表す `package.json` / lockfile がGitHub上にないため、
   Dependabot等で完全な依存監視ができない。
4. reCAPTCHA Enterpriseはサービス特性上、配信スクリプトを固定ハッシュ化する運用には向かない。
   CSP・App Check・ドメイン制限を主要防御とする。

## 今回追加するガード

`security/check-supply-chain.mjs` が以下を自動確認します。

- CSPに `unsafe-inline` / `unsafe-eval` が混入していない
- インラインスクリプトのSHA-256がCSPと一致する
- 外部 `<script src>` が許可済みGoogle系以外へ増えていない
- 動的Firebase importが `10.14.1` から勝手に変更されていない
- Firebase App / App Check以外の予期しないFirebase CDN moduleが追加されていない

GitHub Actionsでもpush / pull requestごとに実行します。

## Firebase更新方針

Firebaseのメジャーアップグレードは、次の条件を満たしてから行います。

1. 現行v0011を復元可能な状態で保持
2. ソースとビルド手順を再構築
3. lockfileを作成
4. 別ブランチでSDK更新
5. Authentication / Realtime Database / App Check / AI proxyを一式テスト
6. 本番反映後にApp Checkメトリクスを再確認

単一HTMLへの文字列置換だけでSDKを更新しないこと。
