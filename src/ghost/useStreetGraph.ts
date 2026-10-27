import { useAreaStore } from "@/state/areaStore";
import { buildStreetGraph, type StreetGraph } from "./streetGraph.ts";

// One street network per loaded area, shared by the ghost simulation and the walk mode.
let cache: { roads: unknown; projection: unknown; graph: StreetGraph } | null = null;

export function getStreetGraph(): StreetGraph | null {
  const { roads, projection } = useAreaStore.getState();
  if (!projection || roads.length === 0) return null;
  if (!cache || cache.roads !== roads || cache.projection !== projection) {
    cache = { roads, projection, graph: buildStreetGraph(roads, projection) };
  }
  return cache.graph;
}

export function useStreetGraph(): StreetGraph | null {
  // subscribe so components re-render when a new area is loaded
  useAreaStore((s) => s.roads);
  useAreaStore((s) => s.projection);
  return getStreetGraph();
}
