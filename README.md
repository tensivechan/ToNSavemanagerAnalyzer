# ToNSaveManager Analyzer

ToNSaveManager の JSON を読み込み、解析結果を一覧表示する Windows 向けデスクトップアプリです。

## できること

- 複数 JSON ファイルの同時読み込み
- `RoundType`、`TerrorID`、`Terror Name`、`Player Count`、`MapID`、`Map Name` の表示
- `RoundType` による絞り込み
- `元データのまま`、`TerrorID順`、`MapID順` のソート
- `(blank)` データの非表示
- ルールに応じた色分け表示
- `EX` / `LVL2` の分類
- `Content` / `Result` の非表示

## 起動

```bash
pnpm start
```

## 配布用ビルド

インストーラーとポータブル版を作る場合:

```bash
pnpm dist
pnpm dist:portable
```

## リリース

GitHub Releases に公開する流れです。

1. `package.json` の `version` を更新する
2. 変更を commit する
3. `v1.0.1` のようなタグを付けて push する
4. GitHub Actions の `release` ワークフローが実行されるのを確認する
5. 成功したら GitHub Releases に配布物が出る

`release.yml` は `v*` タグの push で動きます。

## 主なファイル

- [`electron-main.js`](./electron-main.js)
- [`electron-builder.config.js`](./electron-builder.config.js)
- [`.github/workflows/release.yml`](./.github/workflows/release.yml)

## Git に入れないもの

生成物は Git 管理しません。

- `dist/`
- `node_modules/`
- `outputs/*.exe`
- `outputs/*.zip`
- `outputs/*-win-unpacked/`
- `outputs/*.blockmap`

実体として残すのは `outputs/ton-save-analyzer.html` だけです。
