import { z } from 'zod';

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

export const stableIdSchema = z.string().regex(UUID_V7_PATTERN, 'UUIDv7を指定してください');
export const slugSchema = z.string().regex(SLUG_PATTERN, 'lowercase kebab-caseで指定してください');
export const isoDateTimeSchema = z.string().datetime({ offset: true });

const nonEmptyText = z.string().trim().min(1);
const uniqueStrings = z
  .array(nonEmptyText)
  .default([])
  .superRefine((items, context) => {
    if (new Set(items).size !== items.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '重複した値は指定できません' });
    }
  });

const referenceInputSchema = stableIdSchema;

type ReferenceSchemas = {
  visualReference?: z.ZodTypeAny;
  articleReference?: z.ZodTypeAny;
};

export function createArticleSchema({
  visualReference = referenceInputSchema,
  articleReference = referenceInputSchema,
}: ReferenceSchemas = {}) {
  const common = {
    schemaVersion: z.literal(1),
    id: stableIdSchema,
    slug: slugSchema.optional(),
    title: nonEmptyText.max(120),
    description: nonEmptyText.max(240),
    draft: z.boolean().default(true),
    createdAt: isoDateTimeSchema,
    publishedAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
    tags: uniqueStrings,
    categories: uniqueStrings,
    series: uniqueStrings,
    visuals: z.array(visualReference).default([]),
    related: z.array(articleReference).default([]),
  };

  return z
    .discriminatedUnion('kind', [
      z.object({ ...common, kind: z.literal('diary') }).strict(),
      z
        .object({
          ...common,
          kind: z.literal('project'),
          stage: z.enum(['seed', 'growing', 'complete']),
          progress: z.number().int().min(0).max(100),
        })
        .strict(),
    ])
    .superRefine((article, context) => {
      if (!article.draft && !article.publishedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['publishedAt'],
          message: '公開記事にはpublishedAtが必要です',
        });
      }

      if (article.updatedAt && Date.parse(article.updatedAt) < Date.parse(article.createdAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['updatedAt'],
          message: 'updatedAtはcreatedAt以降にしてください',
        });
      }

      if (article.kind === 'project') {
        const completed = article.stage === 'complete';
        if (completed !== (article.progress === 100)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['progress'],
            message: 'completeとprogress: 100は一致させてください',
          });
        }
      }
    });
}

const visualBase = {
  schemaVersion: z.literal(1),
  id: stableIdSchema,
  title: nonEmptyText.max(120),
  summary: nonEmptyText.max(500),
  caption: nonEmptyText.max(500).optional(),
  sources: z
    .array(z.object({ label: nonEmptyText, url: z.string().url() }).strict())
    .default([]),
};

const chartSchema = z
  .object({
    ...visualBase,
    type: z.literal('chart'),
    chartKind: z.enum(['line', 'bar']),
    xAxis: z
      .object({ label: nonEmptyText.optional(), categories: z.array(nonEmptyText).min(1) })
      .strict(),
    yAxis: z.object({ label: nonEmptyText.optional(), unit: nonEmptyText.optional() }).strict(),
    series: z
      .array(
        z
          .object({
            key: z.string().regex(KEY_PATTERN),
            label: nonEmptyText,
            values: z.array(z.number().finite().nullable()),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const cellSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const comparisonTableSchema = z
  .object({
    ...visualBase,
    type: z.literal('comparisonTable'),
    columns: z
      .array(
        z
          .object({
            key: z.string().regex(KEY_PATTERN),
            label: nonEmptyText,
            align: z.enum(['start', 'center', 'end']).default('start'),
          })
          .strict(),
      )
      .min(1),
    rows: z
      .array(
        z
          .object({
            key: z.string().regex(KEY_PATTERN),
            label: nonEmptyText,
            cells: z.record(cellSchema),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/* recordShape: レコードの構造そのものを解説する。値ではなく各項目の意味と担い手を見せるため、
   具体例の値を書く場所は用意しない。選択肢だけは実例ではなく仕様なので例外として持てる。 */
export const FIELD_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/;

const actorSchema = z.enum(['machine', 'ai', 'human']);

const recordFieldSchema = z
  .object({
    path: z.string().regex(FIELD_PATH_PATTERN, 'ドット区切りの項目パスで指定してください'),
    valueType: z.enum(['string', 'number', 'boolean', 'datetime', 'object', 'enum']),
    repeated: z.boolean().default(false),
    choices: z.array(nonEmptyText).min(1).optional(),
    purpose: nonEmptyText.max(300).optional(),
    draftedBy: actorSchema.optional(),
    confirmedBy: actorSchema.optional(),
    emphasis: z.boolean().default(false),
  })
  .strict();

const recordShapeSchema = z
  .object({
    ...visualBase,
    type: z.literal('recordShape'),
    record: nonEmptyText.max(60),
    fields: z.array(recordFieldSchema).min(1),
  })
  .strict();

export const visualSchema = z
  .discriminatedUnion('type', [chartSchema, comparisonTableSchema, recordShapeSchema])
  .superRefine((visual, context) => {
    if (visual.type === 'recordShape') {
      const paths = visual.fields.map((field) => field.path);
      if (new Set(paths).size !== paths.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: '項目pathが重複しています' });
      }

      // 構造は項目pathから導出する。親を宣言させることで、構造と説明を二重に持たずに済ませる。
      const declared = new Set(paths);
      visual.fields.forEach((field, index) => {
        const separator = field.path.lastIndexOf('.');
        const parent = separator === -1 ? '' : field.path.slice(0, separator);
        if (parent && !declared.has(parent)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['fields', index, 'path'],
            message: `親の項目 ${parent} も宣言してください`,
          });
        }
        if ((field.valueType === 'enum') !== (field.choices !== undefined)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['fields', index, 'choices'],
            message: 'choicesはvalueTypeがenumのときだけ指定してください',
          });
        }
      });

      // 説明が一つも無いrecordShapeは、角を丸めただけの生JSONでしかない。
      if (!visual.fields.some((field) => field.purpose)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields'],
          message: 'purposeを持つ項目が最低ひとつ必要です',
        });
      }
      return;
    }

    if (visual.type === 'chart') {
      const keys = visual.series.map((series) => series.key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['series'], message: 'series keyが重複しています' });
      }
      visual.series.forEach((series, index) => {
        if (series.values.length !== visual.xAxis.categories.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['series', index, 'values'],
            message: 'values数をxAxis.categories数と一致させてください',
          });
        }
      });
      return;
    }

    const columnKeys = visual.columns.map((column) => column.key);
    const rowKeys = visual.rows.map((row) => row.key);
    if (new Set(columnKeys).size !== columnKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'column keyが重複しています' });
    }
    if (new Set(rowKeys).size !== rowKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rows'], message: 'row keyが重複しています' });
    }
    const expected = [...columnKeys].sort().join('|');
    visual.rows.forEach((row, index) => {
      if (Object.keys(row.cells).sort().join('|') !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'cells'],
          message: 'cellsのkeyをcolumnsと完全に一致させてください',
        });
      }
    });
  });

export const articleSchema = createArticleSchema();
export type ArticleInput = z.input<typeof articleSchema>;
export type Article = z.output<typeof articleSchema>;
export type Visual = z.output<typeof visualSchema>;
export type ChartVisual = Extract<Visual, { type: 'chart' }>;
export type ComparisonTableVisual = Extract<Visual, { type: 'comparisonTable' }>;
export type RecordShapeVisual = Extract<Visual, { type: 'recordShape' }>;
export type RecordShapeField = RecordShapeVisual['fields'][number];
