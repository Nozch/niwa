/**
 * エディタの書き込み経路の安全網。
 *
 * ここで守りたいのは「失敗したときに何も起きないこと」なので、
 * 各テストは戻り値だけでなく、ディスクの状態（ファイルが増えていない / 中身が1バイトも変わっていない）
 * まで確認する。読み書きは毎回使い捨ての一時ディレクトリに閉じ、実記事には触れない。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { articleSchema, UUID_V7_PATTERN } from '../src/content/schema';
import {
  FRONTMATTER_ORDER,
  createArticleStore,
  isSafeDir,
  orderFrontmatter,
  uuidv7,
} from '../src/integrations/editor-store';

const validDiary = {
  schemaVersion: 1,
  id: '01978f38-8e00-7000-8000-00000000b001',
  title: 'テスト記事',
  description: '説明',
  kind: 'diary',
  draft: false,
  createdAt: '2026-08-01T09:00:00+09:00',
  publishedAt: '2026-08-02T09:00:00+09:00',
  tags: ['雑記'],
  categories: [],
  series: [],
  visuals: [],
  related: [],
} as const;

function diary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...validDiary, ...overrides };
}

/** frontmatter のトップレベルキーを、ファイルに書かれた順のまま取り出す。 */
function frontmatterKeys(raw: string): string[] {
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => line.match(/^([A-Za-z][A-Za-z0-9]*):/)?.[1])
    .filter((key): key is string => Boolean(key));
}

/** 正準順のうち、実際に値を持つキーだけを並べた期待値。 */
function expectedOrder(keys: string[]): string[] {
  return FRONTMATTER_ORDER.filter((key) => keys.includes(key));
}

describe('editor store', () => {
  let root: string;
  let parent: string;
  let store: ReturnType<typeof createArticleStore>;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), 'niwa-editor-'));
    root = path.join(parent, 'articles');
    await mkdir(root, { recursive: true });
    store = createArticleStore(root);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(parent, { recursive: true, force: true });
  });

  /** 一時ディレクトリに既存記事を1本置く。 */
  async function seed(dir: string, data: Record<string, unknown> = diary(), body = '既存の本文。'): Promise<string> {
    const filePath = path.join(root, dir, 'index.mdx');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, matter.stringify(`\n${body}`, data), 'utf8');
    return filePath;
  }

  // ---------------------------------------------------------------------------
  // 不正slug
  // ---------------------------------------------------------------------------

  describe('不正なslug', () => {
    const rejected = [
      ['大文字を含む', 'Quiet-Notes'],
      ['空白を含む', 'quiet notes'],
      ['スラッシュを含む', 'quiet/notes'],
      ['ドットを含む', 'quiet.notes'],
      ['アンダースコアを含む', 'quiet_notes'],
      ['先頭がハイフン', '-quiet'],
      ['末尾がハイフン', 'quiet-'],
      ['ハイフンが連続', 'quiet--notes'],
      ['空文字', ''],
      ['日本語', '静かなメモ'],
      ['親ディレクトリ', '..'],
      ['相対パス', '../outside'],
    ] as const;

    it.each(rejected)('%s slug は400で拒否し、何も作らない (%s)', async (_label, slug) => {
      const result = await store.createArticle(slug, diary(), '本文');
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(400);
      expect(await readdir(root)).toEqual([]);
    });

    it('SLUG_PATTERNを満たすslugは受け付ける', async () => {
      const result = await store.createArticle('quiet-notes-2', diary(), '本文');
      expect(result.ok).toBe(true);
      expect(await readdir(root)).toEqual(['quiet-notes-2']);
    });
  });

  describe('パストラバーサル', () => {
    it('isSafeDirが記事ルートの外を指す名前を弾く', () => {
      for (const dir of ['..', '../..', '../outside', './x', 'a/b', '.hidden', '/etc/passwd']) {
        expect(isSafeDir(dir)).toBe(false);
      }
      expect(isSafeDir('quiet-notes')).toBe(true);
    });

    it('記事ルートの外にあるファイルを読まない・書き換えない', async () => {
      // root の1つ上に index.mdx を置くと、'..' が通れば読み書きできてしまう位置になる。
      const outside = path.join(parent, 'index.mdx');
      await writeFile(outside, 'ルート外のファイル', 'utf8');

      const read = await store.readArticle('..');
      expect(read.ok === false && read.status).toBe(400);

      const saved = await store.saveArticle('..', diary(), '乗っ取り');
      expect(saved.ok === false && saved.status).toBe(400);
      expect(await readFile(outside, 'utf8')).toBe('ルート外のファイル');
    });
  });

  // ---------------------------------------------------------------------------
  // 重複slug
  // ---------------------------------------------------------------------------

  describe('重複するslug', () => {
    it('既存フォルダと同じslugは409で拒否し、既存ファイルを上書きしない', async () => {
      const filePath = await seed('quiet-notes');
      const before = await readFile(filePath, 'utf8');

      const result = await store.createArticle('quiet-notes', diary({ title: '別の記事' }), '新しい本文');

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(409);
      expect(await readFile(filePath, 'utf8')).toBe(before);
    });

    it('index.mdxが無い空フォルダでも、フォルダがあれば409にする', async () => {
      await mkdir(path.join(root, 'empty-folder'), { recursive: true });

      const result = await store.createArticle('empty-folder', diary(), '本文');

      expect(result.ok === false && result.status).toBe(409);
      expect(await readdir(path.join(root, 'empty-folder'))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 存在しない記事
  // ---------------------------------------------------------------------------

  describe('存在しない記事', () => {
    it('読み取りは404を返し、例外を投げない', async () => {
      const result = await store.readArticle('missing-article');
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(404);
    });

    it('上書き保存は404で拒否し、ファイルもフォルダも作らない', async () => {
      const result = await store.saveArticle('missing-article', diary(), '本文');

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(404);
      expect(await readdir(root)).toEqual([]);
    });

    it('フォルダはあってもindex.mdxが無ければ保存は404にする', async () => {
      await mkdir(path.join(root, 'empty-folder'), { recursive: true });

      const result = await store.saveArticle('empty-folder', diary(), '本文');

      expect(result.ok === false && result.status).toBe(404);
      expect(await readdir(path.join(root, 'empty-folder'))).toEqual([]);
    });

    it('存在する記事は読み取れる', async () => {
      await seed('quiet-notes', diary(), '既存の本文。');
      const result = await store.readArticle('quiet-notes');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.article.data.title).toBe('テスト記事');
      expect(result.article.body.trim()).toBe('既存の本文。');
    });
  });

  // ---------------------------------------------------------------------------
  // 検証エラー時の非上書き
  // ---------------------------------------------------------------------------

  describe('検証エラー時', () => {
    // 新規作成では id / schemaVersion をサーバーが上書きするため、その2つが不正でも作成は通る。
    // 上書き保存には上書きが無いので、両方に効く不正と保存だけに効く不正を分けて並べる。
    const invalidForBoth: [string, Record<string, unknown>][] = [
      ['タイトルが空', diary({ title: '' })],
      ['公開なのにpublishedAtが無い', diary({ publishedAt: undefined })],
      ['日付がISO8601でない', diary({ createdAt: '2026-08-01' })],
      ['updatedAtがcreatedAtより前', diary({ updatedAt: '2026-07-01T09:00:00+09:00' })],
      ['kindが未知', diary({ kind: 'essay' })],
      ['project完了と進捗が不一致', diary({ kind: 'project', stage: 'complete', progress: 90 })],
      ['diaryにproject専用フィールド', diary({ stage: 'seed', progress: 10 })],
      ['tagsが重複', diary({ tags: ['雑記', '雑記'] })],
      ['未知のキー', diary({ author: 'nozch' })],
      ['空オブジェクト', {}],
    ];

    const invalidForSave: [string, Record<string, unknown>][] = [
      ...invalidForBoth,
      ['idがUUIDv7でない', diary({ id: '01978f38-8e00-4000-8000-00000000b001' })],
      ['idが無い', diary({ id: undefined })],
      ['schemaVersionが違う', diary({ schemaVersion: 2 })],
    ];

    it.each(invalidForSave)('上書き保存: %s なら422を返し、ファイルを1バイトも変えない', async (_label, data) => {
      const filePath = await seed('quiet-notes');
      const before = await readFile(filePath, 'utf8');

      const result = await store.saveArticle('quiet-notes', data, '書き換えられてはいけない本文');

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(422);
      expect(result.ok === false && Array.isArray(result.issues)).toBe(true);
      expect(await readFile(filePath, 'utf8')).toBe(before);
    });

    it.each(invalidForBoth)('新規作成: %s なら422を返し、フォルダを作らない', async (_label, data) => {
      const result = await store.createArticle('new-article', data, '本文');

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(422);
      // 検証NGで空フォルダだけが残ると、次の作成が409になって詰まる。
      expect(await readdir(root)).toEqual([]);
    });

    it('検証を通る保存は反映される', async () => {
      const filePath = await seed('quiet-notes');

      const result = await store.saveArticle('quiet-notes', diary({ title: '書き換え後' }), '新しい本文');

      expect(result.ok).toBe(true);
      const saved = matter(await readFile(filePath, 'utf8'));
      expect(saved.data.title).toBe('書き換え後');
      expect(saved.content.trim()).toBe('新しい本文');
    });
  });

  // ---------------------------------------------------------------------------
  // UUIDv7の採番方式
  // ---------------------------------------------------------------------------

  describe('UUIDv7の採番', () => {
    it('schemaのUUID_V7_PATTERNを満たし、version=7 / variant=10 になる', () => {
      for (let i = 0; i < 200; i += 1) {
        const id = uuidv7();
        expect(id).toMatch(UUID_V7_PATTERN);
        expect(id[14]).toBe('7'); // version nibble
        expect('89ab').toContain(id[19]); // variant の上位2bitが 10
      }
    });

    it('先頭48bitがミリ秒Unixタイムそのものになる', () => {
      const fixed = Date.parse('2026-08-02T04:05:06.789Z');
      vi.spyOn(Date, 'now').mockReturnValue(fixed);

      const id = uuidv7();
      const timestampHex = id.slice(0, 8) + id.slice(9, 13);

      expect(parseInt(timestampHex, 16)).toBe(fixed);
    });

    it('生成順に辞書順で並ぶ（時刻順ID）', () => {
      let clock = Date.parse('2026-08-02T00:00:00.000Z');
      vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));

      const ids = Array.from({ length: 50 }, () => uuidv7());

      expect([...ids].sort()).toEqual(ids);
    });

    it('同一ミリ秒内でも衝突しない（下位はランダム）', () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-02T00:00:00.000Z'));

      const ids = Array.from({ length: 1000 }, () => uuidv7());

      expect(new Set(ids).size).toBe(1000);
    });

    it('新規作成ではクライアントのid / schemaVersionを無視してサーバーが採番する', async () => {
      const clientId = '01978f38-8e00-7000-8000-0000000000ff';
      const result = await store.createArticle(
        'server-assigned',
        diary({ id: clientId, schemaVersion: 99 }),
        '本文',
      );

      expect(result.ok).toBe(true);
      const saved = matter(await readFile(path.join(root, 'server-assigned', 'index.mdx'), 'utf8'));
      expect(saved.data.schemaVersion).toBe(1);
      expect(saved.data.id).toMatch(UUID_V7_PATTERN);
      expect(saved.data.id).not.toBe(clientId);
    });
  });

  // ---------------------------------------------------------------------------
  // frontmatterの保存順
  // ---------------------------------------------------------------------------

  describe('frontmatterの保存順', () => {
    it('新規作成したファイルが正準順で書かれる', async () => {
      await store.createArticle('ordered-project', {
        // わざと逆順に近い順序で渡す。
        related: [], visuals: [], series: [], categories: ['庭'], tags: ['記録'],
        updatedAt: '2026-08-02T10:00:00+09:00',
        publishedAt: '2026-08-02T09:00:00+09:00',
        createdAt: '2026-08-01T09:00:00+09:00',
        draft: false, progress: 100, stage: 'complete', kind: 'project',
        description: '説明', title: 'タイトル',
      }, '本文');

      const keys = frontmatterKeys(await readFile(path.join(root, 'ordered-project', 'index.mdx'), 'utf8'));

      expect(keys).toEqual(expectedOrder(keys));
      expect(keys[0]).toBe('schemaVersion');
      expect(keys[1]).toBe('id');
      expect(keys.at(-1)).toBe('related');
    });

    it('上書き保存でも同じ順序になる（値の有無で順序が揺れない）', async () => {
      await seed('quiet-notes');
      await store.saveArticle('quiet-notes', diary({ updatedAt: '2026-08-03T09:00:00+09:00' }), '本文');

      const keys = frontmatterKeys(await readFile(path.join(root, 'quiet-notes', 'index.mdx'), 'utf8'));

      expect(keys).toEqual(expectedOrder(keys));
      expect(keys).toContain('updatedAt');
    });

    it('schemaが受け付けるフィールドがすべて正準順に載っている', () => {
      // 漏れたフィールドは末尾送りになり、記事ごとに順序が変わってdiffが荒れる。
      const maximal = articleSchema.parse({
        schemaVersion: 1,
        id: '01978f38-8e00-7000-8000-00000000b002',
        slug: 'explicit-slug',
        title: 'タイトル',
        description: '説明',
        kind: 'project',
        stage: 'complete',
        progress: 100,
        draft: false,
        createdAt: '2026-08-01T09:00:00+09:00',
        publishedAt: '2026-08-02T09:00:00+09:00',
        updatedAt: '2026-08-03T09:00:00+09:00',
        tags: ['記録'],
        categories: ['庭'],
        series: ['連載'],
        visuals: ['01978f38-8e00-7000-8000-00000000b003'],
        related: ['01978f38-8e00-7000-8000-00000000b004'],
      });

      const missing = Object.keys(maximal).filter(
        (key) => !(FRONTMATTER_ORDER as readonly string[]).includes(key),
      );

      expect(missing).toEqual([]);
    });

    it('正準順に無いキーも失わず末尾に温存する', () => {
      const ordered = orderFrontmatter({ legacyField: 'x', title: 'タイトル', id: 'i', schemaVersion: 1 });

      expect(Object.keys(ordered)).toEqual(['schemaVersion', 'id', 'title', 'legacyField']);
    });

    it('本文が往復で壊れず、frontmatterとの間は空行1つになる', async () => {
      const body = '1行目。\n\n2行目には --- を含む。\n\n最後の行。';
      await store.createArticle('roundtrip', diary(), body);
      const filePath = path.join(root, 'roundtrip', 'index.mdx');

      const raw = await readFile(filePath, 'utf8');
      expect(raw).toMatch(/\n---\n\n1行目。/);

      const read = await store.readArticle('roundtrip');
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.article.body.trim()).toBe(body);

      // 読み取った本文をそのまま保存し直しても、空行が増え続けない。
      await store.saveArticle('roundtrip', read.article.data, read.article.body);
      expect(await readFile(filePath, 'utf8')).toBe(raw);
    });
  });
});
