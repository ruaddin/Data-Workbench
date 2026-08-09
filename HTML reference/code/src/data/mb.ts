// EXPORTS: IJsonlRecord, IFieldInfo, IExportOptions, MOCK_FIELDS
export type IJsonlRecord = Record<string, unknown>

export interface IFieldInfo {
  key: string
  occurrences: number
  types: Array<'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'>
  sample: string
}

export interface IExportOptions {
  format: 'jsonl' | 'csv'
  dropEmpty: boolean
  order: 'original' | 'selection'
}

// 示例字段清单（真实数据来自用户上传，此处仅用于开发预览兜底）
export const MOCK_FIELDS: IFieldInfo[] = [
  { key: 'id', occurrences: 3, types: ['number'], sample: '1001' },
  { key: 'prompt', occurrences: 3, types: ['string'], sample: 'Summarize the...' },
  { key: 'meta', occurrences: 2, types: ['object'], sample: '{"lang":"en"}' },
]