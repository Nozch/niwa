/*
 * 非公開リポジトリのタグが指す時点から下書きを除き、公開用リポジトリへ1コミットとして積む。
 *
 *   pnpm run release:public v0.3.0 ../niwa
 *
 * pushはしない。公開リポジトリへ一度pushしたものは複製やキャッシュから取り消せないので、
 * 検査が想定していない種類のファイルが紛れても最後に人が止められるよう、差分の確認とpushは手で行う。
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARTICLES_ROOT, emailFromIdent, findLeaks, isNoreplyEmail, planSnapshot, RELEASE_TAG } from './public-snapshot';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// 途中で止めても一時フォルダの後始末（finally）が走るよう、exit ではなく例外で抜ける。
class ReleaseAborted extends Error {}

function fail(message: string): never {
  throw new ReleaseAborted(message);
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(root, absolute) : [path.relative(root, absolute).split(path.sep).join('/')];
  }));
  return nested.flat();
}

const readFrom = (root: string, files: Map<string, string>) => (file: string) => {
  const content = files.get(file);
  if (content === undefined) throw new Error(`${path.join(root, file)} を読めていません`);
  return content;
};

async function readIndexes(root: string, paths: string[]): Promise<Map<string, string>> {
  const indexes = paths.filter((file) => file.startsWith(`${ARTICLES_ROOT}/`) && file.endsWith('/index.mdx'));
  return new Map(await Promise.all(indexes.map(async (file) => [file, await readFile(path.join(root, file), 'utf8')] as const)));
}

async function main(): Promise<void> {
  const [tag, publicArg] = process.argv.slice(2);
  if (!tag || !publicArg) fail('使い方: pnpm run release:public <タグ (例: v0.3.0)> <公開用リポジトリのフォルダ>');
  // 任意のコミットではなくタグに限るのは、どの時点を公開したかを非公開側に残すため。
  if (!RELEASE_TAG.test(tag)) fail(`タグは vX.Y.Z の形で指定してください: ${tag}`);

  const privateRoot = await realpath(git(process.cwd(), 'rev-parse', '--show-toplevel'));
  let commit: string;
  try {
    commit = git(privateRoot, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
  } catch {
    fail(`非公開リポジトリにタグ ${tag} がありません`);
  }

  // macOS の /tmp → /private/tmp のような別名があっても、git が返す直下パスと比べられるよう実体パスにそろえる。
  let publicRoot: string;
  let publicTop: string;
  try {
    publicRoot = await realpath(path.resolve(publicArg));
    publicTop = await realpath(git(publicRoot, 'rev-parse', '--show-toplevel'));
  } catch {
    fail(`${path.resolve(publicArg)} はgitリポジトリではありません`);
  }
  if (publicTop !== publicRoot) fail(`${publicRoot} は公開用リポジトリの直下ではありません`);
  if (publicRoot === privateRoot) fail('公開用リポジトリに非公開リポジトリ自身が指定されています');
  // 作業途中の変更があると、それもリリースのコミットに混ざる。
  if (git(publicRoot, 'status', '--porcelain')) fail(`${publicRoot} に未コミットの変更があります`);
  if (git(publicRoot, 'tag', '--list', tag)) fail(`公開用リポジトリには既にタグ ${tag} があります`);

  // コミットとタグに実際に書かれるアドレスを確かめる。git config だけでなく環境変数の上書きも反映される。
  for (const identity of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const email = emailFromIdent(git(publicRoot, 'var', identity)) ?? '';
    if (!isNoreplyEmail(email)) fail(`公開側の ${identity} が非公開用アドレスではありません。@users.noreply.github.com のアドレスを設定してください`);
  }

  // git archive はそのコミットに入っているファイルしか取り出さない。
  // 非公開側の作業ツリーにある未コミット・未追跡の下書きは、仕組み上ここに入らない。
  const staging = await mkdtemp(path.join(tmpdir(), 'niwa-release-'));
  try {
    const archive = path.join(staging, 'snapshot.tar');
    const tree = path.join(staging, 'tree');
    git(privateRoot, 'archive', '--format=tar', `--output=${archive}`, '--prefix=tree/', commit);
    execFileSync('tar', ['-xf', archive, '-C', staging]);

    const paths = await listFiles(tree);
    const plan = planSnapshot(paths, readFrom(tree, await readIndexes(tree, paths)));
    if (!plan.ok) fail(`下書きを判定できないため中止しました\n  ${plan.errors.join('\n  ')}`);

    for (const folder of plan.removeFolders) await rm(path.join(tree, ARTICLES_ROOT, folder), { recursive: true });

    const remaining = await listFiles(tree);
    const stagedLeaks = findLeaks(remaining, readFrom(tree, await readIndexes(tree, remaining)));
    if (stagedLeaks.length) fail(`除外後のツリーに下書きが残っているため中止しました\n  ${stagedLeaks.join('\n  ')}`);

    // 追跡中のファイルだけを消して入れ替える。node_modules や dist のような無視対象は残し、
    // リリースのたびに依存を入れ直さずに済むようにする。
    git(publicRoot, 'rm', '-r', '-q', '--ignore-unmatch', '.');
    for (const entry of await readdir(tree)) await cp(path.join(tree, entry), path.join(publicRoot, entry), { recursive: true });
    git(publicRoot, 'add', '-A');

    // 実際にコミットされるのは公開側のインデックスにある内容なので、判定をそこでもう一度行う。
    const committed = git(publicRoot, 'ls-files').split('\n').filter(Boolean);
    const committedLeaks = findLeaks(committed, readFrom(publicRoot, await readIndexes(publicRoot, committed)));
    if (committedLeaks.length) {
      fail(`公開側のインデックスに下書きが残っているためコミットしませんでした。確認後 git -C ${publicRoot} reset --hard で戻してください\n  ${committedLeaks.join('\n  ')}`);
    }
    if (!git(publicRoot, 'status', '--porcelain')) fail(`公開側に変更がありません（${tag} は既に同じ内容で公開済みです）`);

    git(publicRoot, 'commit', '-q', '-m', `Release ${tag}`, '-m', `非公開リポジトリの ${tag}（${commit.slice(0, 7)}）から、下書き記事を除いて作成。`);
    git(publicRoot, 'tag', '-a', tag, '-m', `Release ${tag}`);

    console.log(`公開用リポジトリに ${tag} をコミットしました（pushはしていません）`);
    console.log(`  除外した下書き: ${plan.removeFolders.join(', ') || 'なし'}`);
    console.log(`  例外として残した下書き: ${plan.keptDrafts.join(', ') || 'なし'}`);
    console.log(`  公開記事: ${plan.publishedFolders.join(', ') || 'なし'}`);
    console.log('');
    console.log('差分を確認してから、手でpushしてください:');
    console.log(`  git -C ${publicRoot} show --stat ${tag}`);
    console.log(`  git -C ${publicRoot} push origin HEAD --follow-tags`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof ReleaseAborted)) throw error;
  console.error(`release:public: ${error.message}`);
  process.exitCode = 1;
}
