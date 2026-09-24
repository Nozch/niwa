/**
 * 記事フォルダへの読み書きそのもの。astro / vite に依存しないので、
 * dev サーバを起動せずテストから直接呼べる（記事ルートは引数で差し替える）。
 *
 * ここが唯一ディスクを書き換える場所なので、拒否条件（不正slug・重複・不在・検証NG）は
 * すべて write の前に置き、失敗時はファイルに一切触れないことを不変条件とする。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { articleSchema, SLUG_PATTERN } from '../content/schema';

/** schema の UUID_V7_PATTERN を満たす UUIDv7（時刻順）を生成する。crypto.randomUUID は v4 なので不可。 */
export function uuidv7(): string {
  const ts = Date.now();
  const bytes = new Uint8Array(16);
  // 先頭48bitがミリ秒Unixタイム。ここが上位にあるので文字列の辞書順＝生成時刻順になる。
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  crypto.getRandomValues(bytes.subarray(6));
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// frontmatter の書き戻し順。既存記事の手書き順に合わせて diff を安定させる。
// schema が受け付けるフィールドはすべてここに載せる（漏れると末尾送りになり順序が揺れる）。
export const FRONTMATTER_ORDER = [
  'schemaVersion', 'id', 'slug', 'title', 'description', 'kind', 'stage', 'progress',
  'draft', 'createdAt', 'publishedAt', 'updatedAt', 'tags', 'categories',
  'series', 'visuals', 'related',
] as const;

export function orderFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of FRONTMATTER_ORDER) {
    if (data[key] !== undefined) ordered[key] = data[key];
  }
  // 想定外キーも失わないよう末尾に温存する。
  for (const [key, value] of Object.entries(data)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered;
}

/** 検証済み frontmatter と本文を MDX 文字列に組み立てる（frontmatter は正準順、本文の前に空行1つ）。 */
export function buildMdx(data: Record<string, unknown>, body: string): string {
  return matter.stringify(`\n${body.replace(/^\n+/, '')}`, orderFrontmatter(data));
}

// dir はディレクトリ名（= slug 相当）。SLUG_PATTERN で `/` や `.` を排除し、
// パストラバーサル（../ で外へ出る）を防ぐ。
export function isSafeDir(dir: string): boolean {
  return SLUG_PATTERN.test(dir);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export type ArticleRecord = { dir: string; data: Record<string, unknown>; body: string };
export type StoreFailure = { ok: false; status: number; error: string; issues?: unknown };
export type StoreResult<T> = ({ ok: true } & T) | StoreFailure;

export interface ArticleStore {
  readonly root: string;
  readArticle(dir: string): Promise<StoreResult<{ article: ArticleRecord }>>;
  saveArticle(dir: string, data: Record<string, unknown>, body: string): Promise<StoreResult<{ dir: string }>>;
  createArticle(slug: string, data: Record<string, unknown>, body: string): Promise<StoreResult<{ slug: string }>>;
}

/** `root`（= src/content/articles 相当）配下だけを読み書きする記事ストアを作る。 */
export function createArticleStore(root: string): ArticleStore {
  const articlePath = (dir: string) => path.join(root, dir, 'index.mdx');

  return {
    root,

    /** 既存記事 index.mdx を読み、frontmatter(data) と本文(body) に分けて返す。 */
    async readArticle(dir) {
      if (!isSafeDir(dir)) return { ok: false, status: 400, error: '不正なディレクトリ名です' };
      let raw: string;
      try {
        raw = await readFile(articlePath(dir), 'utf8');
      } catch {
        return { ok: false, status: 404, error: `記事が見つかりません: ${dir}` };
      }
      const parsed = matter(raw);
      return { ok: true, article: { dir, data: parsed.data, body: parsed.content } };
    },

    /**
     * 既存記事を上書き保存する。articleSchema で検証してから gray-matter で書き戻す。
     * 不正なdir・記事が無い・検証NGのいずれでも、ファイルには触れない。
     */
    async saveArticle(dir, data, body) {
      if (!isSafeDir(dir)) return { ok: false, status: 400, error: '不正なディレクトリ名です' };
      const filePath = articlePath(dir);
      // 保存APIを新規作成の代わりに使えないようにする（不在なら作らず404）。
      if (!(await pathExists(filePath))) {
        return { ok: false, status: 404, error: `記事が見つかりません: ${dir}` };
      }
      const result = articleSchema.safeParse(data);
      if (!result.success) {
        return { ok: false, status: 422, error: '検証エラー', issues: result.error.issues };
      }
      await writeFile(filePath, buildMdx(result.data as Record<string, unknown>, body), 'utf8');
      return { ok: true, dir };
    },

    /**
     * 新規記事を作成する。slug をフォルダ名にし、id は UUIDv7 を採番。
     * 既存フォルダなら 409、検証NGなら 422 を返し、いずれもファイルを作らない。
     */
    async createArticle(slug, data, body) {
      if (!isSafeDir(slug)) {
        return { ok: false, status: 400, error: 'slugは英小文字・数字・ハイフンで指定してください' };
      }
      const dirPath = path.join(root, slug);
      if (await pathExists(dirPath)) {
        return { ok: false, status: 409, error: `フォルダが既に存在します: ${slug}` };
      }
      // id と schemaVersion はサーバーが決める（クライアント値は無視）。
      const merged = { ...data, schemaVersion: 1, id: uuidv7() };
      const result = articleSchema.safeParse(merged);
      if (!result.success) {
        return { ok: false, status: 422, error: '検証エラー', issues: result.error.issues };
      }
      // 検証が通ってから初めてディレクトリを作る（NG時に空フォルダを残さない）。
      await mkdir(dirPath, { recursive: true });
      await writeFile(articlePath(slug), buildMdx(result.data as Record<string, unknown>, body), 'utf8');
      return { ok: true, slug };
    },
  };
}
