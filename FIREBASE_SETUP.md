# ぽちょ v0.3.1 Firebase セットアップ

1. Firebase Console で Web アプリを作成し、`firebase-config.js` の `YOUR_...` を実際の設定値に置換します。
2. Authentication > Sign-in method で **Anonymous** と **Google** を有効にします。
3. Firestore Database を作成します。
4. `firestore.rules` を Firestore Rules に反映します。
5. `firestore.indexes.json` の複合インデックスを作成します（Firebase CLI を使う場合は deploy 可能です）。
6. GitHub Pages / Netlify の公開ドメインを Authentication > Settings > Authorized domains に追加します。

## データ構造
- `users/{uid}`: 非公開の全セーブデータ（本人のみ読み書き）
- `profiles/{uid}`: 公開用の「ぽちょ身分証」
- `leaderboardEntries/{boardId}__{uid}`: ランキング自己ベスト1件

ランキングは各期間・各モードについてプレイヤーごとの最大記録だけを保存します。同点は `achievedAt` が早い方を上位にします。

## 注意
現在の実装はクライアントからスコアを送る方式です。Firestore Rules で「本人のエントリのみ更新」は制限していますが、ブラウザ改造による偽スコアを完全には防げません。本公開でランキングの信頼性を重視する場合は、Firebase App Check と Cloud Functions / サーバー側のプレイ検証を追加してください。

## 古いランキングの自動削除
Firestore の TTL 機能で `leaderboardEntries` コレクショングループの `expiresAt` フィールドを TTL 対象に設定してください。日間は約8日、月間は約100日、週替わりは約60日後に削除対象になります。歴代ランキングには `expiresAt` を設定しません。
