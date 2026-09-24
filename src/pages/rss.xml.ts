import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { articleHref, visibleArticles } from '@/lib/articles';

export async function GET(context: { site?: URL }) {
  const articles = visibleArticles(await getCollection('articles'));
  return rss({
    title: '庭 Niwa',
    description: '考えを育て、つながりを眺めるデジタルガーデン。',
    site: context.site ?? new URL('http://localhost:4321'),
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: new Date(article.data.publishedAt!),
      link: articleHref(article),
      categories: article.data.tags,
    })),
  });
}
