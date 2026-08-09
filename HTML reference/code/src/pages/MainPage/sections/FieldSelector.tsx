import { useMemo, useState, type ChangeEvent } from 'react';
import { Search, CheckSquare, Square, FlipHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FieldInfo } from '@/lib/jsonl';

interface FieldSelectorProps {
  fields: FieldInfo[];
  totalRecords: number;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onInvert: () => void;
}

export default function FieldSelector({
  fields,
  totalRecords,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onInvert,
}: FieldSelectorProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter((f) => f.key.toLowerCase().includes(q));
  }, [fields, query]);

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Fields</CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {selected.size} / {fields.length} selected
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onSelectAll}>
            <CheckSquare className="size-3.5" /> All
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onSelectNone}>
            <Square className="size-3.5" /> None
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onInvert}>
            <FlipHorizontal className="size-3.5" /> Invert
          </Button>
        </div>

        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Filter fields by name"
            className="bg-background pl-9"
          />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="max-h-[520px] overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No fields match “{query}”.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((f) => {
                const checked = selected.has(f.key);
                return (
                  <li key={f.key}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/50 min-w-0',
                        checked && 'bg-primary/5',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => onToggle(f.key)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-mono text-sm font-medium text-foreground">
                            {f.key}
                          </span>
                          {f.types.map((t) => (
                            <Badge key={t} variant="secondary" className="shrink-0 text-[10px] font-normal">
                              {t}
                            </Badge>
                          ))}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                          {f.sample || '—'}
                        </p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
                        {f.occurrences}/{totalRecords}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
