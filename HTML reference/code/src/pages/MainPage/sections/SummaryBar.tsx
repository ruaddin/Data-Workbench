import { Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface SummaryBarProps {
  totalRecords: number;
  failed: number;
  totalFields: number;
  selectedCount: number;
  format: 'jsonl' | 'csv';
  canDownload: boolean;
  onDownload: () => void;
}

interface Stat {
  label: string;
  value: number;
  tone?: 'default' | 'warn';
}

export default function SummaryBar({
  totalRecords,
  failed,
  totalFields,
  selectedCount,
  format,
  canDownload,
  onDownload,
}: SummaryBarProps) {
  const stats: Stat[] = [
    { label: 'Records read', value: totalRecords },
    { label: 'Failed lines', value: failed, tone: failed > 0 ? 'warn' : 'default' },
    { label: 'Fields detected', value: totalFields },
    { label: 'Fields selected', value: selectedCount },
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:flex lg:gap-10">
          {stats.map((s) => (
            <div key={s.label}>
              <div
                className={`font-mono text-2xl font-semibold tabular-nums ${
                  s.tone === 'warn' ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {s.value.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="lg"
          className="gap-2 shrink-0"
          disabled={!canDownload}
          onClick={onDownload}
        >
          <Download className="size-4" />
          Download clean .{format}
        </Button>
      </CardContent>
    </Card>
  );
}
