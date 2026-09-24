import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AstroIntegration } from 'astro';
import { createArticleStore } from './editor-store';

// 記事の実体があるルート。cwd はプロジェクトルート（astro dev 実行時）。
const store = createArticleStore(path.resolve('src/content/articles'));

async function readRequestJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}

/**
 * dev サーバー(Vite)にだけミドルウェアを差し込むローカル編集API。
 * `astro:server:setup` は dev 起動時のみ呼ばれるため、本番ビルドには一切出力されない。
 * 書き込みの判断そのものは editor-store.ts 側にあり、ここはHTTPとの変換だけを行う。
 */
export default function niwaEditor(): AstroIntegration {
  return {
    name: 'niwa-editor',
    hooks: {
      // UIルートは dev のときだけ注入する。build では注入されず、src/editor-ui は
      // src/pages 外なので EditorForm を含め本番成果物には一切バンドルされない。
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/editor', entrypoint: 'src/editor-ui/list.astro' });
        injectRoute({ pattern: '/editor/new', entrypoint: 'src/editor-ui/new.astro' });
        injectRoute({ pattern: '/editor/[dir]/edit', entrypoint: 'src/editor-ui/edit.astro' });
      },
      'astro:server:setup': ({ server }) => {
        // connect は mount パスを req.url から取り除くので、ここでの url は /articles/... になる。
        server.middlewares.use('/editor/api', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            const { pathname } = new URL(req.url ?? '/', 'http://localhost');
            const method = req.method ?? 'GET';

            // POST /articles — 新規作成
            if (method === 'POST' && /^\/articles\/?$/.test(pathname)) {
              const payload = (await readRequestJson(req)) as { slug?: string; data?: Record<string, unknown>; body?: string };
              const result = await store.createArticle((payload.slug ?? '').trim(), payload.data ?? {}, payload.body ?? '');
              if (!result.ok) return sendJson(res, result.status, { error: result.error, issues: result.issues });
              return sendJson(res, 200, { ok: true, slug: result.slug });
            }

            const dirMatch = pathname.match(/^\/articles\/([^/]+)\/?$/);
            const dir = dirMatch ? decodeURIComponent(dirMatch[1]) : null;

            // GET /articles/:dir — 1記事の読み取り
            if (method === 'GET' && dir) {
              const result = await store.readArticle(dir);
              if (!result.ok) return sendJson(res, result.status, { error: result.error });
              return sendJson(res, 200, result.article);
            }

            // PUT /articles/:dir — 既存記事の上書き保存
            if (method === 'PUT' && dir) {
              const payload = (await readRequestJson(req)) as { data?: Record<string, unknown>; body?: string };
              const result = await store.saveArticle(dir, payload.data ?? {}, payload.body ?? '');
              if (!result.ok) return sendJson(res, result.status, { error: result.error, issues: result.issues });
              return sendJson(res, 200, { ok: true, dir });
            }

            return sendJson(res, 404, { error: 'not found' });
          } catch (error) {
            return sendJson(res, 500, { error: String(error) });
          }
        });
      },
    },
  };
}
