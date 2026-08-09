// EXPORTS: IExportOptions, MOCK_DEFAULT_OPTIONS, MOCK_FORMAT_OPTIONS, MOCK_ORDER_OPTIONS
export interface IExportOptions {
  format: 'jsonl' | 'csv'
  dropEmpty: boolean
  order: 'original' | 'selection'
}

export interface ISelectOption {
  value: string
  label: string
}

export const MOCK_DEFAULT_OPTIONS: IExportOptions = {
  format: 'jsonl',
  dropEmpty: false,
  order: 'original',
}

export const MOCK_FORMAT_OPTIONS: ISelectOption[] = [
  { value: 'jsonl', label: 'JSONL' },
  { value: 'csv', label: 'CSV' },
]

export const MOCK_ORDER_OPTIONS: ISelectOption[] = [
  { value: 'original', label: 'Original order' },
  { value: 'selection', label: 'Selection order' },
]