import { useEffect, useRef, useMemo, useState } from "react";
import { CardSheet } from "@/components/CardSheet";
import { isMobileNow } from "@/components/useIsMobile";
import { Canvas, useThree } from "@react-three/fiber";
import { useAreaStore } from "@/state/areaStore";
import { Html } from "@react-three/drei";
import { create } from "zustand";
import * as THREE from "three";
import { useActionStore } from "@/state/exportStore";
import { GLTFExporter } from "three/examples/jsm/Addons.js";
import { CameraControls } from "./CameraControls";
import { WalkControls } from "@/walk/WalkControls";
import { useWalkStore } from "@/walk/walkStore";
import { footprintToShape } from "./geo";
import { buildRoadShape, clipPolylineToBbox, type LatLon } from "./polyline";
import { buildBuildingGeometry } from "./roofs";
import { applyFacadeShader, applySettShader, setFacadeNight } from "./surfaceShaders";
import { DETAIL_GHOST_THEME, StreetDetails } from "./StreetDetails";
import { DayLighting, WeatherEffects } from "@/weather/WeatherEffects";
import { OpenDataScene } from "@/opendata/OpenDataScene";
import { buildingPlacement, drapeGeometry, groundAtWorld } from "./terrain";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { useGhostStore } from "@/ghost/ghostStore";
import { GhostScene } from "@/ghost/GhostScene";
import { BuildingCard, type BuildingInfo } from "./BuildingCard";

const ROAD_MAT = new THREE.MeshStandardMaterial({ color: "#3d3d3d" });
const PATH_MAT = new THREE.MeshStandardMaterial({ color: "#888888" });
// Buildings carry their own facade/roof colours as vertex colours (see roofs.ts);
// the material colour acts as a tint (white by day, dark blue in Ghost Mode).
const BUILDING_MAT = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.85 });
applyFacadeShader(BUILDING_MAT);
// Cobblestone streets (OSM surface=sett / paving_stones)
const SETT_MAT = new THREE.MeshStandardMaterial({ color: "#8f887d", roughness: 0.95 });
applySettShader(SETT_MAT);
const BUILDING_ACTIVE_MAT = new THREE.MeshStandardMaterial({ color: "#007bff" });
// Opaque ground material used in GLB export
const GROUND_MAT = new THREE.MeshStandardMaterial({ color: "#888888", roughness: 1, metalness: 0 });
// Ghost version shown in the browser preview — same colour, barely visible
const GROUND_PREVIEW_MAT = new THREE.MeshStandardMaterial({ color: "#a9a59b", roughness: 1, metalness: 0, transparent: true, opacity: 0.95, depthWrite: false });

// ── New feature materials ──────────────────────────────────────────────────
const PARK_MAT    = new THREE.MeshStandardMaterial({ color: "#4a7c59", roughness: 1, metalness: 0 });
const WATER_MAT   = new THREE.MeshStandardMaterial({ color: "#2c5f7a", roughness: 0.3, metalness: 0 });
const FOREST_MAT  = new THREE.MeshStandardMaterial({ color: "#2d5a27", roughness: 1, metalness: 0 });
const RAILWAY_MAT = new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 1, metalness: 0 });
const PILLAR_MAT  = new THREE.MeshStandardMaterial({ color: "#5a5a5a", roughness: 0.8, metalness: 0 });

// ── Ghost Mode theme ───────────────────────────────────────────────────────
// The shared materials are recoloured in place, so every mesh switches theme
// without re-rendering. Original colours are restored when Ghost Mode is off.
const GHOST_THEME: Array<[THREE.MeshStandardMaterial, string, string?]> = [
  [BUILDING_MAT,        "#5a6194", "#0a0820"],
  [BUILDING_ACTIVE_MAT, "#8b5cf6", "#4c1d95"],
  [ROAD_MAT,            "#1d2142"],
  [PATH_MAT,            "#2c2552"],
  [SETT_MAT,            "#2a2446"],
  [GROUND_PREVIEW_MAT,  "#080914"],
  [PARK_MAT,            "#123a33", "#04120f"],
  [WATER_MAT,           "#143070", "#0a1a4a"],
  [FOREST_MAT,          "#0f2e22"],
  [RAILWAY_MAT,         "#1b1b33"],
  [PILLAR_MAT,          "#2e3260"],
  ...DETAIL_GHOST_THEME,
];
const DAY_THEME = GHOST_THEME.map(([m]) => [m, "#" + m.color.getHexString(), "#" + m.emissive.getHexString()] as const);
const DAY_GROUND_OPACITY = GROUND_PREVIEW_MAT.opacity;

function applyGhostTheme(on: boolean) {
  const theme = on ? GHOST_THEME : DAY_THEME;
  for (const [mat, color, emissive] of theme) {
    mat.color.set(color);
    mat.emissive.set(emissive ?? "#000000");
  }
  GROUND_PREVIEW_MAT.opacity = on ? 0.96 : DAY_GROUND_OPACITY;
  setFacadeNight(on);
}

// ── Y offsets (scene units) ────────────────────────────────────────────────
const BRIDGE_Y           =  3.0;
const PARK_Y             = -0.02;
const WATER_POLYGON_Y    = -0.05;
const WATER_RIBBON_Y     = -0.04;
const FOREST_Y           = -0.01;
const RAILWAY_Y          =  0.02;

// ── Polyline half-widths for new ribbon features ───────────────────────────
const RIVER_HALF_WIDTH   = 4.0;
const STREAM_HALF_WIDTH  = 1.0;
const RAILWAY_HALF_WIDTH = 0.8;

// ── Flat extrude settings (thin slab for ground-level polygons) ────────────
const FLAT_EXTRUDE = { steps: 1, depth: 0.05, bevelEnabled: false } as const;

// Only one building info card is pinned at a time. It closes with its × button,
// by clicking empty space (Canvas onPointerMissed) or by pressing Escape.
const useBuildingSelection = create<{
  key: string | null;
  pos: THREE.Vector3 | null;
  /** CSS transform that keeps the card on screen (chosen from where you clicked). */
  placement: string;
  /** Building under the pointer (overview only) – drawn as an outline. */
  hoverKey: string | null;
  select: (key: string | null, pos?: THREE.Vector3 | null, screen?: { x: number; y: number }) => void;
  setHover: (key: string | null) => void;
}>((set) => ({
  key: null,
  pos: null,
  hoverKey: null,
  placement: "translate(-50%, calc(-100% - 14px))",
  setHover: (hoverKey) => set({ hoverKey }),
  select: (key, pos = null, screen) => {
    let placement = "translate(-50%, calc(-100% - 14px))"; // above the point
    if (screen) {
      const below = screen.y < window.innerHeight * 0.5;
      const x = screen.x < 360 ? "-10%" : screen.x > window.innerWidth - 360 ? "-90%" : "-50%";
      placement = below ? `translate(${x}, 24px)` : `translate(${x}, calc(-100% - 14px))`;
    }
    set({ key, pos, placement });
  },
}));

const HOVER_EDGE_MAT = new THREE.LineBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.9, depthTest: false });

/**
 * Outline of the hovered and the selected building. Rendered outside the
 * building group so it also shows when the Blender model replaces the buildings.
 */
function BuildingOutlines({ items }: { items: Array<{ key: string; geometry: THREE.BufferGeometry }> }) {
  const hoverKey = useBuildingSelection((s) => s.hoverKey);
  const selectedKey = useBuildingSelection((s) => s.key);
  const keys = [...new Set([hoverKey, selectedKey].filter(Boolean))] as string[];
  const edges = useMemo(
    () => keys.map((k) => items.find((i) => i.key === k)).filter(Boolean).map((i) => new THREE.EdgesGeometry(i!.geometry, 25)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys.join(","), items]
  );
  useEffect(() => () => edges.forEach((e) => e.dispose()), [edges]);
  return <>{edges.map((g, i) => <lineSegments key={i} geometry={g} material={HOVER_EDGE_MAT} renderOrder={3} raycast={() => null} />)}</>;
}

function Building({
  id,
  geometry,
  info,
}: {
  id: string;
  geometry: THREE.BufferGeometry;
  info: BuildingInfo;
}) {
  // At street level hovering walls would flicker constantly – only hover in the overview.
  const overview = useWalkStore((s) => s.mode === "orbit");
  const clicked = useBuildingSelection((s) => s.key === id);
  const pinnedPos = useBuildingSelection((s) => (s.key === id ? s.pos : null));
  const placement = useBuildingSelection((s) => s.placement);
  const select = useBuildingSelection((s) => s.select);
  const setHover = useBuildingSelection((s) => s.setHover);

  return (
    <mesh
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!overview) return;
        setHover(id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        if (useBuildingSelection.getState().hoverKey === id) setHover(null);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        select(clicked ? null : id, e.point.clone(), { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
        e.stopPropagation();
      }}
      geometry={geometry}
      material={clicked ? BUILDING_ACTIVE_MAT : BUILDING_MAT}
      userData={{ exportToGLB: true }}
    >
      {clicked && pinnedPos && (
        <Html
          position={[pinnedPos.x, pinnedPos.y + 0.5, pinnedPos.z]}
          // above the clock/intro panels (≈1500) but below the top bar (2000)
          zIndexRange={[1600, 1500]}
          // Next to the clicked point (above or below, nudged inwards near the edges) – never covering it.
          style={{ transform: placement }}
        >
          <CardSheet><BuildingCard info={info} onClose={() => select(null)} /></CardSheet>
        </Html>
      )}
    </mesh>
  );
}

// Highway types rendered as pedestrian paths (lighter material, narrower).
const PEDESTRIAN_TYPES = new Set([
  "footway", "path", "steps", "pedestrian", "track", "cycleway",
]);

// Half-widths in scene units (1 unit ≈ 2 m at mid-latitudes).
// Keyed by OSM highway tag value.
const ROAD_HALF_WIDTH: Record<string, number> = {
  motorway: 4.5,
  motorway_link: 2.5,
  trunk: 3.5,
  trunk_link: 2.0,
  primary: 3.0,
  primary_link: 2.0,
  secondary: 2.5,
  secondary_link: 1.8,
  tertiary: 2.0,
  tertiary_link: 1.5,
  residential: 1.8,
  living_street: 1.6,
  unclassified: 1.8,
  service: 1.2,
  // Pedestrian / non-vehicle — narrow
  pedestrian: 2.2, // pedestrian streets such as Haga Nygata are full-width streets
  footway: 0.4,
  cycleway: 0.4,
  path: 0.35,
  track: 0.45,
  steps: 0.3,
};
const DEFAULT_ROAD_HALF_WIDTH = 1.5;

const ROAD_EXTRUDE = { steps: 1, depth: 0.1, bevelEnabled: false } as const;

// ── Polygon ring → THREE.Shape ─────────────────────────────────────────────

import type { PolygonRing, PolylineElem } from "@/state/areaStore";

type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/**
 * Sutherland-Hodgman polygon clip against an axis-aligned lat/lon bbox.
 * Clips the ring against each of the 4 half-planes in turn.
 * Returns null if the clipped result has fewer than 3 vertices.
 */
function clipPolygonRingToBbox(
  ring: Array<{ lat: number; lon: number }>,
  minLat: number, maxLat: number,
  minLng: number, maxLng: number
): Array<{ lat: number; lon: number }> | null {
  const lerp = (
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
    t: number
  ) => ({ lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) });

  type Plane = {
    inside: (p: { lat: number; lon: number }) => boolean;
    intersect: (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => { lat: number; lon: number };
  };

  const planes: Plane[] = [
    // left: lon >= minLng
    { inside: (p) => p.lon >= minLng, intersect: (a, b) => lerp(a, b, (minLng - a.lon) / (b.lon - a.lon)) },
    // right: lon <= maxLng
    { inside: (p) => p.lon <= maxLng, intersect: (a, b) => lerp(a, b, (maxLng - a.lon) / (b.lon - a.lon)) },
    // bottom: lat >= minLat
    { inside: (p) => p.lat >= minLat, intersect: (a, b) => lerp(a, b, (minLat - a.lat) / (b.lat - a.lat)) },
    // top: lat <= maxLat
    { inside: (p) => p.lat <= maxLat, intersect: (a, b) => lerp(a, b, (maxLat - a.lat) / (b.lat - a.lat)) },
  ];

  // Remove closing duplicate point if present before processing.
  let poly = ring.slice();
  if (poly.length > 1) {
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-10 && Math.abs(first.lon - last.lon) < 1e-10) {
      poly = poly.slice(0, -1);
    }
  }

  for (const plane of planes) {
    if (poly.length === 0) return null;
    const input = poly;
    poly = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const aIn = plane.inside(a);
      const bIn = plane.inside(b);
      if (aIn) {
        poly.push(a);
        if (!bIn) poly.push(plane.intersect(a, b));
      } else if (bIn) {
        poly.push(plane.intersect(a, b));
      }
    }
  }

  return poly.length >= 3 ? poly : null;
}

/**
 * Signed area of a 2-D polygon using the shoelace formula.
 * Result > 0 → counter-clockwise (CCW).
 * Result < 0 → clockwise (CW).
 * The array must NOT contain a closing duplicate — wrap-around is handled via modulo.
 */
function signedArea2D(pts: THREE.Vector2[]): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

/**
 * Projects a polygon ring into a THREE.Shape, applying bbox clipping and
 * winding-order correction as needed.
 *
 * Strategy (AABB-based, no arbitrary thresholds):
 *  1. Compute the ring's AABB in lat/lon space.
 *  2. AABB doesn't intersect scene bbox → skip (completely outside).
 *  3. AABB fully inside scene bbox → project as-is (no clipping needed).
 *  4. AABB partially overlaps → clip with Sutherland-Hodgman, then project.
 *
 * After projection, the winding order is normalised to CCW using the shoelace
 * formula. THREE.ShapeGeometry requires CCW outer rings; a CW ring is treated
 * as a hole and triangulates to just edge slivers.
 *
 * Returns null to indicate "skip this ring".
 */
function buildPolygonShapeClipped(
  ring: PolygonRing["ring"],
  refLat: number,
  refLng: number,
  scaleX: number,
  scaleY: number,
  bbox: BBox
): THREE.Shape | null {
  if (ring.length < 3) return null;

  const { minLat, maxLat, minLng, maxLng } = bbox;

  // Compute the ring's AABB in lat/lon space.
  let rMinLat = Infinity, rMaxLat = -Infinity;
  let rMinLng = Infinity, rMaxLng = -Infinity;
  for (const pt of ring) {
    if (pt.lat < rMinLat) rMinLat = pt.lat;
    if (pt.lat > rMaxLat) rMaxLat = pt.lat;
    if (pt.lon < rMinLng) rMinLng = pt.lon;
    if (pt.lon > rMaxLng) rMaxLng = pt.lon;
  }

  // 2. No overlap at all → skip.
  const aabbOverlaps =
    rMaxLng >= minLng && rMinLng <= maxLng &&
    rMaxLat >= minLat && rMinLat <= maxLat;
  if (!aabbOverlaps) return null;

  // 3/4. Fully inside → project as-is; partially outside → clip first.
  const fullyInside =
    rMinLat >= minLat && rMaxLat <= maxLat &&
    rMinLng >= minLng && rMaxLng <= maxLng;

  let workingRing: typeof ring;
  if (fullyInside) {
    workingRing = ring;
  } else {
    const clipped = clipPolygonRingToBbox(ring, minLat, maxLat, minLng, maxLng);
    if (!clipped || clipped.length < 3) return null;
    workingRing = clipped;
  }

  // Project to scene coordinates.
  const pts = workingRing.map((pt) => new THREE.Vector2(
    (pt.lon - refLng) * scaleX,
    (pt.lat - refLat) * scaleY,
  ));

  // Strip any closing duplicate before the winding check so modulo wrap-around
  // is correct (the shoelace formula must not double-count the closing edge).
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) {
    pts.pop();
  }
  if (pts.length < 3) return null;

  // Normalise to CCW: THREE.ShapeGeometry triangulates CCW rings as filled
  // faces; a CW outer ring is treated as a hole and produces only edge slivers.
  if (signedArea2D(pts) < 0) pts.reverse();

  // Re-close the path for THREE.Shape.
  pts.push(pts[0].clone());
  return new THREE.Shape(pts);
}

// Flat features are subdivided before being draped over the terrain, so long
// edges follow the ground instead of cutting through hills.
const TESSELLATOR = new TessellateModifier(5, 5);

/** Extrudes a flat (rotated -90° X) shape and lays it onto the terrain. */
function useDrapedExtrude(shape: THREE.Shape, settings: THREE.ExtrudeGeometryOptions) {
  const terrain = useAreaStore((state) => state.terrain);
  const projection = useAreaStore((state) => state.projection);
  const geometry = useMemo(() => {
    const flat = new THREE.ExtrudeGeometry(shape, settings);
    if (!terrain || !projection) return flat;
    const fine = TESSELLATOR.modify(flat);
    flat.dispose();
    // Local (x, y, z) of a mesh rotated -90° around X is world (x, z, -y).
    return drapeGeometry(fine, terrain, projection, (x, y) => [x, -y], "z");
  }, [shape, settings, terrain, projection]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function RoadMesh({
  shape,
  material,
  yPos = 0,
}: {
  shape: THREE.Shape;
  material: THREE.MeshStandardMaterial;
  yPos?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const geometry = useDrapedExtrude(shape, ROAD_EXTRUDE);
  useEffect(() => {
    meshRef.current.userData.exportToGLB = true;
  }, []);
  return <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, yPos, 0]} material={material} />;
}

// ── Bridge support pillar ──────────────────────────────────────────────────

function BridgePillar({ cx, cz, cy = 0 }: { cx: number; cz: number; cy?: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  useEffect(() => {
    meshRef.current.userData.exportToGLB = true;
  }, []);
  // Pillar spans from y=0 to y=BRIDGE_Y; positioned at centroid of road ribbon.
  return (
    <mesh
      ref={meshRef}
      position={[cx, cy + BRIDGE_Y / 2, cz]}
      material={PILLAR_MAT}
    >
      <boxGeometry args={[0.6, BRIDGE_Y, 0.6]} />
    </mesh>
  );
}

// ── Flat polygon mesh (parks, water, forests) ──────────────────────────────

function FlatPolygonMesh({
  shape,
  material,
  yPos,
}: {
  shape: THREE.Shape;
  material: THREE.MeshStandardMaterial;
  yPos: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const geometry = useDrapedExtrude(shape, FLAT_EXTRUDE);
  useEffect(() => {
    meshRef.current.userData.exportToGLB = true;
  }, []);
  return <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, yPos, 0]} material={material} />;
}

function RoadMeshes() {
  const roads = useAreaStore((state) => state.roads);
  const projection = useAreaStore((state) => state.projection);
  const terrain = useAreaStore((state) => state.terrain);

  const roadItems = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return roads.flatMap((road, i) => {
      if (!road.geometry || road.geometry.length < 2) return [];
      const highwayType: string = road.tags?.highway ?? "";
      // Use the mapped street width when OSM has one (metres → scene units).
      const widthTag = parseFloat(road.tags?.width ?? "");
      const halfW = !isNaN(widthTag) && widthTag > 0 ? widthTag / 2 / 2.183 : ROAD_HALF_WIDTH[highwayType] ?? DEFAULT_ROAD_HALF_WIDTH;
      const surface: string = road.tags?.surface ?? "";
      const material = ["sett", "paving_stones", "cobblestone", "unhewn_cobblestone"].includes(surface)
        ? SETT_MAT
        : PEDESTRIAN_TYPES.has(highwayType) ? PATH_MAT : ROAD_MAT;
      const isBridge = road.tags?.bridge === "yes";
      const yPos = isBridge ? BRIDGE_Y : 0;

      const clippedChains = clipPolylineToBbox(
        road.geometry as LatLon[],
        bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
      );

      return clippedChains.flatMap((chain, ci) => {
        const pts2d = chain.map((pt) => new THREE.Vector2(
          (pt.lon - refLng) * scaleX,
          (pt.lat - refLat) * scaleY,
        ));
        const shape = buildRoadShape(pts2d, halfW);
        if (!shape) return [];

        // Pillar centroid: average of 2-D ribbon points.
        // In the mesh's local frame (rotated -90° around X), the scene-space
        // X maps to pts2d.x and scene-space Z maps to -pts2d.y.
        const cx = pts2d.reduce((s, p) => s + p.x, 0) / pts2d.length;
        const cz = -(pts2d.reduce((s, p) => s + p.y, 0) / pts2d.length);

        const cy = groundAtWorld(terrain, projection, cx, cz);
        return [{ shape, material, yPos, isBridge, cx, cz, cy, key: `${road.id ?? i}-${ci}` }];
      });
    });
  }, [roads, projection, terrain]);

  return (
    <>
      {roadItems.map(({ shape, material, yPos, isBridge, cx, cz, cy, key }) => (
        <group key={key}>
          <RoadMesh shape={shape} material={material} yPos={yPos} />
          {isBridge && <BridgePillar cx={cx} cz={cz} cy={cy} />}
        </group>
      ))}
    </>
  );
}

// ── Parks + grass ──────────────────────────────────────────────────────────

function GreenMeshes() {
  const parks = useAreaStore((state) => state.parks);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return parks.flatMap(({ key, ring }) => {
      const shape = buildPolygonShapeClipped(ring, refLat, refLng, scaleX, scaleY, bbox);
      if (!shape) return [];
      return [{ shape, key }];
    });
  }, [parks, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <FlatPolygonMesh key={key} shape={shape} material={PARK_MAT} yPos={PARK_Y} />
      ))}
    </>
  );
}

// ── Water polygons ─────────────────────────────────────────────────────────

function WaterPolygonMeshes() {
  const waterPolygons = useAreaStore((state) => state.waterPolygons);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return waterPolygons.flatMap(({ key, ring }) => {
      const shape = buildPolygonShapeClipped(ring, refLat, refLng, scaleX, scaleY, bbox);
      if (!shape) return [];
      return [{ shape, key }];
    });
  }, [waterPolygons, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <FlatPolygonMesh key={key} shape={shape} material={WATER_MAT} yPos={WATER_POLYGON_Y} />
      ))}
    </>
  );
}

// ── Rivers + streams (ribbon mesh) ────────────────────────────────────────

function WaterRibbonMeshes() {
  const rivers = useAreaStore((state) => state.rivers);
  const streams = useAreaStore((state) => state.streams);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;

    const process = (elems: PolylineElem[], halfW: number) =>
      elems.flatMap((el, i) => {
        const clipped = clipPolylineToBbox(
          el.geometry as LatLon[],
          bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
        );
        return clipped.flatMap((chain, ci) => {
          const pts2d = chain.map((pt) => new THREE.Vector2(
            (pt.lon - refLng) * scaleX,
            (pt.lat - refLat) * scaleY,
          ));
          const shape = buildRoadShape(pts2d, halfW);
          if (!shape) return [];
          return [{ shape, key: `${el.id ?? i}-${ci}` }];
        });
      });

    return [
      ...process(rivers, RIVER_HALF_WIDTH),
      ...process(streams, STREAM_HALF_WIDTH),
    ];
  }, [rivers, streams, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <RoadMesh key={key} shape={shape} material={WATER_MAT} yPos={WATER_RIBBON_Y} />
      ))}
    </>
  );
}

// ── Forests ────────────────────────────────────────────────────────────────

function ForestMeshes() {
  const forests = useAreaStore((state) => state.forests);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return forests.flatMap(({ key, ring }) => {
      const shape = buildPolygonShapeClipped(ring, refLat, refLng, scaleX, scaleY, bbox);
      if (!shape) return [];
      return [{ shape, key }];
    });
  }, [forests, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <FlatPolygonMesh key={key} shape={shape} material={FOREST_MAT} yPos={FOREST_Y} />
      ))}
    </>
  );
}

// ── Railways ───────────────────────────────────────────────────────────────

function RailwayMeshes() {
  const railways = useAreaStore((state) => state.railways);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return railways.flatMap((el, i) => {
      const clipped = clipPolylineToBbox(
        el.geometry as LatLon[],
        bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
      );
      return clipped.flatMap((chain, ci) => {
        const pts2d = chain.map((pt) => new THREE.Vector2(
          (pt.lon - refLng) * scaleX,
          (pt.lat - refLat) * scaleY,
        ));
        const shape = buildRoadShape(pts2d, RAILWAY_HALF_WIDTH);
        if (!shape) return [];
        return [{ shape, key: `rail-${el.id ?? i}-${ci}` }];
      });
    });
  }, [railways, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <RoadMesh key={key} shape={shape} material={RAILWAY_MAT} yPos={RAILWAY_Y} />
      ))}
    </>
  );
}

// Stable position — module-level constant so R3F never sees a new array reference.
const GROUND_POSITION: [number, number, number] = [0, -0.25, 0];
// The terrain surface sits just below draped roads and parks.
const TERRAIN_POSITION: [number, number, number] = [0, -0.06, 0];

// sceneWidth / sceneDepth are computed in Space via useMemo(…, [center]) so they
// only change when the user generates a new scene, never on canvas resize.
function GroundPlane({ sceneWidth, sceneDepth }: { sceneWidth: number; sceneDepth: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const includeGroundPlane = useActionStore((state) => state.includeGroundPlane);
  const terrain = useAreaStore((state) => state.terrain);
  const projection = useAreaStore((state) => state.projection);

  // With terrain: a subdivided surface lifted to the height grid.
  const terrainGeometry = useMemo(() => {
    if (!terrain || !projection || !sceneWidth) return null;
    const g = new THREE.PlaneGeometry(sceneWidth, sceneDepth, 120, 120).rotateX(-Math.PI / 2);
    return drapeGeometry(g, terrain, projection, (x, _y, z) => [x, z], "y");
  }, [terrain, projection, sceneWidth, sceneDepth]);
  useEffect(() => () => terrainGeometry?.dispose(), [terrainGeometry]);

  // Stable args tuple — only a new array when dimensions actually change.
  const boxArgs = useMemo<[number, number, number]>(
    () => [sceneWidth, 0.5, sceneDepth],
    [sceneWidth, sceneDepth]
  );

  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.userData.exportToGLB = true;
    meshRef.current.userData.groundPlane = true;
  }, []);

  if (!includeGroundPlane) return null;

  // Top face sits at y = 0, flush with building bases.
  // X = longitudinal span, Z = latitudinal span (world Z after building rotation).
  if (terrainGeometry) {
    return (
      <mesh ref={meshRef} geometry={terrainGeometry} position={TERRAIN_POSITION} material={GROUND_PREVIEW_MAT} userData={{ exportToGLB: true, groundPlane: true }} />
    );
  }
  return (
    <mesh ref={meshRef} position={GROUND_POSITION} material={GROUND_PREVIEW_MAT}>
      <boxGeometry args={boxArgs} />
    </mesh>
  );
}

export function Export() {
  const { scene } = useThree();
  const action = useActionStore((state) => state.action);

  const exportType = useActionStore((state) => state.exportType);

  const setAction = useActionStore((state) => state.setAction);

  useEffect(() => {
    if (action === true) {
      setAction(false);
      exportGLB();
    }
  }, [action, setAction, scene]);

  const exportGLB = () => {
    const exportRoot = new THREE.Group();
    scene.traverse((child) => {
      if (child.userData?.exportToGLB === true) {
        const clone = child.clone(true);
        // Swap preview material → opaque export material on the ground plane
        if (child.userData?.groundPlane === true && clone instanceof THREE.Mesh) {
          clone.material = GROUND_MAT;
        }
        exportRoot.add(clone);
      }
    });
    const exporter = new GLTFExporter();
    const options = { binary: true, embedImages: true };
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: "model/gltf-binary" });

          if (exportType == "glb") {
            const link = document.createElement("a");
            link.style.display = "none";
            document.body.appendChild(link);
            link.href = URL.createObjectURL(blob);
            link.download = "scene.glb";
            link.click();
            document.body.removeChild(link);
          }
        } else {
          console.error("GLB export failed: unexpected result", result);
        }
      },
      (error) => {
        console.error("An error occurred during export", error);
      },
      options
    );
  };
  return null;
}

export function Space() {
  const areas = useAreaStore((state) => state.areas);
  const projection = useAreaStore((state) => state.projection);
  const terrain = useAreaStore((state) => state.terrain);
  const ghostMode = useGhostStore((state) => state.ghostMode);
  // When the Blender-enhanced model is shown, Mapforge's own meshes are hidden
  // (but stay clickable and exportable).
  const hideProcedural = useGhostStore(
    (s) => s.ghostMode && s.layers.model && s.modelUrl !== null && s.modelStatus === "loaded"
  );

  useEffect(() => applyGhostTheme(ghostMode), [ghostMode]);

  const pointerDown = useRef<[number, number]>([0, 0]);

  // Entering walk mode closes a pinned building card.
  const walkMode = useWalkStore((s) => s.mode);
  useEffect(() => {
    if (walkMode === "entering") useBuildingSelection.getState().select(null);
  }, [walkMode]);

  // Escape closes a pinned building card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        useBuildingSelection.getState().select(null);
        useGhostStore.getState().selectAcoustic(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ground plane dimensions — frozen at generation time via projection store.
  // Never recalculates on canvas/viewport resize.
  const { groundSceneWidth, groundSceneDepth } = useMemo(() => {
    if (!projection) return { groundSceneWidth: 0, groundSceneDepth: 0 };
    const { bbox, scaleX, scaleY } = projection;
    return {
      groundSceneWidth: (bbox.maxLng - bbox.minLng) * scaleX * 1.2,
      groundSceneDepth: (bbox.maxLat - bbox.minLat) * scaleY * 1.2,
    };
  }, [projection]);

  const buildingsData = useMemo(() => {
    if (!projection) return [];
    const result: Array<{ geometry: THREE.BufferGeometry; key: string; info: BuildingInfo }> = [];
    areas.forEach((bld: any, i: number) => {
      if (!bld.geometry || bld.geometry.length < 3) return;
      const pts = footprintToShape(projection, bld.geometry);
      if (pts.length < 3) return;
      const place = buildingPlacement(terrain, bld.geometry);
      const { geometry } = buildBuildingGeometry(pts, bld.tags ?? {}, bld.id ?? i, place);
      const key = String(bld.id ?? i);
      result.push({ geometry, key, info: { id: key, osmType: bld.osmType, tags: bld.tags ?? {}, ring: bld.geometry, pts, base: place.base } });
    });
    return result;
  }, [areas, projection, terrain]);

  useEffect(() => () => buildingsData.forEach((b) => b.geometry.dispose()), [buildingsData]);

  return (
    <Canvas
      // Phones: cap the pixel ratio (big battery/GPU saving) and start further out so
      // the whole area fits a portrait screen.
      dpr={[1, isMobileNow() ? 1.5 : 2]}
      camera={{ fov: 60, near: 0.5, far: 7000, position: isMobileNow() ? [120, 300, 380] : [90, 170, 230] }}
      onPointerDown={(e) => { pointerDown.current = [e.clientX, e.clientY]; }}
      onPointerMissed={(e) => {
        // Close only on a real click on empty space – not at the end of a camera drag.
        const [x, y] = pointerDown.current;
        if (Math.hypot(e.clientX - x, e.clientY - y) < 5) {
          useBuildingSelection.getState().select(null);
          // While walking, a click on open ground means "walk there".
          useWalkStore.getState().requestWalkTo(e.clientX, e.clientY);
        }
      }}
    >
      {/* Day mode follows the real sun and clouds over Haga; Ghost Mode is always night */}
      {!ghostMode && <DayLighting />}
      <WeatherEffects />
      <OpenDataScene />
      {ghostMode && <GhostScene buildings={buildingsData} />}
      <group visible={!hideProcedural}>
      <GroundPlane sceneWidth={groundSceneWidth} sceneDepth={groundSceneDepth} />
      <GreenMeshes />
      <WaterPolygonMeshes />
      <ForestMeshes />
      <WaterRibbonMeshes />
      <RailwayMeshes />
      <RoadMeshes />
      {buildingsData.map((item) => (
        <Building key={item.key} id={item.key} geometry={item.geometry} info={item.info} />
      ))}
      </group>
      <BuildingOutlines items={buildingsData} />
      {/* Trees, tram tracks, lamps … stay visible with the Blender model too */}
      <StreetDetails />
      <CameraControls />
      <WalkControls />
      <Export />
    </Canvas>
  );
}
