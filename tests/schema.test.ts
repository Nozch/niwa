import { describe, expect, it } from 'vitest';
import { articleSchema, visualSchema } from '../src/content/schema';

const base = {
  schemaVersion: 1 as const,
  id: '01978f38-8e00-7000-8000-00000000f001',
  title: 'Test',
  description: 'Description',
  draft: false,
  createdAt: '2026-07-01T09:00:00+09:00',
  publishedAt: '2026-07-02T09:00:00+09:00',
  tags: [], categories: [], series: [], visuals: [], related: [],
};

describe('articleSchema', () => {
  it('accepts a diary and defaults draft-safe arrays', () => {
    expect(articleSchema.parse({ ...base, kind: 'diary' }).kind).toBe('diary');
  });

  it('requires publishedAt for a public article', () => {
    expect(articleSchema.safeParse({ ...base, kind: 'diary', publishedAt: undefined }).success).toBe(false);
  });

  it('rejects project completion mismatches', () => {
    expect(articleSchema.safeParse({ ...base, kind: 'project', stage: 'complete', progress: 90 }).success).toBe(false);
    expect(articleSchema.safeParse({ ...base, kind: 'project', stage: 'growing', progress: 100 }).success).toBe(false);
  });

  it('rejects project fields on diary entries', () => {
    expect(articleSchema.safeParse({ ...base, kind: 'diary', stage: 'seed', progress: 10 }).success).toBe(false);
  });
});

describe('visualSchema', () => {
  it('checks chart series length', () => {
    const result = visualSchema.safeParse({
      schemaVersion: 1, id: '01978f38-8e00-7000-8000-00000000f101', type: 'chart',
      title: 'Chart', summary: 'Summary', sources: [], chartKind: 'line',
      xAxis: { categories: ['a', 'b'] }, yAxis: {},
      series: [{ key: 'one', label: 'One', values: [1] }],
    });
    expect(result.success).toBe(false);
  });

  const recordShape = (fields: unknown[]) => ({
    schemaVersion: 1, id: '01978f38-8e00-7000-8000-00000000f103', type: 'recordShape',
    title: 'Record', summary: 'Summary', sources: [], record: 'DevLog', fields,
  });

  it('accepts a record shape that explains at least one field', () => {
    const result = visualSchema.safeParse(recordShape([
      { path: 'changeSummary', valueType: 'object' },
      { path: 'changeSummary.why', valueType: 'string', emphasis: true, purpose: 'なぜ変えたか', confirmedBy: 'human' },
    ]));
    expect(result.success).toBe(true);
  });

  /* この型の中心は「書けないこと」にあるので、落ちる側を確かめないと何も表明したことにならない */
  it('gives no place for example values', () => {
    expect(visualSchema.safeParse(recordShape([
      { path: 'title', valueType: 'string', purpose: '見出し', value: 'プロジェクト切替を追加' },
    ])).success).toBe(false);
  });

  it('rejects a record shape with no explanation at all', () => {
    expect(visualSchema.safeParse(recordShape([
      { path: 'title', valueType: 'string' },
      { path: 'status', valueType: 'string' },
    ])).success).toBe(false);
  });

  it('keeps fixed choices as the only exception to holding values', () => {
    expect(visualSchema.safeParse(recordShape([
      { path: 'riskTags', valueType: 'enum', repeated: true, choices: ['database', 'auth'], purpose: '影響範囲' },
    ])).success).toBe(true);
    expect(visualSchema.safeParse(recordShape([
      { path: 'riskTags', valueType: 'string', choices: ['database'], purpose: '影響範囲' },
    ])).success).toBe(false);
    expect(visualSchema.safeParse(recordShape([
      { path: 'riskTags', valueType: 'enum', purpose: '影響範囲' },
    ])).success).toBe(false);
  });

  it('requires the parent so the structure stays derivable from paths', () => {
    expect(visualSchema.safeParse(recordShape([
      { path: 'changeSummary.why', valueType: 'string', purpose: 'なぜ変えたか' },
    ])).success).toBe(false);
  });

  it('rejects duplicated field paths', () => {
    expect(visualSchema.safeParse(recordShape([
      { path: 'title', valueType: 'string', purpose: '見出し' },
      { path: 'title', valueType: 'string', purpose: '見出し' },
    ])).success).toBe(false);
  });

  it('keeps drafting and confirming as separate facts', () => {
    const parsed = visualSchema.parse(recordShape([
      { path: 'why', valueType: 'string', purpose: 'なぜ変えたか', draftedBy: 'ai', confirmedBy: 'human' },
    ]));
    const field = parsed.type === 'recordShape' ? parsed.fields[0] : null;
    expect(field?.draftedBy).toBe('ai');
    expect(field?.confirmedBy).toBe('human');
  });

  it('checks comparison cells against columns', () => {
    const result = visualSchema.safeParse({
      schemaVersion: 1, id: '01978f38-8e00-7000-8000-00000000f102', type: 'comparisonTable',
      title: 'Table', summary: 'Summary', sources: [],
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ key: 'r', label: 'R', cells: { b: 'wrong' } }],
    });
    expect(result.success).toBe(false);
  });
});
