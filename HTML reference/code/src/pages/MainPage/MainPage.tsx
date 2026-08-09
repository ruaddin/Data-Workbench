import { useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';
import DropZone from './sections/DropZone';
import FieldSelector from './sections/FieldSelector';
import OptionsPanel from './sections/OptionsPanel';
import PreviewPanel from './sections/PreviewPanel';
import SummaryBar from './sections/SummaryBar';
import {
  parseJsonl,
  detectFields,
  orderedColumns,
  applySelection,
  buildText,
  buildPreview,
  type FieldInfo,
  type JsonlRecord,
  type ExportOptions,
} from '@/lib/jsonl';
import { MOCK_DEFAULT_OPTIONS } from '@/data/options';

const PREVIEW_LIMIT = 20;

export default function MainPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [records, setRecords] = useState<JsonlRecord[]>([]);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [failed, setFailed] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  const [options, setOptions] = useState<ExportOptions>({ ...MOCK_DEFAULT_OPTIONS });

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onerror = () => toast.error(`Could not read ${file.name}.`);
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = parseJsonl(text);
        const detected = detectFields(parsed.records);

        setFileName(file.name);
        setFileSize(file.size);
        setRecords(parsed.records);
        setFields(detected);
        setFailed(parsed.failed);

        const allKeys = detected.map((f) => f.key);
        setSelected(new Set(allKeys));
        setSelectionOrder(allKeys);

        if (parsed.totalRecords === 0) {
          toast.warning('No valid JSON object records found in this file.');
        } else {
          toast.success(
            `Loaded ${parsed.totalRecords.toLocaleString('en-US')} records · ${detected.length} fields detected.`,
          );
        }
      } catch (error) {
        logger.error('Failed to process file:', String(error));
        toast.error('Failed to process file.');
      }
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  const toggleField = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelectionOrder((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(fields.map((f) => f.key)));
  }, [fields]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const invert = useCallback(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const f of fields) if (!prev.has(f.key)) next.add(f.key);
      return next;
    });
  }, [fields]);

  const patchOptions = useCallback((patch: Partial<ExportOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
  }, []);

  const columns = useMemo(
    () => orderedColumns(fields, selectionOrder, selected, options.order),
    [fields, selectionOrder, selected, options.order],
  );

  const cleaned = useMemo(
    () => applySelection(records, columns, options.dropEmpty),
    [records, columns, options.dropEmpty],
  );

  const previewText = useMemo(
    () => buildPreview(cleaned, columns, options.format, PREVIEW_LIMIT),
    [cleaned, columns, options.format],
  );

  const hasFile = fileName !== null;
  const hasSelection = selected.size > 0;
  const canDownload = hasFile && hasSelection && cleaned.length > 0;

  const handleDownload = useCallback(() => {
    if (!canDownload || !fileName) return;
    try {
      const text = buildText(cleaned, columns, options.format);
      const mime =
        options.format === 'csv' ? 'text/csv' : 'application/x-ndjson';
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const base = fileName.replace(/\.(jsonl|json|txt)$/i, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}_clean.${options.format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Exported ${cleaned.length.toLocaleString('en-US')} clean records.`);
    } catch (error) {
      logger.error('Export failed:', String(error));
      toast.error('Export failed.');
    }
  }, [canDownload, fileName, cleaned, columns, options.format]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            JSONL Field Selector
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Upload a <span className="font-mono">.jsonl</span> file, pick exactly which fields to
            keep, and export clean data containing only those fields. Everything runs locally —
            nothing leaves your machine.
          </p>
        </header>

        <div className="space-y-6">
          <DropZone fileName={fileName} fileSize={fileSize} onFile={handleFile} />

          {hasFile && (
            <>
              <OptionsPanel options={options} onChange={patchOptions} />

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <FieldSelector
                  fields={fields}
                  totalRecords={records.length}
                  selected={selected}
                  onToggle={toggleField}
                  onSelectAll={selectAll}
                  onSelectNone={selectNone}
                  onInvert={invert}
                />
                <PreviewPanel
                  hasFile={hasFile}
                  hasSelection={hasSelection}
                  previewText={previewText}
                  format={options.format}
                  shownCount={Math.min(PREVIEW_LIMIT, cleaned.length)}
                  totalCount={cleaned.length}
                />
              </div>

              <SummaryBar
                totalRecords={records.length}
                failed={failed}
                totalFields={fields.length}
                selectedCount={selected.size}
                format={options.format}
                canDownload={canDownload}
                onDownload={handleDownload}
              />
            </>
          )}

          {!hasFile && (
            <PreviewPanel
              hasFile={false}
              hasSelection={false}
              previewText=""
              format={options.format}
              shownCount={0}
              totalCount={0}
            />
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
