/**
 * 検索パレットの判定の安全網。
 *
 * ここで固定したいのは2つの不変条件。
 *   1. 古いクエリの応答は、新しいクエリが走り始めた時点で捨てる。
 *   2. 選択位置は常に「有効な添字」か「選択なし(null)」で、その中間の値を取らない。
 *
 * ARIA属性とフォーカスの復帰・閉じ込めはDOMが要るのでここでは扱わず、build + preview 上の手動確認で担保する。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_RESULTS,
  clampSelection,
  createSearchSession,
  filterByTags,
  moveSelection,
  selectedResult,
  type SearchData,
} from '../src/lib/search-palette';

function note(url: string, tags: string[] = []): SearchData {
  return { url, meta: { title: url, tags: tags.join(', ') }, excerpt: '' };
}

/** 解決のタイミングをテストから決められる Promise（応答の追い越しを作るために使う）。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('選択位置のクランプ', () => {
  it('結果0件なら選択なしになる', () => {
    expect(clampSelection(0, 0)).toBeNull();
    expect(clampSelection(3, 0)).toBeNull();
    expect(clampSelection(null, 0)).toBeNull();
  });

  it('選択なしから件数があれば先頭を選ぶ', () => {
    expect(clampSelection(null, 5)).toBe(0);
  });

  it('件数が減っても範囲外を指したままにならない', () => {
    expect(clampSelection(9, 3)).toBe(2);
    expect(clampSelection(2, 3)).toBe(2);
  });

  it('負の値を渡されても先頭へ戻す', () => {
    expect(clampSelection(-1, 3)).toBe(0);
  });
});

describe('↑↓による選択の移動', () => {
  it('結果0件では選択位置が負にならない', () => {
    // 旧実装の Math.min(count - 1, selected + 1) はここで -1 を返していた。
    expect(moveSelection(0, 0, 1)).toBeNull();
    expect(moveSelection(null, 0, 1)).toBeNull();
    expect(moveSelection(null, 0, -1)).toBeNull();
  });

  it('選択なしから下へ動かすと先頭、上へ動かすと末尾を選ぶ', () => {
    expect(moveSelection(null, 4, 1)).toBe(0);
    expect(moveSelection(null, 4, -1)).toBe(3);
  });

  it('端では止まり循環しない', () => {
    expect(moveSelection(0, 4, -1)).toBe(0);
    expect(moveSelection(3, 4, 1)).toBe(3);
  });

  it('範囲内では1つずつ動く', () => {
    expect(moveSelection(1, 4, 1)).toBe(2);
    expect(moveSelection(1, 4, -1)).toBe(0);
  });
});

describe('選択中の結果の取り出し', () => {
  const results = [note('/a/'), note('/b/')];

  it('選択なしなら undefined（Enterで何も起きない）', () => {
    expect(selectedResult(results, null)).toBeUndefined();
  });

  it('結果が空なら undefined', () => {
    expect(selectedResult([], 0)).toBeUndefined();
  });

  it('範囲外なら undefined', () => {
    expect(selectedResult(results, 5)).toBeUndefined();
  });

  it('選択中の結果を返す', () => {
    expect(selectedResult(results, 1)?.url).toBe('/b/');
  });
});

describe('タグによる絞り込み', () => {
  const results = [
    note('/a/', ['雑記', '読書']),
    note('/b/', ['読書']),
    note('/c/', []),
  ];

  it('タグ未選択なら全件残る', () => {
    expect(filterByTags(results, []).map((r) => r.url)).toEqual(['/a/', '/b/', '/c/']);
  });

  it('複数タグはAND条件になる', () => {
    expect(filterByTags(results, ['雑記', '読書']).map((r) => r.url)).toEqual(['/a/']);
  });

  it('タグが空の結果は絞り込みで落ちる', () => {
    expect(filterByTags(results, ['読書']).map((r) => r.url)).toEqual(['/a/', '/b/']);
  });

  it('meta.tags が無い結果でも例外にならない', () => {
    const noMeta: SearchData = { url: '/d/', meta: {}, excerpt: '' };
    expect(filterByTags([noMeta], [])).toHaveLength(1);
    expect(filterByTags([noMeta], ['読書'])).toHaveLength(0);
  });

  it('表示件数の上限で打ち切る', () => {
    const many = Array.from({ length: 24 }, (_, i) => note(`/n${i}/`));
    expect(filterByTags(many, [])).toHaveLength(MAX_RESULTS);
  });
});

describe('検索セッションの世代管理', () => {
  it('先行クエリの応答が後から届いても捨てられる', async () => {
    const first = deferred<SearchData[]>();
    const second = deferred<SearchData[]>();
    const pending = [first, second];
    const session = createSearchSession(() => pending.shift()!.promise);

    const firstRun = session.run('あ', []);
    const secondRun = session.run('あい', []);

    // 後から始めた方が先に返る。
    second.resolve([note('/new/')]);
    await expect(secondRun).resolves.toEqual({ status: 'applied', results: [note('/new/')] });

    // 遅れて返ってきた先行クエリは表示に触れない。
    first.resolve([note('/old/')]);
    await expect(firstRun).resolves.toEqual({ status: 'stale' });
  });

  it('最新クエリの応答は必ず反映される', async () => {
    const session = createSearchSession(async (query) => [note(`/${query}/`)]);
    await session.run('あ', []);
    await expect(session.run('あい', [])).resolves.toEqual({
      status: 'applied',
      results: [note('/あい/')],
    });
  });

  it('先行クエリの失敗が新しい結果を消さない', async () => {
    const failing = deferred<SearchData[]>();
    const pending = [failing, deferred<SearchData[]>()];
    pending[1].resolve([note('/new/')]);
    const session = createSearchSession(() => pending.shift()!.promise);

    const firstRun = session.run('あ', []);
    await session.run('あい', []);

    failing.reject(new Error('検索に失敗'));
    // failed ではなく stale。表示中の新しい結果はそのまま。
    await expect(firstRun).resolves.toEqual({ status: 'stale' });
  });

  it('最新クエリが失敗したら failed を返す（ローディングを解く手掛かり）', async () => {
    const session = createSearchSession(async () => {
      throw new Error('索引が壊れている');
    });
    await expect(session.run('あ', [])).resolves.toEqual({ status: 'failed' });
  });

  it('失敗した後も次の検索は走る', async () => {
    let shouldFail = true;
    const session = createSearchSession(async (query) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('一時的な失敗');
      }
      return [note(`/${query}/`)];
    });

    await expect(session.run('あ', [])).resolves.toEqual({ status: 'failed' });
    await expect(session.run('あい', [])).resolves.toEqual({
      status: 'applied',
      results: [note('/あい/')],
    });
  });

  it('reset すると実行中の検索の応答を捨てる（入力を消す・閉じる）', async () => {
    const inflight = deferred<SearchData[]>();
    const session = createSearchSession(() => inflight.promise);

    const run = session.run('あ', []);
    session.reset();
    inflight.resolve([note('/late/')]);

    await expect(run).resolves.toEqual({ status: 'stale' });
  });

  it('応答にタグの絞り込みが適用される', async () => {
    const session = createSearchSession(async () => [
      note('/a/', ['雑記', '読書']),
      note('/b/', ['読書']),
    ]);
    await expect(session.run('あ', ['雑記'])).resolves.toEqual({
      status: 'applied',
      results: [note('/a/', ['雑記', '読書'])],
    });
  });
});
