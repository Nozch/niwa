/**
 * 検索パレットの「判定」だけを集めた場所。svelte / DOM / Pagefind の実体に依存しないので、
 * ブラウザを起動せずテストから直接呼べる（検索関数は引数で差し替える）。
 *
 * ここが守る不変条件は2つ。
 *   1. 古いクエリの応答は、新しいクエリが走り始めた時点で捨てる（後から表示を上書きさせない）。
 *   2. 選択位置は常に「有効な添字」か「選択なし(null)」のどちらかで、その中間の値を取らない。
 */

export type SearchData = {
  url: string;
  meta: { title?: string; description?: string; tags?: string };
  excerpt: string;
};

/** Pagefind から取り寄せる件数の上限。タグで絞る前の母数。 */
export const MAX_FETCHED = 24;
/** タグで絞ったあと実際に表示する件数の上限。 */
export const MAX_RESULTS = 12;

/**
 * 結果件数に対して選択位置を有効な範囲へ収める。件数0なら「選択なし」。
 * 絞り込みで件数が減ったとき、範囲外を指したままにしないために使う。
 */
export function clampSelection(selected: number | null, count: number): number | null {
  if (count <= 0) return null;
  if (selected === null) return 0;
  return Math.min(Math.max(selected, 0), count - 1);
}

/**
 * ↑↓ による選択の移動。件数0なら「選択なし」のまま動かさない
 * （ここを Math.min(count - 1, selected + 1) で計算すると0件のとき -1 になる）。
 * 端では止まり、循環はしない（従来のキー操作を変えないため）。
 */
export function moveSelection(selected: number | null, count: number, delta: number): number | null {
  if (count <= 0) return null;
  if (selected === null) return delta > 0 ? 0 : count - 1;
  return Math.min(Math.max(selected + delta, 0), count - 1);
}

/** 選択中の結果を返す。選択なし・範囲外なら undefined（Enter を無効化するための入口）。 */
export function selectedResult(results: SearchData[], selected: number | null): SearchData | undefined {
  if (selected === null) return undefined;
  return results[selected];
}

/**
 * 有効タグをすべて含む結果だけを残す（AND条件）。meta.tags は Pagefind が
 * カンマ区切りの1文字列として返すので、ここで配列に戻して突き合わせる。
 */
export function filterByTags(results: SearchData[], activeTags: Iterable<string>): SearchData[] {
  const required = [...activeTags];
  return results
    .filter((result) => {
      const resultTags = (result.meta.tags ?? '').split(',').map((tag) => tag.trim());
      return required.every((tag) => resultTags.includes(tag));
    })
    .slice(0, MAX_RESULTS);
}

/**
 * 検索1回分の結果。
 * - applied: 最新のクエリの応答。表示に反映してよい。
 * - failed:  最新のクエリが失敗した。ローディングを解いて失敗を伝える。
 * - stale:   走り始めた後に別のクエリが始まっている。表示には一切触れない。
 */
export type SearchOutcome =
  | { status: 'applied'; results: SearchData[] }
  | { status: 'failed' }
  | { status: 'stale' };

export interface SearchSession {
  run(query: string, activeTags: Iterable<string>): Promise<SearchOutcome>;
  /** 実行中の検索の応答を捨てる（入力を消した / パレットを閉じたとき）。 */
  reset(): void;
}

/**
 * 応答の採否を世代番号で決めるセッション。run のたびに世代を進め、
 * 応答が返った時点で世代が変わっていたら stale として捨てる。
 * 失敗も同じ判定を通すので、古いクエリの失敗が新しい結果を消すことはない。
 */
export function createSearchSession(
  fetchResults: (query: string) => Promise<SearchData[]>,
): SearchSession {
  let generation = 0;

  return {
    reset() {
      generation += 1;
    },

    async run(query, activeTags) {
      const current = ++generation;
      try {
        const fetched = await fetchResults(query);
        if (current !== generation) return { status: 'stale' };
        return { status: 'applied', results: filterByTags(fetched, activeTags) };
      } catch {
        if (current !== generation) return { status: 'stale' };
        return { status: 'failed' };
      }
    },
  };
}
