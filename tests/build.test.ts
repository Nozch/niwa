import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function readTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const content = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? readTree(target) : readFile(target, 'utf8').catch(() => '');
  }));
  return content.join('\n');
}

describe('production output', () => {
  it('contains public routes, feeds, sitemap and search index', async () => {
    await expect(access('dist/index.html')).resolves.toBeUndefined();
    await expect(access('dist/articles/visualizing-garden/index.html')).resolves.toBeUndefined();
    await expect(access('dist/rss.xml')).resolves.toBeUndefined();
    await expect(access('dist/sitemap-index.xml')).resolves.toBeUndefined();
    await expect(access('dist/robots.txt')).resolves.toBeUndefined();
    await expect(access('dist/pagefind/pagefind.js')).resolves.toBeUndefined();
  });

  it('does not publish draft content', async () => {
    const output = await readTree('dist');
    expect(output).not.toContain('まだ名前のない種');
    await expect(access('dist/articles/private-seed/index.html')).rejects.toThrow();
  });

  // 共有時の見え方は書いた本人のブラウザからは確認できず、壊れていても気づけない。
  // head に何が出ているかをここで固定する。
  it('ships the shared card image and icons', async () => {
    await expect(access('dist/og.jpg')).resolves.toBeUndefined();
    await expect(access('dist/apple-touch-icon.png')).resolves.toBeUndefined();
    await expect(access('dist/icon-192.png')).resolves.toBeUndefined();
    // ブラウザは link 指定と無関係にこのパスを取りに来る。無いと全ページで404になる。
    await expect(access('dist/favicon.ico')).resolves.toBeUndefined();
  });

  it('declares the social card on every page', async () => {
    for (const page of ['dist/index.html', 'dist/articles/visualizing-garden/index.html', 'dist/404.html']) {
      const html = await readFile(page, 'utf8');
      expect(html, page).toContain('property="og:image"');
      expect(html, page).toContain('content="summary_large_image"');
      expect(html, page).toContain('property="og:image:width" content="1200"');
      expect(html, page).toContain('property="og:image:height" content="630"');
      expect(html, page).toContain('property="og:site_name"');
      expect(html, page).toContain('name="twitter:image"');
      expect(html, page).toContain('rel="apple-touch-icon"');
    }
  });

  // og:image:width / height は実物と一致していなければならない。ずれるとカードの形が崩れ、
  // しかも自分のブラウザでは何も起きないので気づけない。画像を差し替えたときに必ず引っかかるよう、
  // 宣言値ではなくJPEGのヘッダから読んだ実寸と突き合わせる。
  it('declares the card image at its real size', async () => {
    const jpeg = await readFile('dist/og.jpg');
    let offset = 2;
    let width = 0;
    let height = 0;
    while (offset < jpeg.length) {
      if (jpeg[offset] !== 0xff) { offset += 1; continue; }
      const marker = jpeg[offset + 1];
      // SOF0〜SOF15（DHT/JPG/DAC を除く）に寸法が入っている
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = jpeg.readUInt16BE(offset + 5);
        width = jpeg.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + jpeg.readUInt16BE(offset + 2);
    }
    const html = await readFile('dist/index.html', 'utf8');
    expect(html).toContain(`property="og:image:width" content="${width}"`);
    expect(html).toContain(`property="og:image:height" content="${height}"`);
    // 主要サービスが大きなカードとして扱う比率から外れていないか
    expect(width / height).toBeCloseTo(1.905, 2);
  });

  // head が指す先が dist に無ければ、タグだけ出ていても共有カードは空欄になる。
  it('links only to icons that exist', async () => {
    const html = await readFile('dist/index.html', 'utf8');
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      await expect(access(path.join('dist', href)), href).resolves.toBeUndefined();
    }
  });

  // 進捗はバーの幅と数値の2箇所に出る。どちらかだけを直すと、読者には帯の長さと
  // 数字が食い違ったまま見える。片方だけの変更が通らないよう、対で固定する。
  it('shows a matching percentage next to every progress bar', async () => {
    const html = await readFile('dist/index.html', 'utf8');
    const pairs = [...html.matchAll(/<span class="progress-track"><span style="width:(\d+)%"><\/span><\/span>\s*<span class="progress-value">(\d+)%<\/span>/g)];
    expect(pairs.length).toBeGreaterThan(0);
    // バーだけ出力されて数値が欠けたカードがあれば、対の数が合わなくなる。
    expect(pairs).toHaveLength([...html.matchAll(/class="progress"/g)].length);
    for (const [, barWidth, shownValue] of pairs) {
      expect(shownValue, barWidth).toBe(barWidth);
    }
  });

  // canonical・RSS・sitemap・robots は全て SITE_URL から生成される。
  // 1つでも別のURLに焼き付いたら公開URLが壊れるので、ここで固定する。
  it.skipIf(!process.env.SITE_URL)('builds every public URL from SITE_URL', async () => {
    const origin = new URL(process.env.SITE_URL!).origin;
    const article = await readFile('dist/articles/visualizing-garden/index.html', 'utf8');
    expect(article).toContain(`rel="canonical" href="${origin}/articles/visualizing-garden/"`);
    expect(await readFile('dist/rss.xml', 'utf8')).toContain(`<link>${origin}/articles/visualizing-garden/</link>`);
    expect(await readFile('dist/sitemap-0.xml', 'utf8')).toContain(`<loc>${origin}/</loc>`);
    expect(await readFile('dist/robots.txt', 'utf8')).toContain(`Sitemap: ${origin}/sitemap-index.xml`);
    // og:image が相対パスやビルド環境のホスト名で焼き付くと、クローラ側で画像を解決できない。
    expect(article).toContain(`property="og:image" content="${origin}/og.jpg"`);
    expect(article).toContain(`name="twitter:image" content="${origin}/og.jpg"`);
  });
});
