# AGENTS.md

このリポジトリで作業するAIエージェント向けの手順書。**毎回この順番で進める。**

実装だけを行って記録を残さないのは未完了とみなす。このプロジェクトの成果物は
「動くコード」と「あとから判断を復元できる記録」の両方で、記録は
`../amu-doc-server/artifacts/digital-garden-front/` に置く。

## 記録の置き場所

| 種類 | パス | 単位 |
| --- | --- | --- |
| completion criteria | `completion-criteria/v0.1.x.json` | リリース単位で1ファイル |
| devlog | `devlogs/<uuid>.json` | 作業単位で1ファイル |
| decision map | `project-decision-map.json` | プロジェクトに1つ（追記・更新） |

いずれもJSON。既存ファイルの形（`schemaName` / `schemaVersion` / キー構成）を必ず踏襲する。
新しいキーを勝手に増やさない。

---

## 手順

### 1. completion criteria を書く（ユーザ確認: 不要）

`completion-criteria/v0.1.x.json` を新規作成する。前バージョンのファイルを読み、同じ構造で書く。

- `goal` / `theme` — 何を達成したら終わりかを1〜2文で
- `context.problem` — **現物のコードを読んで**、壊れている箇所を具体的に書く。
  「〜という問題がある」ではなく「この式がこの条件でこの値になる」まで落とす
- `context.structuralObstacle` — なぜ今のままでは直せない / テストできないのか
- `context.operationalRisk` — 壊れたとき誰が何を失うのか
- `completionCriteria[]` — 検証可能な条件。1項目1事実。「テストで確認する」と書いたものは
  実際に自動テストを書く。書けないもの（DOM・フォーカス・ARIAなど）は手動確認と明記する
- `nonGoals[]` — **今回やらないこと**。スコープ膨張を止めるのが目的なので必ず書く
- `acceptancePolicy` / `boundaryPolicy` — 受け入れ方針と、踏み込まない線

書き終えたら確認を取らずに次へ進む。

### 2. 実装する（ユーザ確認: 設計判断があるときのみ）

criteria を満たすように実装する。

- **設計上の分岐（ファイル構成が変わる / 既存の前提に触れる / トレードオフがある）に出会ったら、
  実装前にユーザへ確認する。** 選択肢と推奨を提示する
- ユーザが前提知識を持たない領域（ARIA、UUIDのバージョン、排他制御など）が判断に絡むときは、
  **選択肢を出す前にその概念を説明する。** 説明なしの二択は選ばせない
- このリポジトリの前例に従う: 判断ロジックはコンポーネント／HTTPハンドラから切り離し、
  astro・DOM に依存しないモジュールへ置いてテスト可能にする
  （`src/integrations/editor-store.ts`、`src/lib/search-palette.ts` が先例）
- コメントは「何をしているか」ではなく「なぜそうしたか / そうしないと何が壊れるか」を書く

検証は次を通す。Node は v22 を PATH の先頭に置く必要がある。

```sh
PATH=$HOME/.nvm/versions/node/v22.19.0/bin:$PATH pnpm run typecheck
```

```sh
SITE_URL=https://example.com PATH=$HOME/.nvm/versions/node/v22.19.0/bin:$PATH pnpm run build
```

追加したテストファイルは `package.json` の `test` スクリプトに手で足す（globではないため）。

ブラウザでの確認が要るとき（検索・視覚化など）は `astro dev` ではなく
**build + `astro preview`**（`.claude/launch.json` の `astro-preview`）を使う。
Pagefind の索引は本番ビルドの成果物にしか存在しない。

### 3. devlog を書く（ユーザ確認: **必須**）

`devlogs/<uuid>.json` を新規作成する。`schemaVersion: 3`。

`changeSummary` は `{ what, why, how }` の3つ。

- `what` — 何を変えたか。1〜2文
- `why` — **なぜ必要だったか。** 実装の説明ではなく、放置すると何が起きるかを書く
- `how` — どう直したか。見出し（【】）で区切って、判断とその理由を追える形にする

その他:

- `checkedItems[]` — 実際に確認したことだけを書く。数値（件数・バージョン）は実測値
- `concerns[]` — 残った懸念。今回スコープ外にしたもの、既知のズレ、テストの弱いところ
- `riskTags[]` — 固定語彙のみ: `auth` / `permission` / `database` / `deletion` /
  `external_api` / `personal_data` / `dependency` / `env` / `unknown`。該当なしなら空配列
- `linkedVersion` — 手順1で作った criteria のバージョン
- `nextAction` — 次に決めるべきこと
- `status` — `open` / `closed`

書き終えたら**必ずユーザに提示し、分かりにくくないか確認する。**
ユーザが読んで理解できない devlog は書いていないのと同じ。専門用語に寄りすぎていないか、
「なぜ」が説明なしに前提化されていないかを自分で点検してから出す。

### 4. decision map を更新するか判断する（編集前のユーザ確認: **必須**）

`project-decision-map.json` に手を入れるかどうかを判断し、**判断の根拠と一緒にユーザへ提示して
承認を得てから**編集する。無断で編集しない。

更新が要るのは次のとき:

- 覆すとやり直しになる決定をした（`type: "principle"` の追加）
- 既存ノードの前提を変えた / 破った（該当ノードの `summary`・`status` の更新）
- 保留していた判断が決まった（`status: "draft"` → `"active"`）
- 新しい判断領域が生まれた（`type: "index"` の追加と `blog_decision_domain_index` への接続）

更新が要らないのは、既存の決定の帰結を実装しただけのとき。その場合は「不要」と理由を述べる。

編集するときは既存ノードの形に合わせる。`id` は `blog_` 接頭辞のスネークケース、
`reasonToRecord` には「記録しないと何が曖昧になるか」を書く。
ルートの `updatedAt` も更新する。
