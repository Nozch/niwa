import { describe, expect, it } from 'vitest';
import type { CollectionEntry } from 'astro:content';
import { relatedArticles, sortArticles } from '../src/lib/articles';

function article(id: string, tags: string[], publishedAt: string, related: string[] = [], draft = false) {
  return {
    id,
    collection: 'articles',
    filePath: `src/content/articles/${id}/index.mdx`,
    data: {
      schemaVersion: 1, id, title: id, description: id, kind: 'diary', draft,
      createdAt: publishedAt, publishedAt: draft ? undefined : publishedAt,
      tags, categories: [], series: [], visuals: [],
      related: related.map((target) => ({ collection: 'articles', id: target })),
    },
  } as unknown as CollectionEntry<'articles'>;
}

describe('article ordering', () => {
  const one = '01978f38-8e00-7000-8000-00000000a001';
  const two = '01978f38-8e00-7000-8000-00000000a002';
  const three = '01978f38-8e00-7000-8000-00000000a003';

  it('sorts by publication date, then stable ID', () => {
    const result = sortArticles([
      article(two, [], '2026-01-01T00:00:00Z'),
      article(one, [], '2026-01-01T00:00:00Z'),
      article(three, [], '2026-02-01T00:00:00Z'),
    ]);
    expect(result.map((item) => item.id)).toEqual([three, one, two]);
  });

  it('keeps explicit links first and fills by shared-tag score', () => {
    const current = article(one, ['a', 'b'], '2026-03-01T00:00:00Z', [three]);
    const automatic = article(two, ['a', 'b'], '2026-01-01T00:00:00Z');
    const explicit = article(three, [], '2026-01-01T00:00:00Z');
    const ignoredDraft = article('01978f38-8e00-7000-8000-00000000a004', ['a', 'b'], '2026-04-01T00:00:00Z', [], true);
    expect(relatedArticles(current, [current, automatic, explicit, ignoredDraft]).map((item) => item.id)).toEqual([three, two]);
  });
});
