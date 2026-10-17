import type { DependencyGraph, EdgeType, NodeStatus } from "./types";

const ARROW: Record<EdgeType, string> = {
  BLOCKS: "==>",
  SEMANTIC: "==>",
  STACKED: "==>",
  TOUCHES: "-.->",
  CO_LOCATED: "-.->",
  INDIRECT: "-.->",
};

const CLASS: Record<NodeStatus, string> = {
  SAFE: "safe",
  AT_RISK: "atrisk",
  BLOCKED: "blocked",
  DEADLOCKED: "deadlocked",
};

/** Escape text for a Mermaid quoted label. */
const label = (s: string) => s.replace(/"/g, "#quot;").replace(/[<>]/g, (c) => (c === "<" ? "#lt;" : "#gt;")).slice(0, 80);

/**
 * Render the graph as a Mermaid flowchart (pastes straight into GitHub issues / PR comments).
 * Pure + deterministic: stable node ids (`pr<number>`), INDIRECT edges omitted.
 */
export function toMermaid(graph: DependencyGraph): string {
  const out = ["flowchart LR"];
  for (const n of graph.nodes) {
    out.push(`  pr${n.id}["#${n.data.prNumber} ${label(n.data.title)}"]:::${CLASS[n.data.status]}`);
  }
  for (const e of graph.edges) {
    if (e.type === "INDIRECT") continue;
    out.push(`  pr${e.source} ${ARROW[e.type]}|${e.type.toLowerCase()}| pr${e.target}`);
  }
  out.push(
    "  classDef safe fill:#dcfce7,stroke:#16a34a,color:#14532d",
    "  classDef atrisk fill:#fef9c3,stroke:#ca8a04,color:#713f12",
    "  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d",
    "  classDef deadlocked fill:#fae8ff,stroke:#c026d3,color:#701a75",
  );
  return out.join("\n");
}
