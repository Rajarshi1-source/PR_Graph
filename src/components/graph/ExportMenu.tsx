"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import type { DependencyGraph } from "@/lib/graph/types";
import { toMermaid } from "@/lib/graph/export";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;

function slug(name: string) {
  return name.replace(/[^\w.-]+/g, "-");
}

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

/** Export the graph as PNG / SVG (React Flow's documented html-to-image recipe), Mermaid or JSON. */
export function ExportMenu({ graph, repoName }: { graph: DependencyGraph; repoName: string }) {
  const { getNodes } = useReactFlow();
  const base = `prgraph-${slug(repoName)}`;

  const image = async (kind: "png" | "svg") => {
    const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewportEl) return;
    const bounds = getNodesBounds(getNodes());
    const vp = getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, 0.2, 2, 0.1);
    const opts = {
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      style: {
        width: `${IMAGE_WIDTH}px`,
        height: `${IMAGE_HEIGHT}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    };
    try {
      const url = kind === "png" ? await toPng(viewportEl, opts) : await toSvg(viewportEl, opts);
      download(url, `${base}.${kind}`);
    } catch {
      toast.error(`Could not export ${kind.toUpperCase()}`);
    }
  };

  const mermaid = async () => {
    try {
      await navigator.clipboard.writeText(toMermaid(graph));
      toast.success("Mermaid diagram copied — paste it into any GitHub comment");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const json = () => {
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    download(url, `${base}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" aria-label="Export graph" />}>
        <Download className="size-4" />
        <span className="hidden sm:inline">Export</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => image("png")}>PNG image</DropdownMenuItem>
        <DropdownMenuItem onClick={() => image("svg")}>SVG image</DropdownMenuItem>
        <DropdownMenuItem onClick={mermaid}>Copy as Mermaid</DropdownMenuItem>
        <DropdownMenuItem onClick={json}>Download JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
