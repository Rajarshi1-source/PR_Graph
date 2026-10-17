import { describe, it, expect } from "vitest";
import { renderCheckSummary } from "../renderCheckSummary";
import { buildDependencyGraph } from "@/lib/graph/buildDependencyGraph";
import { withMergePlan } from "@/lib/graph/mergePlan";
import { file, pr, replaceLine } from "@/lib/graph/__fixtures__/prs";

const graph = withMergePlan(
  buildDependencyGraph([
    pr(1, 1, [file("src/auth.ts", replaceLine(42, "a"))]),
    pr(2, 2, [file("src/auth.ts", replaceLine(42, "b"))]),
  ]),
);
const opts = { failOnConflict: false, appUrl: "https://prgraph.dev", fullName: "acme/web" };
const node = (id: string) => graph.nodes.find((n) => n.id === id)!;

describe("renderCheckSummary", () => {
  it("SAFE → success with the blocking list", () => {
    const s = renderCheckSummary(node("1"), graph, opts);
    expect(s.conclusion).toBe("success");
    expect(s.title).toBe("No conflicts with open PRs");
    expect(s.summary).toContain("#### Blocking");
    expect(s.summary).toContain("#2 waits on this PR");
    expect(s.summary).toContain("https://prgraph.dev/repo/acme/web");
  });

  it("BLOCKED → neutral by default, failure with failOnConflict; lists file + lines + plan", () => {
    const s = renderCheckSummary(node("2"), graph, opts);
    expect(s.conclusion).toBe("neutral");
    expect(s.title).toBe("Blocked by #1");
    expect(s.summary).toContain("`src/auth.ts` L42");
    expect(s.summary).toContain("**Merge plan:** step 2 of 2.");
    expect(renderCheckSummary(node("2"), graph, { ...opts, failOnConflict: true }).conclusion).toBe("failure");
  });

  it("is deterministic (content hash only changes with content)", () => {
    expect(renderCheckSummary(node("2"), graph, opts)).toEqual(renderCheckSummary(node("2"), graph, opts));
  });
});
