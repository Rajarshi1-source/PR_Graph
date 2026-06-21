import { createContext, useContext } from "react";
import type { PRNodeData } from "@/lib/graph/types";

/**
 * Lets a custom React Flow node (which only receives `data`) ask the canvas to open the detail
 * panel — used for keyboard activation (Enter/Space) so the graph is operable without a mouse.
 */
export const NodeActivateContext = createContext<(data: PRNodeData) => void>(() => {});
export const useNodeActivate = () => useContext(NodeActivateContext);
