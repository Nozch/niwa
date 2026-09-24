import { describe, expect, it } from 'vitest';
import { emailFromIdent, findLeaks, isNoreplyEmail, KEPT_DRAFT_FOLDERS, planSnapshot } from '../scripts/public-snapshot';

const root = 'src/content/articles';
let sequence = 0;

function frontmatter(fields: Record<string, unknown>): string {
  sequence += 1;
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    id: `01978f38-8e00-7000-8000-${String(sequence).padStart(12, '0')}`,
    title: 't',
    description: 'd',
    kind: 'diary',
    createdAt: '2026-07-01T00:00:00+09:00',
    ...fields,
  };
  const lines = Object.entries(base)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n本文\n`;
}

const published = (fields: Record<string, unknown> = {}) =>
  frontmatter({ draft: false, publishedAt: '2026-07-02T00:00:00+09:00', ...fields });

/** { "記事フォルダ/相対パス": 中身 } からスナップショットを組み立てる */
function tree(files: Record<string, string>) {
  const all: Record<string, string> = { 'src/pages/index.astro': '', 'package.json': '{}' };
  for (const [file, content] of Object.entries(files)) all[`${root}/${file}`] = content;
  const paths = Object.keys(all);
  const readIndex = (file: string) => {
    if (!(file in all)) throw new Error(`unexpected read: ${file}`);
    return all[file];
  };
  return [paths, readIndex] as const;
}

describe('planSnapshot', () => {
  it('removes drafts and keeps published articles with their visuals', () => {
    const plan = planSnapshot(...tree({
      'open/index.mdx': published(),
      'open/visuals/chart.json': '{}',
      'secret/index.mdx': frontmatter({ draft: true }),
      'secret/visuals/chart.json': '{}',
    }));
    expect(plan).toEqual({ ok: true, removeFolders: ['secret'], keptDrafts: [], publishedFolders: ['open'] });
  });

  // schema の既定値は draft: true。生のfrontmatterで draft === true を探す実装だと、ここが漏れる。
  it('treats an article without a draft field as a draft', () => {
    const plan = planSnapshot(...tree({ 'nodraft/index.mdx': frontmatter({ draft: undefined }) }));
    expect(plan.ok && plan.removeFolders).toEqual(['nodraft']);
  });

  it('keeps only the listed fixture draft', () => {
    expect(KEPT_DRAFT_FOLDERS).toEqual(['private-seed']);
    const plan = planSnapshot(...tree({
      'private-seed/index.mdx': frontmatter({ draft: true }),
      'private-seed-2/index.mdx': frontmatter({ draft: true }),
    }));
    expect(plan).toMatchObject({ ok: true, removeFolders: ['private-seed-2'], keptDrafts: ['private-seed'] });
  });

  it('stops when frontmatter cannot be parsed', () => {
    const plan = planSnapshot(...tree({
      'broken/index.mdx': '---\ntitle: [unterminated\n---\n',
      'secret/index.mdx': frontmatter({ draft: true }),
    }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.errors.join('\n')).toContain('broken/index.mdx');
  });

  it('stops when frontmatter does not match the schema', () => {
    const plan = planSnapshot(...tree({ 'odd/index.mdx': frontmatter({ draft: 'no' }) }));
    expect(plan.ok).toBe(false);
  });

  it('stops when an article folder has no index.mdx', () => {
    const plan = planSnapshot(...tree({ 'orphan/visuals/chart.json': '{}' }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.errors.join('\n')).toContain('orphan/');
  });

  // content collection は **/index.mdx を拾うので、入れ子の記事はフォルダ単位の判定から漏れる。
  it('stops on a nested index.mdx', () => {
    const plan = planSnapshot(...tree({
      'outer/index.mdx': published(),
      'outer/inner/index.mdx': frontmatter({ draft: true }),
    }));
    expect(plan.ok).toBe(false);
  });

  it('stops on a file placed directly in the articles root', () => {
    const plan = planSnapshot(...tree({ 'stray.mdx': frontmatter({ draft: true }) }));
    expect(plan.ok).toBe(false);
  });

  it('stops when a kept article still refers to a removed draft', () => {
    const draftId = '01978f38-8e00-7000-8000-00000000abcd';
    const plan = planSnapshot(...tree({
      'secret/index.mdx': frontmatter({ id: draftId, draft: undefined }),
      'open/index.mdx': published({ related: [draftId] }),
    }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.errors.join('\n')).toContain('secret');
  });

  it('ignores files outside the articles root', () => {
    const plan = planSnapshot(...tree({}));
    expect(plan).toEqual({ ok: true, removeFolders: [], keptDrafts: [], publishedFolders: [] });
  });
});

describe('findLeaks', () => {
  it('reports a draft that is still present after removal', () => {
    const [paths, readIndex] = tree({ 'open/index.mdx': published(), 'secret/index.mdx': frontmatter({ draft: true }) });
    expect(findLeaks(paths, readIndex)).toEqual([`${root}/secret/: 下書きが除外されずに残っています`]);
  });

  it('passes once drafts are gone, leaving the fixture', () => {
    const [paths, readIndex] = tree({ 'open/index.mdx': published(), 'private-seed/index.mdx': frontmatter({ draft: true }) });
    expect(findLeaks(paths, readIndex)).toEqual([]);
  });

  it('reports unjudgeable content instead of passing it', () => {
    const [paths, readIndex] = tree({ 'orphan/assets/a.png': '' });
    expect(findLeaks(paths, readIndex)).not.toEqual([]);
  });
});

describe('isNoreplyEmail', () => {
  it('accepts GitHub noreply addresses', () => {
    expect(isNoreplyEmail('89130911+Nozch@users.noreply.github.com')).toBe(true);
    expect(isNoreplyEmail('Nozch@users.noreply.github.com')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const email of ['someone@example.com', '', 'x@users.noreply.github.com.example.com', 'x@noreply.github.com', 'a b@users.noreply.github.com']) {
      expect(isNoreplyEmail(email), email).toBe(false);
    }
  });
});

describe('emailFromIdent', () => {
  it('reads the address from git var output', () => {
    expect(emailFromIdent('Nozch <89130911+Nozch@users.noreply.github.com> 1727183985 +0900')).toBe('89130911+Nozch@users.noreply.github.com');
    expect(emailFromIdent('no address here')).toBeNull();
  });
});
