import { FileText, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PreviewPanelProps {
  hasFile: boolean;
  hasSelection: boolean;
  previewText: string;
  format: 'jsonl' | 'csv';
  shownCount: number;
  totalCount: number;
}

export default function PreviewPanel({
  hasFile,
  hasSelection,
  previewText,
  format,
  shownCount,
  totalCount,
}: PreviewPanelProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4 text-primary" />
          Preview
        </CardTitle>
        {hasFile && hasSelection && (
          <Badge variant="outline" className="font-mono text-xs">
            {format.toUpperCase()} · first {shownCount} of {totalCount}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="flex-1">
        {!hasFile ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="Upload a .jsonl file to begin"
            hint="Detected fields and a live preview of the clean output will appear here."
          />
        ) : !hasSelection ? (
          <EmptyState
            icon={<Eye className="size-6" />}
            title="Select at least one field"
            hint="Tick the fields you want to keep and the cleaned output will render here."
          />
        ) : (
          <pre className="max-h-[520px] overflow-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground">
            {previewText || '(no matching records)'}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
