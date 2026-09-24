import { describe, expect, it } from 'vitest';
import { buildBranches, kindOf, pickDefaultField, pickOf } from '../src/lib/record-shape';
import type { RecordShapeField } from '../src/content/schema';

const field = (path: string, extra: Partial<RecordShapeField> = {}): RecordShapeField => ({
  path, valueType: 'string', repeated: false, emphasis: false, ...extra,
});

describe('buildBranches', () => {
  it('derives the nesting from paths so it is never written twice', () => {
    const branches = buildBranches([
      field('changeSummary', { valueType: 'object' }),
      field('changeSummary.what'),
      field('changeSummary.why', { emphasis: true }),
      field('nextAction'),
    ]);
    expect(branches.map((branch) => branch.name)).toEqual(['changeSummary', 'nextAction']);
    expect(branches[0].children.map((child) => child.name)).toEqual(['what', 'why']);
    expect(branches[1].children).toEqual([]);
  });

  it('keeps declaration order rather than sorting by name', () => {
    const branches = buildBranches([field('why'), field('and'), field('how')]);
    expect(branches.map((branch) => branch.name)).toEqual(['why', 'and', 'how']);
  });

  it('nests more than one level deep', () => {
    const branches = buildBranches([
      field('completionCriteria', { valueType: 'object', repeated: true }),
      field('completionCriteria.required', { valueType: 'boolean' }),
    ]);
    expect(branches[0].children[0].name).toBe('required');
  });

  it('does not treat a shared prefix as a parent', () => {
    const branches = buildBranches([field('change'), field('changeSummary')]);
    expect(branches.map((branch) => branch.name)).toEqual(['change', 'changeSummary']);
    expect(branches[0].children).toEqual([]);
  });
});

describe('kindOf', () => {
  it('tells a single value apart from a repeated one', () => {
    expect(kindOf(field('a'))).toBe('文字列');
    expect(kindOf(field('b', { repeated: true }))).toBe('文字列の繰り返し');
    expect(kindOf(field('c', { valueType: 'object' }))).toBe('入れ子');
  });
});

describe('pickOf', () => {
  it('builds an id that survives dotted paths', () => {
    expect(pickOf('visual-1', 'changeSummary.why')).toBe('pick-visual-1-changeSummary-why');
  });
});

describe('pickDefaultField', () => {
  it('opens the emphasised field so the window never starts empty', () => {
    const chosen = pickDefaultField([
      field('title', { purpose: '見出し' }),
      field('why', { purpose: 'なぜ変えたか', emphasis: true }),
    ]);
    expect(chosen?.path).toBe('why');
  });

  it('falls back to the first explained field', () => {
    const chosen = pickDefaultField([field('id'), field('title', { purpose: '見出し' })]);
    expect(chosen?.path).toBe('title');
  });
});
