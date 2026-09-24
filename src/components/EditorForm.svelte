<script lang="ts">
  import { onMount } from 'svelte';
  import ChipInput from './ChipInput.svelte';
  import { formatDate } from '../lib/articles';

  export let mode: 'edit' | 'create' = 'edit';
  export let dir = '';
  // ピッカー用の既存データ（Astro ページから props で渡す）
  export let articles: { id: string; title: string; kind: 'diary' | 'project' }[] = [];
  export let allTags: string[] = [];
  export let allCategories: string[] = [];
  export let allSeries: string[] = [];
  export let ownedVisuals: { id: string; title: string }[] = [];

  type Issue = { path: (string | number)[]; message: string };

  let loading = mode === 'edit';
  let loadError = '';
  let saving = false;
  let saveMessage = '';
  let issues: Issue[] = [];
  let showResetDialog = false;

  // 編集不可のメタ（サーバーから受け取りそのまま書き戻す）
  let schemaVersion = 1;
  let id = '';

  // frontmatter フィールド
  let kind: 'diary' | 'project' = 'diary';
  let title = '';
  let description = '';
  let slug = '';
  let draft = true;
  let createdAt = '';
  let publishedAt = '';
  let updatedAt = '';
  let tags: string[] = [];
  let categories: string[] = [];
  let series: string[] = [];
  let visuals: string[] = [];
  let related: string[] = [];
  let stage: 'seed' | 'growing' | 'complete' = 'seed';
  let progress = 0;
  let body = '';
  let showDateEditor = false;

  const stages = ['seed', 'growing', 'complete'] as const;
  const asArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

  const pad = (n: number) => String(n).padStart(2, '0');
  function offsetSuffix(d: Date): string {
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    return `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  }
  // ブラウザのローカルタイムゾーン付き ISO（例: 2026-07-11T19:30:00+09:00）。schema の offset 必須を満たす。
  function nowIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetSuffix(d)}`;
  }
  // ISO(オフセット付き) ↔ datetime-local("YYYY-MM-DDTHH:mm") の相互変換。壁時計の時刻を保つ。
  const isoToLocal = (iso: string): string => (iso ? iso.slice(0, 16) : '');
  function localToIso(local: string): string {
    if (!local) return '';
    return `${local}:00${offsetSuffix(new Date(local))}`;
  }

  function toggleId(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  onMount(async () => {
    if (mode === 'create') {
      createdAt = nowIso();
      // 一覧でサイドバー絞り込み中に新規作成した場合、その種別・タグを引き継ぐ。
      const params = new URLSearchParams(location.search);
      const presetKind = params.get('kind');
      if (presetKind === 'diary' || presetKind === 'project') kind = presetKind;
      const presetTags = params.getAll('tag').map((tag) => tag.trim()).filter(Boolean);
      if (presetTags.length) tags = presetTags;
      return;
    }
    if (mode !== 'edit') return;
    try {
      const res = await fetch(`/editor/api/articles/${encodeURIComponent(dir)}`);
      if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
      const { data, body: loadedBody } = await res.json();
      schemaVersion = data.schemaVersion ?? 1;
      id = data.id ?? '';
      kind = data.kind ?? 'diary';
      title = data.title ?? '';
      description = data.description ?? '';
      slug = data.slug ?? '';
      draft = Boolean(data.draft);
      createdAt = data.createdAt ?? '';
      publishedAt = data.publishedAt ?? '';
      updatedAt = data.updatedAt ?? '';
      tags = asArray(data.tags);
      categories = asArray(data.categories);
      series = asArray(data.series);
      visuals = asArray(data.visuals);
      related = asArray(data.related);
      stage = data.stage ?? 'seed';
      progress = Number(data.progress ?? 0);
      body = loadedBody ?? '';
    } catch (error) {
      loadError = String(error);
    } finally {
      loading = false;
    }
  });

  function buildData(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      schemaVersion,
      id,
      title,
      description,
      kind,
      draft,
      createdAt,
      tags,
      categories,
      series,
      visuals,
      related,
    };
    if (slug.trim()) data.slug = slug.trim();
    if (publishedAt.trim()) data.publishedAt = publishedAt.trim();
    if (updatedAt.trim()) data.updatedAt = updatedAt.trim();
    if (kind === 'project') {
      data.stage = stage;
      data.progress = Number(progress);
    }
    return data;
  }

  // 新規作成のPOST。成功なら作成された slug、失敗（検証エラー等）なら null を返す。
  // 遷移やクリアといった副作用は呼び出し側に任せる。
  async function postCreate(forceDraft: boolean): Promise<string | null> {
    const data = buildData();
    delete data.slug; // slug はフォルダ名として別送する
    if (forceDraft) data.draft = true;
    const res = await fetch('/editor/api/articles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: slug.trim(), data, body }),
    });
    const result = await res.json();
    if (res.status === 422) {
      issues = result.issues ?? [];
      saveMessage = '検証エラーがあります。修正してください。';
      return null;
    }
    if (!res.ok) {
      saveMessage = `作成に失敗しました: ${result.error ?? res.status}`;
      return null;
    }
    return result.slug as string;
  }

  // 全項目を新規作成の初期状態へ戻す。URLのプリセット(?kind=&tag=)も落とす。
  function clearForm() {
    kind = 'diary';
    title = '';
    description = '';
    slug = '';
    draft = true;
    createdAt = nowIso();
    publishedAt = '';
    updatedAt = '';
    tags = [];
    categories = [];
    series = [];
    visuals = [];
    related = [];
    stage = 'seed';
    progress = 0;
    body = '';
    showDateEditor = false;
    issues = [];
    history.replaceState(null, '', '/editor/new');
  }

  function onResetClick() {
    saveMessage = '';
    if (!dirty) {
      clearForm();
      return;
    }
    showResetDialog = true;
  }

  async function resetSaveThenClear() {
    saving = true;
    issues = [];
    try {
      const created = await postCreate(true);
      showResetDialog = false;
      if (created) {
        clearForm();
        // 成功メッセージは await 継続内で直接代入すると experimental async 下で
        // 反映されないことがあるため、次のタスクで（onMount 相当の文脈で）設定する。
        const message = `下書き「${created}」を保存してリセットしました。`;
        setTimeout(() => (saveMessage = message), 0);
      }
      // created が null のとき（検証エラー等）はクリアせず、フォーム上のエラーを表示。
    } catch (error) {
      showResetDialog = false;
      saveMessage = `保存に失敗しました: ${String(error)}`;
    } finally {
      saving = false;
    }
  }

  function resetDiscard() {
    showResetDialog = false;
    clearForm();
    saveMessage = '入力をリセットしました。';
  }

  async function save() {
    saving = true;
    saveMessage = '';
    issues = [];
    try {
      if (mode === 'create') {
        const created = await postCreate(false);
        if (created) {
          // 作成後は編集ページへ遷移して続けて書けるようにする。
          window.location.href = `/editor/${created}/edit`;
        }
        return;
      }

      const res = await fetch(`/editor/api/articles/${encodeURIComponent(dir)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: buildData(), body }),
      });
      const result = await res.json();
      if (res.status === 422) {
        issues = result.issues ?? [];
        saveMessage = '検証エラーがあります。修正してください。';
      } else if (!res.ok) {
        saveMessage = `保存に失敗しました: ${result.error ?? res.status}`;
      } else {
        saveMessage = '保存しました。';
      }
    } catch (error) {
      saveMessage = `保存に失敗しました: ${String(error)}`;
    } finally {
      saving = false;
    }
  }

  $: issueFor = (field: string) => issues.filter((issue) => issue.path?.[0] === field);
  $: dirty = Boolean(title || description || slug || body || tags.length || categories.length || series.length || visuals.length || related.length);
  $: relatedCandidates = articles.filter((article) => article.id !== id);
</script>

{#if loading}
  <p>読み込み中…</p>
{:else if loadError}
  <p class="error">{loadError}</p>
{:else}
  <form class="editor-form" on:submit|preventDefault={save}>
    <!-- 書く -->
    <section class="write">
      <input class="title-input" type="text" bind:value={title} placeholder="無題" aria-label="タイトル" />
      {#each issueFor('title') as issue}<small class="error">{issue.message}</small>{/each}
      <input class="desc-input" type="text" bind:value={description} placeholder="ひとことで言うと？" aria-label="説明" />
      {#each issueFor('description') as issue}<small class="error">{issue.message}</small>{/each}
      <textarea class="body-input" rows="16" bind:value={body} placeholder="ここに本文を書く（MDX）…" aria-label="本文"></textarea>
    </section>

    <!-- 整える -->
    <section class="arrange">
      <h2 class="arrange-title">整える</h2>

      <div class="row">
        <div class="pills" role="group" aria-label="種別">
          <button type="button" class="pill" class:active={kind === 'diary'} on:click={() => (kind = 'diary')}>日記</button>
          <button type="button" class="pill" class:active={kind === 'project'} on:click={() => (kind = 'project')}>作りかけ</button>
        </div>
        <label class="toggle"><input type="checkbox" bind:checked={draft} /><span class="box" aria-hidden="true"></span><span>下書き</span></label>
      </div>

      {#if kind === 'project'}
        <div class="row">
          <div class="mini-field">
            <span class="mini-label">段階</span>
            <div class="pills">
              {#each stages as s}
                <button type="button" class="pill" class:active={stage === s} on:click={() => (stage = s)}>{s}</button>
              {/each}
            </div>
          </div>
          <div class="mini-field grow">
            <span class="mini-label">進捗 {progress}%</span>
            <input type="range" min="0" max="100" bind:value={progress} style={`--fill:${progress}%`} />
          </div>
        </div>
        {#each issueFor('progress') as issue}<small class="error">{issue.message}</small>{/each}
      {/if}

      <div class="mini-field">
        <span class="mini-label">{mode === 'create' ? 'slug（URL・必須）' : 'slug（省略時はフォルダ名）'}</span>
        <input class="line-input" type="text" bind:value={slug} placeholder={mode === 'create' ? 'my-first-note' : dir} />
        {#each issueFor('slug') as issue}<small class="error">{issue.message}</small>{/each}
      </div>

      <div class="mini-field">
        <span class="mini-label">日付</span>
        <div class="dates">
          <span class="date-read">作成 {createdAt ? formatDate(createdAt) : '—'}</span>
          {#if publishedAt}<span class="date-read">公開 {formatDate(publishedAt)}</span>{/if}
          {#if updatedAt}<span class="date-read">更新 {formatDate(updatedAt)}</span>{/if}
          <button type="button" class="link-btn" on:click={() => (showDateEditor = !showDateEditor)}>{showDateEditor ? '閉じる' : '変更'}</button>
        </div>
        {#if showDateEditor}
          <div class="row date-editors">
            <div class="mini-field grow"><span class="mini-label">作成</span><input class="line-input" type="datetime-local" value={isoToLocal(createdAt)} on:change={(e) => (createdAt = localToIso(e.currentTarget.value))} /></div>
            <div class="mini-field grow"><span class="mini-label">公開（下書きは空）</span><input class="line-input" type="datetime-local" value={isoToLocal(publishedAt)} on:change={(e) => (publishedAt = localToIso(e.currentTarget.value))} /></div>
            <div class="mini-field grow"><span class="mini-label">更新</span><input class="line-input" type="datetime-local" value={isoToLocal(updatedAt)} on:change={(e) => (updatedAt = localToIso(e.currentTarget.value))} /></div>
          </div>
        {/if}
        {#each issueFor('createdAt') as issue}<small class="error">{issue.message}</small>{/each}
        {#each issueFor('publishedAt') as issue}<small class="error">{issue.message}</small>{/each}
        {#each issueFor('updatedAt') as issue}<small class="error">{issue.message}</small>{/each}
      </div>

      <ChipInput label="タグ" bind:values={tags} suggestions={allTags} />
      <ChipInput label="カテゴリ" bind:values={categories} suggestions={allCategories} />
      <ChipInput label="シリーズ" bind:values={series} suggestions={allSeries} />

      <div class="mini-field">
        <span class="mini-label">つながり（related）{related.length ? ` ・ ${related.length}` : ''}</span>
        {#if relatedCandidates.length}
          <div class="related-picker">
            {#each relatedCandidates as article}
              <button type="button" class="related-item" class:selected={related.includes(article.id)} on:click={() => (related = toggleId(related, article.id))}>
                <span class="ri-check" aria-hidden="true">{related.includes(article.id) ? '✓' : ''}</span>
                <span class="ri-title">{article.title}</span>
                <span class="ri-kind">{article.kind === 'diary' ? '日記' : '作りかけ'}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="hint">他に記事がありません。</p>
        {/if}
      </div>

      <div class="mini-field">
        <span class="mini-label">visuals</span>
        {#if ownedVisuals.length}
          <div class="chips">
            {#each ownedVisuals as v}
              <button type="button" class="chip" class:selected={visuals.includes(v.id)} on:click={() => (visuals = toggleId(visuals, v.id))}>{v.title}</button>
            {/each}
          </div>
        {:else}
          <p class="hint">この記事の visuals はまだありません（visuals/*.json を追加すると選べます）。</p>
        {/if}
      </div>
    </section>

    <div class="actions">
      <button type="submit" disabled={saving}>{saving ? (mode === 'create' ? '作成中…' : '保存中…') : mode === 'create' ? '作成' : '保存'}</button>
      {#if mode === 'create'}
        <button type="button" class="secondary" on:click={onResetClick} disabled={saving}>入力をリセット</button>
      {/if}
      {#if saveMessage}<span class="save-message" class:error={issues.length > 0}>{saveMessage}</span>{/if}
    </div>
  </form>

  {#if showResetDialog}
    <div class="reset-overlay" role="dialog" aria-modal="true" aria-label="入力リセットの確認">
      <div class="reset-dialog">
        <p>入力中の内容があります。下書きとして保存してからリセットしますか？</p>
        <div class="reset-actions">
          <button type="button" on:click={resetSaveThenClear} disabled={saving}>下書き保存してリセット</button>
          <button type="button" class="secondary" on:click={resetDiscard} disabled={saving}>破棄してリセット</button>
          <button type="button" class="ghost" on:click={() => (showResetDialog = false)} disabled={saving}>キャンセル</button>
        </div>
        <p class="reset-note">※ 下書き保存には slug・タイトル・説明・作成日時が必要です。</p>
      </div>
    </div>
  {/if}
{/if}

<style>
  .editor-form { display: flex; flex-direction: column; gap: 0.5rem; }

  /* 書く：タイトルと本文が主役 */
  .write { display: flex; flex-direction: column; gap: 0.4rem; }
  .title-input {
    font-family: 'Klee One', cursive; font-size: clamp(26px, 4vw, 32px); font-weight: 400;
    letter-spacing: .03em; line-height: 1.4; color: var(--ink);
    border: none; background: transparent; padding: 0.1rem 0; width: 100%;
  }
  .desc-input {
    font-size: var(--text-base); color: var(--ink-soft); line-height: 1.8;
    border: none; background: transparent; padding: 0.1rem 0; width: 100%;
  }
  .title-input::placeholder { color: var(--faint); }
  .desc-input::placeholder { color: var(--faint); }
  .body-input {
    margin-top: 0.6rem; min-height: 22rem; resize: vertical; width: 100%;
    font-family: 'Zen Kaku Gothic New', sans-serif; font-size: var(--text-base); line-height: 1.9; color: var(--ink);
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.4rem 1.5rem;
    box-shadow: 0 1px 2px rgba(70,66,47,.05), 0 6px 12px -10px rgba(70,66,47,.28);
  }
  .body-input::placeholder { color: var(--faint); }

  /* 整える：メタ情報。区切り線でなく余白で分離 */
  .arrange { margin-top: 2.6rem; display: flex; flex-direction: column; gap: 1rem; }
  .arrange-title { margin: 0; font-size: var(--text-lg); color: var(--ink-soft); }
  .row { display: flex; gap: 1.1rem; flex-wrap: wrap; align-items: center; }
  .mini-field { display: flex; flex-direction: column; gap: 0.3rem; }
  .mini-field.grow { flex: 1; min-width: 9rem; }
  .mini-label { font-size: var(--text-xs); color: var(--faint); letter-spacing: .04em; }

  /* 下線主体の控えめな入力（箱っぽさを消す） */
  .line-input {
    font: inherit; color: inherit; border: none; border-bottom: 1px solid var(--line);
    background: transparent; padding: 0.35rem 0.1rem; width: 100%;
  }
  .line-input:focus { outline: none; border-bottom-color: var(--accent-border); }
  .line-input::placeholder { color: var(--faint); }

  /* 文具的なピル（種別・段階） */
  .pills { display: inline-flex; gap: 4px; padding: 3px; background: var(--paper); border: 1px solid var(--line); border-radius: 999px; }
  .pill {
    font: inherit; font-size: var(--text-sm); cursor: pointer; border: none; border-radius: 999px;
    padding: 0.35rem 0.95rem; background: transparent; color: var(--ink-soft); box-shadow: none;
  }
  .pill.active { background: var(--glass); color: var(--ink); box-shadow: var(--chip-gloss), inset 0 0 0 1px var(--accent-border); }

  /* 文具的スキュモーフィズムのチェックボックス：外枠は常に紙の「溝」、チェック時は溝の中にミントのチェックを描く */
  .toggle { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--ink-soft); font-size: var(--text-sm); cursor: pointer; }
  .toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .toggle .box {
    width: 18px; height: 18px; flex-shrink: 0; border-radius: 5px; position: relative;
    background: linear-gradient(180deg, #faf6ee, #ece5d7);
    box-shadow: inset 0 1px 2px rgba(58,52,38,.22), inset 0 -1px 1px rgba(255,255,255,.6), 0 0 0 1px rgba(58,52,38,.08);
  }
  .toggle input:checked + .box {
    box-shadow: inset 0 1px 2px rgba(58,52,38,.22), inset 0 -1px 1px rgba(255,255,255,.6), 0 0 0 1px rgba(87,195,152,.55);
  }
  .toggle input:checked + .box::after {
    content: ''; position: absolute; left: 6px; top: 2.5px; width: 4px; height: 8px;
    border: solid var(--accent-ink); border-width: 0 2px 2px 0; transform: rotate(45deg);
  }
  .toggle input:focus-visible + .box { outline: 2px solid var(--focus); outline-offset: 2px; }

  /* スライダー(B)：紙のレール＋ミントの塗り＋白いビーズのつまみ */
  input[type='range'] {
    -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 6px; cursor: pointer;
    background: linear-gradient(90deg, var(--accent) 0 var(--fill, 0%), #e3dccf var(--fill, 0%) 100%);
    box-shadow: inset 0 1px 1.5px rgba(58,52,38,.18);
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, #fff, #efe9df);
    box-shadow: 0 1px 3px rgba(58,52,38,.3), inset 0 0 0 1px rgba(58,52,38,.08);
  }
  input[type='range']::-moz-range-track { height: 6px; border-radius: 6px; background: linear-gradient(90deg, var(--accent) 0 var(--fill, 0%), #e3dccf var(--fill, 0%) 100%); }
  input[type='range']::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(58,52,38,.3); }

  /* 日付：可読表示＋変更で詳細 */
  .dates { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; }
  .date-read { font-size: var(--text-sm); color: var(--ink-soft); }
  .link-btn { font: inherit; font-size: var(--text-sm); background: transparent; border: none; box-shadow: none; color: var(--accent-ink); cursor: pointer; padding: 0; }
  .date-editors { margin-top: 0.4rem; }

  /* チップ（visuals などの選択） */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font: inherit; font-size: var(--text-sm); cursor: pointer; border-radius: 999px;
    padding: 0.25rem 0.7rem; border: 1px dashed var(--line); background: transparent; color: var(--ink-soft); box-shadow: none;
  }
  .chip.selected { border-style: solid; border-color: var(--accent-border); background: var(--glass); color: var(--ink); box-shadow: var(--chip-gloss); }

  /* related ピッカー：既存記事から選ぶ */
  .related-picker { display: flex; flex-direction: column; gap: 3px; max-height: 15rem; overflow-y: auto; }
  .related-item {
    display: flex; align-items: center; gap: 0.6rem; text-align: left; width: 100%;
    font: inherit; cursor: pointer; background: transparent; border: none; box-shadow: none;
    padding: 0.5rem 0.55rem; border-radius: 8px; color: var(--ink);
  }
  .related-item:hover { background: rgba(125, 138, 92, .06); }
  .related-item.selected { background: var(--glass); box-shadow: inset 0 0 0 1px var(--accent-border); }
  .ri-check { width: 1rem; color: var(--accent-ink); }
  .ri-title { flex: 1; font-size: var(--text-md); }
  .ri-kind { font-size: var(--text-xs); color: var(--faint); }
  .hint { margin: 0; font-size: var(--text-sm); color: var(--faint); }

  .actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.6rem; flex-wrap: wrap; }
  /* 保存/作成ボタン(C)：ガラス地＋ミントの縁（チップと同系） */
  button { font: inherit; padding: 0.5rem 1.4rem; border: none; border-radius: 999px; background: var(--glass); color: #1c3b2f; cursor: pointer; box-shadow: var(--chip-gloss), inset 0 0 0 1px var(--accent-border); }
  .actions button:not(.secondary):hover,
  .reset-actions button:not(.secondary):not(.ghost):hover { background: var(--accent-soft); }
  button:disabled { opacity: 0.6; cursor: default; }
  button.secondary { background: transparent; color: var(--ink-soft); border: 1px solid var(--line); box-shadow: none; }
  button.ghost { background: transparent; color: var(--ink-soft); border: none; box-shadow: none; padding-inline: 0.6rem; }
  .to-list { color: var(--ink-soft); font-size: var(--text-sm); text-decoration: none; }
  .save-message { font-size: 0.85rem; color: var(--ink-soft); }
  .error { color: #c0362c; font-size: 0.8rem; }
  .reset-overlay {
    position: fixed; inset: 0; z-index: 50; display: grid; place-items: center;
    background: rgba(40, 38, 30, 0.32); padding: 1rem;
  }
  .reset-dialog {
    max-width: 26rem; width: 100%; background: var(--cover, #faf7ef); color: inherit;
    border: 1px solid var(--faint); border-radius: 12px; padding: 1.3rem 1.4rem;
    box-shadow: 0 12px 32px -12px rgba(40, 38, 30, 0.45); display: flex; flex-direction: column; gap: 0.9rem;
  }
  .reset-dialog p { margin: 0; }
  .reset-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .reset-note { font-size: 0.75rem; color: var(--faint); }
</style>
