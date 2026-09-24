/**
 * scripts/icon-sources/ の16px・32pxのPNGを束ねて public/favicon.ico を作る。
 * 材料のPNGは favicon.ico の中身になるだけで単体では配信しないので、公開ディレクトリには置かない。
 *
 * なぜ .ico が要るか: ブラウザは <link rel="icon"> の指定と無関係に /favicon.ico を取りに来る。
 * 置かないと全ページの閲覧で404が出続ける。
 *
 * なぜ変換ライブラリを使わないか: ICO は「ヘッダ + 画像データの列」でしかなく、
 * Vista以降の仕様ではPNGをそのまま内包できる。再エンコードは不要なので、
 * 画像処理の依存を1つも足さずにヘッダを書くだけで作れる。
 *
 *   node scripts/make-favicon-ico.mjs
 *
 * 元のPNGは scripts/brand-assets.html で描き直せる。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, '../public');
const sourceDir = path.join(scriptDir, 'icon-sources');
const SOURCES = ['icon-16.png', 'icon-32.png'];

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

const images = await Promise.all(
  SOURCES.map(async (name) => ({ name, data: await readFile(path.join(sourceDir, name)) })),
);

// PNGのIHDRは固定位置（シグネチャ8 + 長さ4 + 型4 = 16バイト目）から幅・高さが並ぶ。
// ICOのエントリはここで宣言した寸法を正としてブラウザが選ぶので、実体とずらさない。
function readPngSize(data, name) {
  const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) throw new Error(`${name} がPNGではない`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width > 256 || height > 256) throw new Error(`${name} は ${width}×${height}。ICOに入るのは256pxまで`);
  return { width, height };
}

const header = Buffer.alloc(ICONDIR_SIZE);
header.writeUInt16LE(0, 0); // 予約領域。常に0
header.writeUInt16LE(1, 2); // 種別。1 = アイコン
header.writeUInt16LE(images.length, 4);

let offset = ICONDIR_SIZE + ICONDIRENTRY_SIZE * images.length;
const entries = [];

for (const image of images) {
  const { width, height } = readPngSize(image.data, image.name);
  const entry = Buffer.alloc(ICONDIRENTRY_SIZE);
  // 256pxは0として書く決まり。ここでは16/32なのでそのまま入る。
  entry.writeUInt8(width === 256 ? 0 : width, 0);
  entry.writeUInt8(height === 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2); // パレット数。フルカラーなので0
  entry.writeUInt8(0, 3); // 予約領域
  entry.writeUInt16LE(1, 4); // プレーン数
  entry.writeUInt16LE(32, 6); // ビット深度
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += image.data.length;
}

const ico = Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
await writeFile(path.join(publicDir, 'favicon.ico'), ico);
console.log(`favicon.ico を書き出した: ${images.map((i) => i.name).join(' + ')} → ${ico.length} バイト`);
