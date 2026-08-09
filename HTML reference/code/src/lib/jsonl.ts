// Pure, DOM-free JSONL processing logic. Everything runs in the browser.

export type JsonlRecord = Record<string, unknown>;

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export interface FieldInfo {
  /** Top-level field name */
  key: string;
  /** In how many records this key appears */
  occurrences: number;
  /** Inferred value types (a key may hold multiple types) */
  types: FieldType[];
  /** Truncated sample value for preview */
  sample: string;
}

export interface ParseResult {
  /** Object records successfully parsed, in input order */
  records: JsonlRecord[];
  /** Total records read (object records kept) */
  totalRecords: number;
  /** Non-blank lines that could not become an object record */
  failed: number;
}

export interface ExportOptions {
  format: 'jsonl' | 'csv';
  dropEmpty: boolean;
  order: 'original' | 'selection';
}

export function typeOf(value: unknown): FieldType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'object';
}

export function sampleOf(value: unknown, max = 52): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = String(value);
  s = s ?? '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Split raw text into JSONL records.
 * Blank lines are ignored. Lines that are invalid JSON or whose root is not
 * a plain object are counted as `failed` and skipped (never crash the run).
 */
export function parseJsonl(text: string): ParseResult {
  const src = text.split('\n');
  const records: JsonlRecord[] = [];
  let failed = 0;

  for (let i = 0; i < src.length; i++) {
    const raw = src[i].replace(/\r$/, '');
    if (raw.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failed++;
      continue;
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      failed++;
      continue;
    }

    records.push(parsed as JsonlRecord);
  }

  return { records, totalRecords: records.length, failed };
}

/** Union of all top-level keys, in first-appearance order, with metadata. */
export function detectFields(records: JsonlRecord[]): FieldInfo[] {
  const map = new Map<string, FieldInfo>();
  const order: string[] = [];
  const sampled = new Set<string>();

  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      let info = map.get(key);
      if (!info) {
        info = { key, occurrences: 0, types: [], sample: '' };
        map.set(key, info);
        order.push(key);
      }
      info.occurrences++;
      const t = typeOf(rec[key]);
      if (!info.types.includes(t)) info.types.push(t);
      if (!sampled.has(key)) {
        info.sample = sampleOf(rec[key]);
        sampled.add(key);
      }
    }
  }

  return order.map((k) => map.get(k) as FieldInfo);
}

/**
 * Resolve the ordered column list to keep.
 * - `original`: fields in their first-appearance order, filtered by selection
 * - `selection`: fields in the order the user ticked them
 */
export function orderedColumns(
  fields: FieldInfo[],
  selectionOrder: string[],
  selected: Set<string>,
  order: 'original' | 'selection',
): string[] {
  if (order === 'selection') {
    return selectionOrder.filter((k) => selected.has(k));
  }
  return fields.map((f) => f.key).filter((k) => selected.has(k));
}

/** Rebuild each record keeping only the chosen columns that are present. */
export function applySelection(
  records: JsonlRecord[],
  columns: string[],
  dropEmpty: boolean,
): JsonlRecord[] {
  const out: JsonlRecord[] = [];
  for (const rec of records) {
    const next: JsonlRecord = {};
    let count = 0;
    for (const c of columns) {
      if (Object.prototype.hasOwnProperty.call(rec, c)) {
        next[c] = rec[c];
        count++;
      }
    }
    if (dropEmpty && count === 0) continue;
    out.push(next);
  }
  return out;
}

export function toJsonl(records: JsonlRecord[]): string {
  if (records.length === 0) return '';
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function csvField(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  if (s === '') return '""';
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(records: JsonlRecord[], columns: string[]): string {
  const out = [columns.map(csvField).join(',')];
  for (const r of records) out.push(columns.map((c) => csvField(r[c])).join(','));
  return out.join('\n') + '\n';
}

/** Full export text for the chosen format. */
export function buildText(
  records: JsonlRecord[],
  columns: string[],
  format: 'jsonl' | 'csv',
): string {
  return format === 'csv' ? toCsv(records, columns) : toJsonl(records);
}

/** Preview text for the first `limit` records. */
export function buildPreview(
  records: JsonlRecord[],
  columns: string[],
  format: 'jsonl' | 'csv',
  limit: number,
): string {
  const slice = records.slice(0, limit);
  if (format === 'csv') return toCsv(slice, columns).replace(/\n$/, '');
  return slice.map((r) => JSON.stringify(r)).join('\n');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}
