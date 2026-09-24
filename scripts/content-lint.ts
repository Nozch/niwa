import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
import { articleSchema, visualSchema } from '../src/content/schema';

const root = path.resolve('src/content/articles');
const errors: string[] = [];

type ArticleFile = {
  path: string;
  folder: string;
  body: string;
  data: Record<string, unknown>;
};
type VisualFile = { path: string; data: Record<string, unknown> };

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat();
}

function report(file: string, message: string) {
  errors.push(`${path.relative(process.cwd(), file)}: ${message}`);
}

const files = await walk(root);
const articles: ArticleFile[] = [];
const visuals: VisualFile[] = [];

for (const file of files) {
  if (file.endsWith(`${path.sep}index.mdx`)) {
    const parsed = matter(await readFile(file, 'utf8'));
    articles.push({ path: file, folder: path.dirname(file), body: parsed.content, data: parsed.data });
  } else if (file.includes(`${path.sep}visuals${path.sep}`) && file.endsWith('.json')) {
    try {
      visuals.push({ path: file, data: JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown> });
    } catch (error) {
      report(file, `JSONを読めません: ${String(error)}`);
    }
  }
}

for (const article of articles) {
  const result = articleSchema.safeParse(article.data);
  if (!result.success) {
    result.error.issues.forEach((issue) => report(article.path, `${issue.path.join('.')}: ${issue.message}`));
  }
}
for (const visual of visuals) {
  const result = visualSchema.safeParse(visual.data);
  if (!result.success) {
    result.error.issues.forEach((issue) => report(visual.path, `${issue.path.join('.')}: ${issue.message}`));
  }
}

const articleById = new Map<string, ArticleFile>();
const visualById = new Map<string, VisualFile>();
const slugOwners = new Map<string, string>();

for (const article of articles) {
  const id = String(article.data.id ?? '');
  if (articleById.has(id)) report(article.path, `記事ID ${id} が重複しています`);
  articleById.set(id, article);
  const slug = String(article.data.slug ?? path.basename(article.folder));
  if (slugOwners.has(slug)) report(article.path, `slug ${slug} が ${slugOwners.get(slug)} と重複しています`);
  slugOwners.set(slug, path.relative(process.cwd(), article.path));
}
for (const visual of visuals) {
  const id = String(visual.data.id ?? '');
  if (visualById.has(id)) report(visual.path, `visual ID ${id} が重複しています`);
  visualById.set(id, visual);
}

const visualOwners = new Map<string, string>();
for (const article of articles) {
  const articleId = String(article.data.id ?? '');
  const declared = Array.isArray(article.data.visuals) ? article.data.visuals.map(String) : [];
  const related = Array.isArray(article.data.related) ? article.data.related.map(String) : [];

  if (new Set(declared).size !== declared.length) report(article.path, 'visualsに重複参照があります');
  if (new Set(related).size !== related.length) report(article.path, 'relatedに重複参照があります');
  if (related.includes(articleId)) report(article.path, 'relatedで自分自身は参照できません');

  for (const relatedId of related) {
    const target = articleById.get(relatedId);
    if (!target) report(article.path, `related ${relatedId} が見つかりません`);
    if (article.data.draft === false && target?.data.draft === true) {
      report(article.path, `公開記事からdraft ${relatedId} は参照できません`);
    }
  }

  for (const visualId of declared) {
    const visual = visualById.get(visualId);
    if (!visual) {
      report(article.path, `visual ${visualId} が見つかりません`);
      continue;
    }
    const expected = `${path.join(article.folder, 'visuals')}${path.sep}`;
    if (!visual.path.startsWith(expected)) report(article.path, `visual ${visualId} は記事フォルダ内にありません`);
    const owner = visualOwners.get(visualId);
    if (owner && owner !== articleId) report(article.path, `visual ${visualId} は記事 ${owner} でも所有されています`);
    visualOwners.set(visualId, articleId);
  }

  const rendered: string[] = [];
  try {
    const tree = unified().use(remarkParse).use(remarkMdx).parse(article.body);
    visit(tree, (node: any) => {
      if (!['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type) || node.name !== 'Visual') return;
      const attribute = node.attributes?.find((item: any) => item.type === 'mdxJsxAttribute' && item.name === 'id');
      if (!attribute || typeof attribute.value !== 'string') {
        report(article.path, '<Visual>のidは静的な文字列で指定してください');
        return;
      }
      rendered.push(attribute.value);
    });
  } catch (error) {
    report(article.path, `MDXを解析できません: ${String(error)}`);
  }
  if (new Set(rendered).size !== rendered.length) report(article.path, '<Visual>が重複して描画されています');
  const missing = declared.filter((id) => !rendered.includes(id));
  const undeclared = rendered.filter((id) => !declared.includes(id));
  if (missing.length) report(article.path, `宣言済みvisualが未描画です: ${missing.join(', ')}`);
  if (undeclared.length) report(article.path, `未宣言visualを描画しています: ${undeclared.join(', ')}`);
}

for (const visual of visuals) {
  const id = String(visual.data.id ?? '');
  if (!visualOwners.has(id)) report(visual.path, `visual ${id} はどの記事からも参照されていません`);
}

if (errors.length) {
  console.error(`Content lint failed (${errors.length})\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Content lint passed: ${articles.length} articles, ${visuals.length} visuals`);
