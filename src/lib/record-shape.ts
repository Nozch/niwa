import type { RecordShapeField, RecordShapeVisual } from '@/content/schema';

export type Branch = { field: RecordShapeField; name: string; children: Branch[] };

const VALUE_TYPES = {
  string: '文字列', number: '数値', boolean: '真偽', datetime: '日時', object: '入れ子', enum: '選択肢',
} as const;

export const ACTORS = { machine: '機械', ai: 'AI', human: '人間' } as const;

/* 構造は項目pathから組み立てる。書き手に木を書かせないので、構造と説明はずれようがない。 */
export function buildBranches(fields: RecordShapeVisual['fields'], parent = ''): Branch[] {
  const prefix = parent ? `${parent}.` : '';
  return fields
    .filter((field) => field.path.startsWith(prefix) && !field.path.slice(prefix.length).includes('.'))
    .map((field) => ({
      field,
      name: field.path.slice(prefix.length),
      children: buildBranches(fields, field.path),
    }));
}

export function kindOf(field: RecordShapeField): string {
  const kind = VALUE_TYPES[field.valueType];
  return field.repeated ? `${kind}の繰り返し` : kind;
}

/* :targetで選ぶと、ブラウザが対象を画面の上端へ寄せようとして紙が跳ねる。
   選択はラジオボタンに持たせ、URLにもスクロール位置にも触らせない。 */
export function pickOf(visualId: string, path: string): string {
  return `pick-${visualId}-${path.replace(/\./g, '-')}`;
}

/* 窓は空から始めない。主役の項目があればそれを、無ければ説明のある最初の項目を開く */
export function pickDefaultField(fields: RecordShapeVisual['fields']): RecordShapeField | undefined {
  const described = fields.filter((field) => field.purpose);
  return described.find((field) => field.emphasis) ?? described[0];
}
