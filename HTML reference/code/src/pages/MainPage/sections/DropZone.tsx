import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Upload, FileJson, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/jsonl';

interface DropZoneProps {
  fileName: string | null;
  fileSize: number | null;
  onFile: (file: File) => void;
}

export default function DropZone({ fileName, fileSize, onFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  };

  return (
    <Card className="p-5 md:p-6">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setOver(false);
        }}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors cursor-pointer outline-none',
          over
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50 focus-visible:border-primary',
        )}
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Upload className="size-6" />
        </div>
        <p className="text-sm text-foreground">
          Drop a <span className="font-semibold text-primary">.jsonl</span> file here, or{' '}
          <span className="font-semibold text-primary">click to browse</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Accepts .jsonl / .json / .txt — files never leave your machine
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".jsonl,.json,.txt,text/plain,application/json"
          className="hidden"
          onChange={handleChange}
        />
      </div>

      {fileName && (
        <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 min-w-0">
          <FileJson className="size-4 shrink-0 text-primary" />
          <span className="flex-1 min-w-0 truncate font-mono text-sm text-foreground">
            {fileName}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {fileSize != null ? formatBytes(fileSize) : ''}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            <RefreshCw className="size-3.5" />
            Replace
          </Button>
        </div>
      )}
    </Card>
  );
}
