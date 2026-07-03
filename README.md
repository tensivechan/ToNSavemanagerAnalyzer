# ToNSaveManager Analyzer

ToNSaveManager の JSON 保存データを読み込んで、内容を見やすく解析する Windows 向けデスクトップアプリです。

## できること

- 複数 JSON ファイルの同時読み込み
- `TerrorID`, `RoundType`, `MapID`, `Map Name` の表示
- `RoundType` での絞り込み
- `元データのまま / テラーID順 / mapid順` の並び替え
- 不要な `(blank)` 行の非表示
- CSV / JSON エクスポート
- 配布用 exe と zip の作成
- GitHub Releases を使った自動更新

## 起動

```bash
pnpm start
```

## 配布ビルド

### インストーラー

```bash
pnpm dist
```

### ポータブル exe

```bash
pnpm dist:portable
```

## アップデート配信

このアプリは `electron-updater` を使って GitHub Releases から更新を確認します。

必要なもの:

- GitHub リポジトリ
- `package.json` の `version` 更新
- `v1.0.0` のようなタグでのリリース
- GitHub Actions でのビルド・公開

設定ファイル:

- [`electron-main.js`](./electron-main.js)
- [`electron-builder.config.js`](./electron-builder.config.js)
- [`.github/workflows/release.yml`](./.github/workflows/release.yml)

## 配布物

ビルド成果物は `outputs/` に置いています。

