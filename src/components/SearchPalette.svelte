<script lang="ts">
  import { flushSync } from 'svelte';
  import {
    clampSelection,
    createSearchSession,
    moveSelection,
    selectedResult,
    MAX_FETCHED,
    type SearchData,
  } from '@/lib/search-palette';

  export let tags: string[] = [];

  type SearchResult = { data: () => Promise<SearchData> };
  type Pagefind = { search: (query: string) => Promise<{ results: SearchResult[] }> };

  // combobox は aria-controls / aria-activedescendant で listbox と option を id で指すので、
  // 参照先が一意に決まるよう固定の接頭辞から組み立てる。
  const LISTBOX_ID = 'niwa-search-listbox';
  const optionId = (index: number) => `niwa-search-option-${index}`;
  // フォーカスをパレット内に閉じ込めるための対象。
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let open = false;
  let query = '';
  let loading = false;
  let unavailable = false;
  let failed = false;
  let results: SearchData[] = [];
  let selected: number | null = null;
  let activeTags = new Set<string>();
  let input: HTMLInputElement;
  let palette: HTMLElement;
  let pagefind: Pagefind | undefined;
  // 開く前にフォーカスがあった要素。閉じたときにここへ戻す。
  let lastFocused: HTMLElement | null = null;

  // 表示中のメッセージとは別に、状態を1文にまとめて読み上げへ渡す。
  // listbox 自体に aria-live を載せるとリスト全体が読み上げ直されるため兼用しない。
  $: statusMessage = unavailable
    ? '検索索引が利用できません'
    : failed
      ? '検索に失敗しました'
      : loading
        ? '検索中'
        : !query
          ? ''
          : results.length === 0
            ? '該当するノートはありません'
            : `${results.length} 件見つかりました`;

  async function loadPagefind() {
    if (pagefind || unavailable) return;
    try {
      const path = '/pagefind/pagefind.js';
      pagefind = (await import(/* @vite-ignore */ path)) as Pagefind;
    } catch {
      unavailable = true;
    }
  }

  // 実際の検索。ここが失敗しても session が握りつぶさず failed として返す。
  const session = createSearchSession(async (text) => {
    if (!pagefind) throw new Error('検索索引が読み込まれていません');
    const response = await pagefind.search(text);
    return Promise.all(response.results.slice(0, MAX_FETCHED).map((result) => result.data()));
  });

  async function show() {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open = true;
    activeTags = new Set(new URL(location.href).searchParams.getAll('tag'));
    await loadPagefind();
    // 入力欄がDOMに現れてから focus する。requestAnimationFrame は
    // タブが背面のとき進まないので使わず、描画を明示的に流し切ってから focus する。
    flushSync();
    input?.focus();
  }

  function hide() {
    const restore = lastFocused;
    lastFocused = null;
    const fallback = document.querySelector<HTMLElement>('[data-open-search]');
    // 開く前の要素が既に消えていることもあるので、その場合は検索ボタンへ返す。
    const target = restore?.isConnected ? restore : fallback;
    // 閉じる前に戻す。閉じてから戻すと、一度 body へ落ちたフォーカスを
    // 描画のタイミングを待って拾い直すことになり、復帰が確実でなくなる。
    target?.focus();
    open = false;
    // 閉じた後に実行中の検索が結果を差し込まないようにする。
    session.reset();
    loading = false;
  }

  async function search() {
    if (!query.trim() || !pagefind) {
      // 打った後に消した場合、走っている検索の応答が後から入り込まないよう世代を進める。
      session.reset();
      loading = false;
      failed = false;
      results = [];
      selected = null;
      return;
    }
    loading = true;
    failed = false;
    const outcome = await session.run(query.trim(), activeTags);
    // 追い越された応答。新しい検索が表示を持っているので触らない。
    if (outcome.status === 'stale') return;
    loading = false;
    if (outcome.status === 'failed') {
      failed = true;
      results = [];
      selected = null;
      return;
    }
    results = outcome.results;
    // 新しいクエリなので先頭へ。0件なら選択なし。
    selected = clampSelection(0, results.length);
  }

  function toggleTag(tag: string) {
    const next = new Set(activeTags);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    activeTags = next;
    void search();
  }

  // Tab がパレットの端に来たら反対の端へ折り返し、背後のページへ抜けさせない。
  function trapFocus(event: KeyboardEvent) {
    if (!palette) return;
    const targets = [...palette.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (targets.length === 0) return;
    const first = targets[0];
    const last = targets[targets.length - 1];
    const active = document.activeElement;
    const outside = !palette.contains(active);
    if (event.shiftKey ? active === first || outside : active === last || outside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  function onWindowKey(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open ? hide() : void show();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') { hide(); return; }
    if (event.key === 'Tab') { trapFocus(event); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); selected = moveSelection(selected, results.length, 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); selected = moveSelection(selected, results.length, -1); }
    if (event.key === 'Enter') {
      const target = selectedResult(results, selected);
      if (target) location.href = target.url;
    }
  }

  function plainExcerpt(html: string) {
    return html.replace(/<[^>]+>/g, '').replaceAll('&hellip;', '…');
  }
</script>

<svelte:window onkeydown={onWindowKey} on:niwa:search={show} />

{#if open}
  <div class="overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && hide()}>
    <section bind:this={palette} class="palette" role="dialog" aria-modal="true" aria-label="記事検索">
      <div class="input-row">
        <span class="glass" aria-hidden="true"></span>
        <input
          bind:this={input}
          bind:value={query}
          oninput={search}
          placeholder="ノートを探す…"
          aria-label="検索語"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={selected === null ? undefined : optionId(selected)}
        />
        <kbd>esc</kbd>
      </div>
      {#if tags.length > 0}
        <div class="tag-row">
          <span>タグで絞る</span>
          {#each tags as tag}
            <button type="button" class:active-tag={activeTags.has(tag)} aria-pressed={activeTags.has(tag)} onclick={() => toggleTag(tag)}>
              {#if activeTags.has(tag)}<i></i>{/if}＃{tag}
            </button>
          {/each}
        </div>
      {/if}
      <div class="results">
        {#if unavailable}
          <p class="message">検索索引はbuild後のpreviewで利用できます。</p>
        {:else if failed}
          <p class="message">検索に失敗しました。もう一度お試しください。</p>
        {:else if loading}
          <p class="message">探しています…</p>
        {:else if query && results.length === 0}
          <p class="message">該当するノートはありません。</p>
        {:else if !query}
          <p class="message">タイトル、本文、タグから検索します。</p>
        {/if}
        <!-- aria-controls の参照先が消えないよう、0件でも listbox は置いたままにする。 -->
        <div id={LISTBOX_ID} role="listbox" aria-label="検索結果">
          {#each results as result, index}
            <a
              id={optionId(index)}
              role="option"
              aria-selected={index === selected}
              href={result.url}
              class:active={index === selected}
              onmouseenter={() => selected = index}
            >
              <span class="dot"></span>
              <span class="result-copy">
                <strong>{result.meta.title ?? '名称未設定'}</strong>
                <small>{result.meta.description ?? plainExcerpt(result.excerpt)}</small>
              </span>
            </a>
          {/each}
        </div>
      </div>
      <p class="sr-only" aria-live="polite">{statusMessage}</p>
      <footer>↑↓ 移動 ・ ↵ 開く ・ esc 閉じる <span>{results.length} 件</span></footer>
    </section>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; z-index: 50; display: flex; justify-content: center; align-items: flex-start; padding-top: 13vh; background: rgba(247,243,235,.68); backdrop-filter: blur(3px); }
  .palette { width: min(620px, 92vw); overflow: hidden; border: 1px solid rgba(120,110,85,.18); border-radius: 16px; background: var(--card); box-shadow: 0 30px 70px -24px rgba(60,54,38,.5); }
  .input-row { display: flex; align-items: center; gap: 13px; padding: 19px 22px; border-bottom: 1px solid var(--line); }
  .glass { width: 17px; height: 17px; border: 2px solid var(--ink-soft); border-radius: 50%; }
  input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: var(--text-lg); }
  .tag-row { display: flex; align-items: center; gap: 7px; padding: 13px 22px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .tag-row > span { color: var(--faint); font-size: var(--text-xs); letter-spacing: .08em; }
  .tag-row button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 20px; padding: 3px 11px; color: var(--ink-soft); background: transparent; cursor: pointer; font-size: var(--text-sm); }
  .tag-row button.active-tag { color: var(--ink); border-color: var(--accent-border); background: var(--glass); }
  .tag-row i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: var(--dot-glow); }
  .results { max-height: 46vh; min-height: 100px; overflow-y: auto; padding: 8px; }
  .results a { display: flex; align-items: center; gap: 13px; padding: 12px 14px; border: 1px solid transparent; border-radius: 10px; text-decoration: none; }
  .results a.active { border-color: var(--accent-border); background: var(--glass); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: var(--dot-glow); }
  .result-copy { display: grid; min-width: 0; gap: 2px; }
  strong { overflow: hidden; color: var(--ink); font: 600 var(--text-md) 'Klee One', cursive; text-overflow: ellipsis; white-space: nowrap; }
  small { overflow: hidden; color: var(--ink-soft); font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
  .message { padding: 28px 10px; text-align: center; color: var(--faint); font-size: var(--text-sm); }
  /* 読み上げ専用。表示には出さないが display:none と違い読み上げからは消えない。 */
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  footer { display: flex; justify-content: space-between; padding: 12px 22px; border-top: 1px solid var(--line); color: var(--faint); font-size: var(--text-xs); }
</style>
