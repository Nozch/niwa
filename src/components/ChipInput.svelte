<script lang="ts">
  // 既存値を候補チップで提示し、クリック/入力で追加、チップで削除するタグ的入力。
  export let label: string;
  export let values: string[] = [];
  export let suggestions: string[] = [];
  export let placeholder = '追加…';

  let draft = '';

  function add(value: string): void {
    const trimmed = value.trim();
    if (trimmed && !values.includes(trimmed)) values = [...values, trimmed];
    draft = '';
  }
  function remove(value: string): void {
    values = values.filter((item) => item !== value);
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    }
  }

  $: available = suggestions.filter((item) => !values.includes(item));
</script>

<div class="chip-field">
  <span class="mini-label">{label}</span>
  <div class="chips">
    {#each values as value}
      <button type="button" class="chip selected" on:click={() => remove(value)}>{value}<span class="x" aria-hidden="true">×</span></button>
    {/each}
    <input class="chip-input" bind:value={draft} on:keydown={onKeydown} {placeholder} />
  </div>
  {#if available.length}
    <div class="chips suggestions">
      {#each available.slice(0, 16) as item}
        <button type="button" class="chip suggest" on:click={() => add(item)}>＋ {item}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chip-field { display: flex; flex-direction: column; gap: 0.4rem; }
  .mini-label { font-size: var(--text-xs); color: var(--faint); letter-spacing: .04em; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip {
    font: inherit; font-size: var(--text-sm); cursor: pointer; border-radius: 999px;
    padding: 0.25rem 0.7rem; border: 1px solid var(--accent-border);
    background: var(--glass); color: var(--ink); box-shadow: var(--chip-gloss);
  }
  .chip .x { margin-left: 0.35rem; color: var(--ink-soft); }
  .chip.suggest { background: transparent; border: 1px dashed var(--line); color: var(--ink-soft); box-shadow: none; }
  .suggestions { margin-top: 0.1rem; }
  .chip-input {
    font: inherit; border: none; background: transparent; color: inherit;
    padding: 0.25rem 0.2rem; min-width: 6rem; flex: 1;
  }
  .chip-input:focus { outline: none; }
  .chip-input::placeholder { color: var(--faint); }
</style>
