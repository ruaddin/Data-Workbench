// EXPORTS: IFieldInfo, IExportOptions, MOCK_PREVIEW_FIELDS, MOCK_EXPORT_OPTIONS
export interface IFieldInfo {
  id: string
  key: string
  occurrences: number
  totalRecords: number
  types: Array<'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'>
  sample: string
  selected: boolean
}

export interface IExportOptions {
  format: 'jsonl' | 'csv'
  dropEmpty: boolean
  order: 'original' | 'selection'
}

export const MOCK_PREVIEW_FIELDS: IFieldInfo[] = [
  {
    id: '1',
    key: 'id',
    occurrences: 100,
    totalRecords: 100,
    types: ['string'],
    sample: '"rec_001"',
    selected: true,
  },
  {
    id: '2',
    key: 'text',
    occurrences: 98,
    totalRecords: 100,
    types: ['string'],
    sample: '"Hello world..."',
    selected: true,
  },
  {
    id: '3',
    key: 'meta',
    occurrences: 42,
    totalRecords: 100,
    types: ['object', 'null'],
    sample: '{"lang":"en"}',
    selected: false,
  },
]

export const MOCK_EXPORT_OPTIONS: IExportOptions = {
  format: 'jsonl',
  dropEmpty: false,
  order: 'original',
}