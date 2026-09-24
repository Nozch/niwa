# 庭 Niwa

Astro 5で構築した静的なデジタルガーデンです。記事はMDX、記事内の視覚化データは独立したJSON collectionで管理します。

## 開発

Node.js 20.11以上とpnpm 11を使用します。

```sh
pnpm install
pnpm dev
```

`astro dev`ではdraftも表示します。Pagefind検索は静的成果物を索引化するため、次の手順で確認します。

```sh
SITE_URL=https://example.com pnpm build
pnpm preview
```

## デプロイ

Cloudflare Pages にGitHubリポジトリを接続し、`main`へのpushで自動デプロイします。ダッシュボードでの設定は次の通りです。

| 項目 | 値 |
| --- | --- |
| プロダクションブランチ | `main` |
| フレームワークプリセット | **なし** |
| ビルドコマンド | `pnpm run build` |
| ビルド出力ディレクトリ | `dist` |
| 環境変数 | `SITE_URL` = `https://<プロジェクト名>.pages.dev`（スキーム必須・末尾スラッシュなし） |

フレームワークプリセットで Astro を選ぶとビルドコマンドが上書きされ、Pagefindの索引生成が落ちます。**必ず「なし」**にしてください。

Node.jsのバージョンは`.nvmrc`、pnpmのバージョンは`package.json`の`packageManager`からCloudflareが読み取るため、環境変数での指定は不要です。

`SITE_URL`が未設定、または`https://`が無いと`astro.config.ts`がビルドを失敗させます。プレビュー環境のビルドを使う場合は、そちらにも同じ値を設定してください。

Cloudflare Pages はリポジトリ内の wrangler 設定ファイルを Pages 用の設定として解釈しようとするため、**`wrangler.toml` / `wrangler.jsonc` を置かないでください**（Workers 用の設定を置くとビルドが失敗します）。

### SITE_URLが決めるもの

canonical・RSS内のリンク・sitemapの`<loc>`・robots.txtのSitemap行は、すべて`SITE_URL`から生成されます。公開URLを変えるときはこの1箇所を書き換えて再デプロイすれば、4つとも同時に追従します。`tests/build.test.ts`が成果物を照合するので、いずれかが食い違えばビルドが失敗します。

### ビルドコマンドについて

`astro build`単体ではなく`pnpm run build`（型チェック→テスト→内容lint→ビルド→Pagefind索引→成果物検証）を使います。`astro build`だけだとPagefindの検索索引が生成されず、検索機能が無言で壊れます。

`pnpm build`と`pnpm run build`は同じものです。`build`はpnpm自身のサブコマンドではないため、`pnpm build`は`pnpm run build`にそのまま解決されます。

## 共有時の画像（OGP・favicon）

URLを共有したときのカード画像とタブのアイコンは、サイト共通の1枚を使います。実体は`public/`に置いた静的ファイルで、`src/layouts/BaseLayout.astro`のheadから全ページへ配られます。

| ファイル | 用途 |
| --- | --- |
| `public/og.jpg`（1200×630） | OGP・Twitter Card（`summary_large_image`）の画像 |
| `public/favicon.ico`（16+32px） | ブラウザが`/favicon.ico`を直接取りに来るためのアイコン |
| `public/icon-192.png` | 高解像度ディスプレイ向けのfavicon |
| `public/apple-touch-icon.png`（180×180） | iOSのホーム画面に追加したときのアイコン |

`og:image`は`SITE_URL`起点の絶対URLで出力されます。相対パスだとクローラ側で解決できないためです。

### カード画像

`public/og.jpg`は3Dで作った枯山水のレンダリングです。元データは`scripts/card-source/`に置き、そこから1200×630に切り出したものを`public/`へ入れます。

階調の多い絵なのでPNGではなくJPEGにしています。同じ見た目でもPNGだと10倍近く重くなり、クローラが取得しきれずカードが出ないことがあるためです。

差し替えるときは`src/layouts/BaseLayout.astro`の`OG_IMAGE`の`width`/`height`を実物に合わせてください。ずれるとカードの形が崩れます。`tests/build.test.ts`がJPEGのヘッダから実寸を読んで宣言値と突き合わせるので、食い違えばビルドが失敗します。

### アイコン

タブのアイコンは、地を墨色に沈めて字を紙色で抜いています。サイト本体より濃いのは、16pxでの識別を優先したためです。淡い色の字や浮き彫りの表現は、16pxでは効果が成立せず字が消えます。

作り直すときは`scripts/brand-assets.html`をブラウザで開き、表示されるリンクからPNGを保存して、最後に次を実行します。

```bash
node scripts/make-favicon-ico.mjs
```

配色と書体は`src/styles/global.css`から写した値をHTML内の`PALETTE`に持たせています。SVG→PNGの変換ツールを増やさずにブランドの書体（Klee One）で描くため、生成はブラウザのcanvasで行います。

記事ごとの画像は用意していません。入れるときは`BaseLayout`の`ogImage`プロパティに渡せば、head側を書き換えずに差し替えられます。

## コンテンツ

1記事を`src/content/articles/<slug>/`にまとめ、`index.mdx`、`visuals/*.json`、`assets/`を同居させます。記事・visualの`id`はUUIDv7で、ファイル名や公開slugとは独立しています。

`pnpm run lint:content`はcollection schemaに加えて、MDX内の`<Visual id="..." />`とfrontmatter宣言の一致、slug、所有関係、related参照を検証します。
