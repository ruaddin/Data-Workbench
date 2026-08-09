import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MOCK_FORMAT_OPTIONS, MOCK_ORDER_OPTIONS } from '@/data/options';
import type { ExportOptions } from '@/lib/jsonl';

interface OptionsPanelProps {
  options: ExportOptions;
  onChange: (patch: Partial<ExportOptions>) => void;
}

export default function OptionsPanel({ options, onChange }: OptionsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export options</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Output format</Label>
          <Select
            value={options.format}
            onValueChange={(v) => onChange({ format: v as ExportOptions['format'] })}
          >
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOCK_FORMAT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Field order</Label>
          <Select
            value={options.order}
            onValueChange={(v) => onChange({ order: v as ExportOptions['order'] })}
          >
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOCK_ORDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Empty records</Label>
          <div className="flex h-9 items-center gap-2.5">
            <Switch
              id="drop-empty"
              checked={options.dropEmpty}
              onCheckedChange={(v) => onChange({ dropEmpty: v })}
            />
            <Label htmlFor="drop-empty" className="cursor-pointer text-sm font-normal">
              Drop records that become empty
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
