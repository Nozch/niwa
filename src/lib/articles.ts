import type { CollectionEntry } from 'astro:content';

export type ArticleEntry = CollectionEntry<'articles'>;

export function isPublished(article: ArticleEntry): boolean {
  return !article.data.draft && Boolean(article.data.publishedAt);
}

export function articleSlug(article: ArticleEntry): string {
  if (article.data.slug) return article.data.slug;
  const filePath = article.filePath?.replaceAll('\\', '/');
  const match = filePath?.match(/articles\/([^/]+)\/index\.mdx$/);
  if (!match) throw new Error(`記事 ${article.id} のslugをfilePathから導出できません`);
  return match[1];
}

export function articleHref(article: ArticleEntry): string {
  return `/articles/${articleSlug(article)}/`;
}

/** filePath 由来のディレクトリ名（= エディタAPI/編集ページのキー、data.slugとは独立）。 */
export function articleDir(article: ArticleEntry): string {
  const filePath = article.filePath?.replaceAll('\\', '/');
  const match = filePath?.match(/articles\/([^/]+)\/index\.mdx$/);
  if (!match) throw new Error(`記事 ${article.id} のディレクトリをfilePathから導出できません`);
  return match[1];
}

export function sortArticles(articles: ArticleEntry[]): ArticleEntry[] {
  return [...articles].sort((left, right) => {
    const byDate = Date.parse(right.data.publishedAt ?? right.data.createdAt) - Date.parse(left.data.publishedAt ?? left.data.createdAt);
    return byDate || left.id.localeCompare(right.id);
  });
}

export function visibleArticles(articles: ArticleEntry[], includeDrafts = false): ArticleEntry[] {
  return sortArticles(articles.filter((article) => includeDrafts || isPublished(article)));
}

export function relatedArticles(
  current: ArticleEntry,
  allArticles: ArticleEntry[],
  limit = 3,
): ArticleEntry[] {
  const published = allArticles.filter((article) => article.id !== current.id && isPublished(article));
  const byId = new Map(published.map((article) => [article.id, article]));
  const explicitIds = current.data.related.map((reference) => reference.id);
  const explicit = explicitIds.flatMap((id) => {
    const article = byId.get(id);
    return article ? [article] : [];
  });

  if (explicit.length >= limit) return explicit;

  const currentTags = new Set(current.data.tags);
  const candidates = published
    .filter((article) => !explicitIds.includes(article.id))
    .map((article) => ({
      article,
      score: article.data.tags.filter((tag) => currentTags.has(tag)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const byDate =
        Date.parse(right.article.data.publishedAt ?? right.article.data.createdAt) -
        Date.parse(left.article.data.publishedAt ?? left.article.data.createdAt);
      return byDate || left.article.id.localeCompare(right.article.id);
    })
    .map(({ article }) => article);

  return [...explicit, ...candidates.slice(0, limit - explicit.length)];
}

export interface Navigation {
  all: number;
  diary: number;
  project: number;
  tags: { name: string; count: number }[];
}

/** サイドバー用の集計（種類ごとの件数とタグ一覧）を、渡した記事集合から作る。 */
export function buildNavigation(articles: ArticleEntry[]): Navigation {
  const tags = [...new Set(articles.flatMap((article) => article.data.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
  return {
    all: articles.length,
    diary: articles.filter((article) => article.data.kind === 'diary').length,
    project: articles.filter((article) => article.data.kind === 'project').length,
    tags: tags.map((name) => ({ name, count: articles.filter((article) => article.data.tags.includes(name)).length })),
  };
}

export function kindLabel(article: ArticleEntry): string {
  return article.data.kind === 'diary' ? '日記' : '作りかけ';
}

/** 重複を除いた日本語ソート済み配列（エディタの候補チップ用）。 */
export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function formatDate(value: string | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
