<script lang="ts">
  import type { ChartVisual } from '../content/schema';

  export let visual: ChartVisual;

  const width = 640;
  const height = 300;
  const plot = { left: 58, right: 22, top: 22, bottom: 52 };
  const colors = ['var(--accent)', 'var(--ink-soft)', 'var(--faint)', 'var(--ink)'];
  let hidden = new Set<string>();
  let focus: { series: number; point: number } | null = null;

  $: allValues = visual.series.flatMap((series) => series.values).filter((value): value is number => value !== null);
  $: minValue = Math.min(0, ...allValues);
  $: maxValue = Math.max(1, ...allValues);
  $: range = maxValue - minValue || 1;
  $: plotWidth = width - plot.left - plot.right;
  $: plotHeight = height - plot.top - plot.bottom;

  function x(index: number) {
    if (visual.xAxis.categories.length === 1) return plot.left + plotWidth / 2;
    return plot.left + (index / (visual.xAxis.categories.length - 1)) * plotWidth;
  }
  function y(value: number) { return plot.top + ((maxValue - value) / range) * plotHeight; }
  function points(values: (number | null)[]) {
    return values.map((value, index) => value === null ? null : `${x(index)},${y(value)}`).filter(Boolean).join(' ');
  }
  function toggle(key: string) {
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    hidden = next;
  }
</script>

<section class="chart visual-block" aria-labelledby={`visual-${visual.id}`}>
  <h2 class="visual-heading" id={`visual-${visual.id}`}>{visual.title}</h2>
  <p class="visual-summary">{visual.summary}</p>
  <div class="legend" aria-label="系列の表示切替">
    {#each visual.series as series, index}
      <button type="button" aria-pressed={!hidden.has(series.key)} onclick={() => toggle(series.key)}>
        <span style={`background:${colors[index % colors.length]}`}></span>{series.label}
      </button>
    {/each}
  </div>
  <div class="canvas">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={visual.summary}>
      {#each [0, 0.25, 0.5, 0.75, 1] as tick}
        {@const value = minValue + range * tick}
        {@const tickY = y(value)}
        <line x1={plot.left} x2={width - plot.right} y1={tickY} y2={tickY} class="grid" />
        <text x={plot.left - 10} y={tickY + 4} text-anchor="end">{Math.round(value)}{visual.yAxis.unit ?? ''}</text>
      {/each}
      {#each visual.xAxis.categories as category, index}
        <text x={x(index)} y={height - 20} text-anchor="middle">{category}</text>
      {/each}
      {#each visual.series as series, seriesIndex}
        {#if !hidden.has(series.key)}
          {#if visual.chartKind === 'line'}
            <polyline points={points(series.values)} fill="none" stroke={colors[seriesIndex % colors.length]} stroke-width="1.75" stroke-linejoin="round" />
          {/if}
          {#each series.values as value, pointIndex}
            {#if value !== null}
              {#if visual.chartKind === 'bar'}
                <rect
                  x={x(pointIndex) - 18 + seriesIndex * 10}
                  y={y(value)} width={Math.max(8, 34 / visual.series.length)} height={y(minValue) - y(value)}
                  fill={colors[seriesIndex % colors.length]} rx="3" tabindex="0"
                  onfocus={() => focus = { series: seriesIndex, point: pointIndex }}
                  onblur={() => focus = null}
                />
              {:else}
                <circle cx={x(pointIndex)} cy={y(value)} r="6" fill={colors[seriesIndex % colors.length]} stroke="var(--card)" stroke-width="2" tabindex="0"
                  onfocus={() => focus = { series: seriesIndex, point: pointIndex }}
                  onblur={() => focus = null}
                  onmouseenter={() => focus = { series: seriesIndex, point: pointIndex }}
                  onmouseleave={() => focus = null}
                />
              {/if}
            {/if}
          {/each}
        {/if}
      {/each}
    </svg>
    {#if focus && visual.series[focus.series].values[focus.point] !== null}
      <div class="tooltip" role="status">
        {visual.xAxis.categories[focus.point]}・{visual.series[focus.series].label}：
        {visual.series[focus.series].values[focus.point]}{visual.yAxis.unit ?? ''}
      </div>
    {/if}
  </div>
  <details>
    <summary>数値を表で確認</summary>
    <div class="table-scroll">
      <table>
        <thead><tr><th>項目</th>{#each visual.xAxis.categories as category}<th>{category}</th>{/each}</tr></thead>
        <tbody>{#each visual.series as series}<tr><th>{series.label}</th>{#each series.values as value}<td>{value ?? '—'}{value === null ? '' : visual.yAxis.unit ?? ''}</td>{/each}</tr>{/each}</tbody>
      </table>
    </div>
  </details>
  {#if visual.caption}<p class="visual-caption">{visual.caption}</p>{/if}
</section>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .legend button { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 20px; color: var(--ink-soft); background: transparent; cursor: pointer; font-size: var(--text-sm); }
  .legend button[aria-pressed='false'] { opacity: .45; }
  .legend span { width: 8px; height: 8px; border-radius: 50%; }
  .canvas { position: relative; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  svg text { fill: var(--ink-soft); font: var(--text-xs) 'Zen Kaku Gothic New', sans-serif; }
  .grid { stroke: var(--line); stroke-width: 1; }
  circle, rect { outline: none; cursor: crosshair; }
  circle:focus, rect:focus { stroke: var(--ink); stroke-width: 3; }
  .tooltip { position: absolute; top: 8px; right: 8px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--ink); font-size: var(--text-sm); box-shadow: 0 4px 14px rgba(70,66,47,.12); }
  details { margin-top: 10px; color: var(--ink-soft); font-size: var(--text-sm); }
  summary { cursor: pointer; }
  .table-scroll { overflow-x: auto; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); }
  th, td { padding: 7px 9px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
  th:first-child { text-align: left; }
</style>
