import { Braces, FileWarning } from "lucide-react";
import type { GraphEdge } from "@/lib/graph/types";
import { cn } from "@/lib/utils";

function lines(start: number, end: number) {
  if (end < start) return `before line ${start}`;
  return end > start ? `lines ${start}–${end}` : `line ${start}`;
}

function Preview({ label, rows }: { label: string; rows: string[] }) {
  if (!rows.length) return null;
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-0.5 text-[10px] font-medium">{label}</p>
      <pre className="bg-muted overflow-x-auto rounded p-1.5 font-mono text-[11px] leading-snug">
        {rows.map((r, i) => (
          <span
            key={i}
            className={cn("block whitespace-pre", r.startsWith("+") ? "text-status-safe" : r.startsWith("-") ? "text-status-blocked" : "")}
          >
            {r}
          </span>
        ))}
      </pre>
    </div>
  );
}

/**
 * The concrete evidence behind one edge: per shared file, the base-line regions both PRs touch
 * (with short diff previews from each side), plus cross-file symbol links.
 */
export function ConflictRegions({ edge, sourceLabel, targetLabel }: { edge: GraphEdge; sourceLabel: string; targetLabel: string }) {
  const files = edge.conflicts ?? [];
  const symbols = edge.symbols ?? [];
  if (!files.length && !symbols.length) return null;

  return (
    <div className="space-y-2">
      {files.map((c) => (
        <div key={c.file} className="rounded-md border p-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <FileWarning className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate" title={c.file}>
              {c.file}
            </span>
            <span className="text-muted-foreground ml-auto shrink-0 font-normal">
              {c.kind === "overlap"
                ? `conflict${c.method === "diff3" ? " · diff3" : ""}`
                : c.kind === "disjoint"
                  ? "different lines"
                  : c.kind === "regenerable"
                    ? "regenerable"
                    : "no patch"}
            </span>
          </p>
          {c.regions.slice(0, 3).map((r, i) => (
            <div key={i} className="mt-1.5 space-y-1">
              <p className="text-muted-foreground text-[11px]">Base {lines(r.baseStart, r.baseEnd)}</p>
              <div className="grid grid-cols-1 gap-1.5">
                <Preview label={sourceLabel} rows={r.aPreview} />
                <Preview label={targetLabel} rows={r.bPreview} />
              </div>
            </div>
          ))}
          {c.regions.length > 3 && (
            <p className="text-muted-foreground mt-1 text-[11px]">+{c.regions.length - 3} more regions</p>
          )}
        </div>
      ))}
      {symbols.map((s) => (
        <div key={`${s.name}-${s.refFile}`} className="flex items-start gap-1.5 rounded-md border p-2 text-xs">
          <Braces className="text-edge-semantic mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p className="min-w-0">
            {sourceLabel} {s.change === "signature" ? "changes the signature of" : s.change === "renamed" ? "renames" : "removes"}{" "}
            <code className="bg-muted rounded px-1">{s.name}</code> in <span className="break-all">{s.defFile}</span>;{" "}
            {targetLabel} uses it in <span className="break-all">{s.refFile}</span>.
          </p>
        </div>
      ))}
    </div>
  );
}
