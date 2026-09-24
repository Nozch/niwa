import matter from 'gray-matter';
import { articleSchema } from '../src/content/schema';

/*
 * 公開用リポジトリへ出すファイル一式から、どの記事フォルダを除くかを決める。
 * draft はサイトに出すかどうかしか決めておらず、ファイル自体は非公開リポジトリに
 * コミットされる。公開側では「リポジトリの読者」にも下書きを見せないため、ここで除く。
 * git とファイル操作は scripts/release-public.ts に置き、ここは判定だけを持つ（テストのため）。
 */

export const ARTICLES_ROOT = 'src/content/articles';

/**
 * 下書きでも公開側に残す記事フォルダ。tests/build.test.ts は「下書きは本番に出ない」ことを
 * private-seed で確かめるので、これを消すと公開側のテストが検査対象を失う。
 * ここに足した記事は本文ごと公開される。
 */
export const KEPT_DRAFT_FOLDERS: readonly string[] = ['private-seed'];

export type SnapshotPlan =
  | { ok: true; removeFolders: string[]; keptDrafts: string[]; publishedFolders: string[] }
  | { ok: false; errors: string[] };

type ArticleVerdict = { folder: string; id: string; draft: boolean; related: string[] };

/**
 * @param paths スナップショットに含まれる全ファイルの、リポジトリ直下からの相対パス（区切りは /）
 * @param readIndex 記事の index.mdx の中身を返す。paths に含まれる index.mdx に対してだけ呼ばれる
 */
export function planSnapshot(paths: readonly string[], readIndex: (path: string) => string): SnapshotPlan {
  const errors: string[] = [];
  const folders = new Set<string>();
  const indexes = new Set<string>();
  const prefix = `${ARTICLES_ROOT}/`;

  for (const file of paths) {
    if (!file.startsWith(prefix)) continue;
    const segments = file.slice(prefix.length).split('/');
    // 記事フォルダの外に置かれたファイルは、どの記事の下書き判定にも属さない。
    // 判定できないものは公開側へ流さない。
    if (segments.length === 1) {
      errors.push(`${file}: 記事フォルダの外にあるファイルは判定できません`);
      continue;
    }
    folders.add(segments[0]);
    if (segments.at(-1) === 'index.mdx') {
      // content collection は **/index.mdx を拾うので、入れ子の index.mdx も記事として公開される。
      // フォルダ単位で判定しているここでは、その下書き判定を取りこぼす。
      if (segments.length !== 2) errors.push(`${file}: 記事フォルダ直下以外の index.mdx は判定できません`);
      else indexes.add(segments[0]);
    }
  }

  const verdicts: ArticleVerdict[] = [];
  for (const folder of [...folders].sort()) {
    const indexPath = `${prefix}${folder}/index.mdx`;
    if (!indexes.has(folder)) {
      errors.push(`${prefix}${folder}/: index.mdx が無いため下書きかどうか判定できません`);
      continue;
    }
    let data: unknown;
    try {
      data = matter(readIndex(indexPath)).data;
    } catch (error) {
      errors.push(`${indexPath}: frontmatterを解釈できません: ${String(error)}`);
      continue;
    }
    // draft は既定値が true なので、生のfrontmatterで draft === true を探すと
    // draft欄の無い下書きを取りこぼす。サイトと同じschemaを通した値で判定する。
    const parsed = articleSchema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' / ');
      errors.push(`${indexPath}: schemaに合わないため判定できません（${issues}）`);
      continue;
    }
    verdicts.push({ folder, id: parsed.data.id, draft: parsed.data.draft, related: parsed.data.related });
  }

  if (errors.length) return { ok: false, errors };

  const removeFolders = verdicts.filter((v) => v.draft && !KEPT_DRAFT_FOLDERS.includes(v.folder)).map((v) => v.folder);
  const removedIds = new Map(verdicts.filter((v) => removeFolders.includes(v.folder)).map((v) => [v.id, v.folder]));

  // 残す記事が除く記事を related で指していると、公開側だけ参照先が消えてビルドが落ちる。
  // lint:content は生のfrontmatterで draft === true を見ているため、draft欄の無い下書きへの
  // 参照はすり抜ける。壊れた公開ツリーを作る前にここで止める。
  const dangling = verdicts
    .filter((v) => !removeFolders.includes(v.folder))
    .flatMap((v) => v.related.filter((id) => removedIds.has(id)).map((id) => `${prefix}${v.folder}/index.mdx: 除外する下書き ${removedIds.get(id)} を related で参照しています`));
  if (dangling.length) return { ok: false, errors: dangling };

  return {
    ok: true,
    removeFolders,
    keptDrafts: verdicts.filter((v) => v.draft && !removeFolders.includes(v.folder)).map((v) => v.folder),
    publishedFolders: verdicts.filter((v) => !v.draft).map((v) => v.folder),
  };
}

/**
 * 除外を実行したあとのツリーを読み直して検査する。除外処理そのものの取りこぼし
 * （削除の失敗やパスの取り違え）を、判定とは別の読み取りで捕まえるために分けてある。
 * 空配列なら公開してよい。
 */
export function findLeaks(paths: readonly string[], readIndex: (path: string) => string): string[] {
  const plan = planSnapshot(paths, readIndex);
  if (!plan.ok) return plan.errors;
  return plan.removeFolders.map((folder) => `${ARTICLES_ROOT}/${folder}/: 下書きが除外されずに残っています`);
}

const NOREPLY_EMAIL = /^[^\s@<>]+@users\.noreply\.github\.com$/i;

/** GitHubの非公開用アドレスか。これ以外のアドレスはコミット情報から誰でも読めてしまう。 */
export function isNoreplyEmail(email: string): boolean {
  return NOREPLY_EMAIL.test(email.trim());
}

/**
 * `git var GIT_AUTHOR_IDENT` の出力（`Name <email> 1727000000 +0900`）からアドレスを取り出す。
 * git config の値ではなくこちらを見るのは、環境変数 GIT_AUTHOR_EMAIL などによる上書きも
 * 反映された、実際にコミットへ書かれる値だからである。
 */
export function emailFromIdent(ident: string): string | null {
  return ident.match(/<([^<>]*)>/)?.[1] ?? null;
}

export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
