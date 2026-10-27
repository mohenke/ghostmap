// Street details from OpenStreetMap: trees, tram tracks, walls, benches and
// street lamps. Repeated objects are drawn as InstancedMesh (one draw call per
// kind), so hundreds of trees and lamps stay cheap.
//
// These meshes are visual only: they ignore pointer events (clicks still reach
// buildings and sensors) and are not part of the GLB export.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useAreaStore, type PolylineElem, type Projection } from "@/state/areaStore";
import { useGhostStore } from "@/ghost/ghostStore";
import { getGlowTexture } from "@/ghost/glow";
import { METERS_PER_UNIT } from "./geo";
import { buildRoadShape, clipPolylineToBbox, offsetPolyline, type LatLon } from "./polyline";
import { drapeGeometry, groundAtWorld } from "./terrain";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";

const TESSELLATOR = new TessellateModifier(3, 5);

const noRaycast = () => null;

// ── materials (recoloured by the Ghost Mode theme in Space.tsx) ────────────
export const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: "#5b4636", roughness: 1 });
/** Crown colours are per instance (autumn palette); the material colour tints them. */
export const CROWN_MAT = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true });
export const TRAM_BED_MAT = new THREE.MeshStandardMaterial({ color: "#4d4a46", roughness: 1 });
export const RAIL_MAT = new THREE.MeshStandardMaterial({ color: "#a3a8ad", roughness: 0.35, metalness: 0.8 });
export const WALL_MAT = new THREE.MeshStandardMaterial({ color: "#8c857a", roughness: 1 });
export const BENCH_MAT = new THREE.MeshStandardMaterial({ color: "#7a5a3a", roughness: 0.9 });
export const LAMP_POST_MAT = new THREE.MeshStandardMaterial({ color: "#2f3236", roughness: 0.6, metalness: 0.6 });
export const LAMP_HEAD_MAT = new THREE.MeshStandardMaterial({ color: "#d9d4c5", roughness: 0.4 });

// Wind in the tree crowns: the vertex shader shifts crown vertices (more at the top)
// in the wind direction. Uniforms are driven by the weather (weather/WeatherEffects.tsx).
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0, 0) }, // world x / z lean in scene units
  uFreq: { value: 1 },
};
CROWN_MAT.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uFreq;")
    .replace(
      "#include <project_vertex>",
      `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
float sway = sin(uTime * uFreq * 1.6 + mvPosition.x * 0.35 + mvPosition.z * 0.27) * 0.5 + 0.5;
float lift = clamp(transformed.y + 1.0, 0.0, 2.0) * 0.5;
mvPosition.xz += uWind * (0.35 + 0.65 * sway) * lift;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`
    );
};
CROWN_MAT.customProgramCacheKey = () => "gp-crown-wind";

/** [material, ghost colour, ghost emissive] – merged into the Ghost Mode theme. */
export const DETAIL_GHOST_THEME: Array<[THREE.MeshStandardMaterial, string, string?]> = [
  [TRUNK_MAT, "#14121c"],
  [CROWN_MAT, "#1e2a3c", "#03060c"],
  [TRAM_BED_MAT, "#14152a"],
  [RAIL_MAT, "#5a5f7a"],
  [WALL_MAT, "#262a45"],
  [BENCH_MAT, "#1c1a2a"],
  [LAMP_POST_MAT, "#15161f"],
  [LAMP_HEAD_MAT, "#ffd9a0", "#ffb35c"], // lamps glow at night
];

// Late-October Göteborg: mostly green, with yellow, orange and rust crowns.
const AUTUMN = ["#4f7a3a", "#5d7f45", "#6b8f3a", "#4a6e35", "#b5962e", "#c77b2a", "#a3502a", "#8a7a34"].map((c) => new THREE.Color(c));

const TREE_ROW_SPACING = 3.6; // ≈ 8 m between trees in an avenue
const TRACK_HALF_GAUGE = 0.33; // 1 435 mm gauge in scene units (≈ 0.72 m / 2.18)
const LAMP_HEIGHT = 2.2; // ≈ 4.8 m

function hash01(seed: number | string, salt = 0) {
  const s = String(seed);
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function inBbox(p: Projection, lat: number, lon: number) {
  const b = p.bbox;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLng && lon <= b.maxLng;
}

/** lat/lon → world [x, z] */
const toWorld = (p: Projection, lat: number, lon: number): [number, number] => [(lon - p.refLng) * p.scaleX, -(lat - p.refLat) * p.scaleY];
/** lat/lon → shape space (x east, y north), as used by the ribbon builders */
const toShape = (p: Projection, pt: LatLon) => new THREE.Vector2((pt.lon - p.refLng) * p.scaleX, (pt.lat - p.refLat) * p.scaleY);

function clippedChains(p: Projection, el: PolylineElem): THREE.Vector2[][] {
  const { minLat, maxLat, minLng, maxLng } = p.bbox;
  return clipPolylineToBbox(el.geometry as LatLon[], minLat, maxLat, minLng, maxLng).map((chain) => chain.map((pt) => toShape(p, pt)));
}

/** Points every `spacing` units along a shape-space chain. */
function sampleChain(chain: THREE.Vector2[], spacing: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  let carry = spacing / 2;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const seg = chain[i + 1].clone().sub(a);
    const len = seg.length();
    let pos = carry;
    while (pos < len) {
      out.push(a.clone().addScaledVector(seg, pos / len));
      pos += spacing;
    }
    carry = pos - len;
  }
  return out;
}

// ── instanced helper ───────────────────────────────────────────────────────

type Instance = { matrix: THREE.Matrix4; color?: THREE.Color };

function Instances({
  geometry,
  material,
  items,
  visible = true,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Instance[];
  visible?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} raycast={noRaycast} visible={visible} frustumCulled={false} />;
}

const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));

// Shared unit geometries
const TRUNK_GEO = new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
const CROWN_GEO = new THREE.IcosahedronGeometry(1, 1);
const BENCH_GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const POST_GEO = new THREE.CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0);
const HEAD_GEO = new THREE.SphereGeometry(0.14, 10, 8);
const POOL_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// ── component ──────────────────────────────────────────────────────────────

export function StreetDetails() {
  const projection = useAreaStore((s) => s.projection);
  const details = useAreaStore((s) => s.details);
  const terrain = useAreaStore((s) => s.terrain);
  const ghostMode = useGhostStore((s) => s.ghostMode);

  const poolMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: "#ffb35c", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    []
  );

  const data = useMemo(() => {
    if (!projection) return null;
    const p = projection;
    const g = (x: number, z: number) => groundAtWorld(terrain, p, x, z);

    // Trees: individual trees + avenues sampled along tree rows.
    const treeSpots: Array<{ x: number; z: number; seed: string; tags: any }> = [];
    for (const t of details.trees) {
      if (!inBbox(p, t.lat, t.lon)) continue;
      const [x, z] = toWorld(p, t.lat, t.lon);
      treeSpots.push({ x, z, seed: String(t.id), tags: t.tags });
    }
    for (const row of details.treeRows) {
      for (const chain of clippedChains(p, row)) {
        sampleChain(chain, TREE_ROW_SPACING).forEach((pt, i) => treeSpots.push({ x: pt.x, z: -pt.y, seed: `${row.id}-${i}`, tags: row.tags }));
      }
    }
    const trunks: Instance[] = [];
    const crowns: Instance[] = [];
    for (const t of treeSpots) {
      const tagged = parseFloat(t.tags?.height ?? "");
      const h = !isNaN(tagged) && tagged > 0 ? tagged / METERS_PER_UNIT : 4 + hash01(t.seed, 1) * 2.5; // ≈ 9–14 m
      const r = h * (0.26 + hash01(t.seed, 2) * 0.08);
      const rot = hash01(t.seed, 3) * Math.PI * 2;
      const y = g(t.x, t.z);
      trunks.push({ matrix: compose(t.x, y - 0.2, t.z, 0.14, h * 0.6 + 0.2, 0.14) });
      crowns.push({
        matrix: compose(t.x, y + h * 0.62, t.z, r, r * (1.05 + hash01(t.seed, 4) * 0.25), r, rot),
        color: AUTUMN[Math.floor(hash01(t.seed, 5) * AUTUMN.length)],
      });
    }

    // Tram tracks: a track bed with two rails.
    const tramBeds: THREE.Shape[] = [];
    const rails: THREE.Shape[] = [];
    for (const way of details.tramways) {
      for (const chain of clippedChains(p, way)) {
        const bed = buildRoadShape(chain, 0.9);
        if (bed) tramBeds.push(bed);
        for (const side of [-1, 1]) {
          const rail = buildRoadShape(offsetPolyline(chain, side * TRACK_HALF_GAUGE), 0.035);
          if (rail) rails.push(rail);
        }
      }
    }

    // Walls and retaining walls.
    const walls: Array<{ shape: THREE.Shape; height: number }> = [];
    for (const w of details.walls) {
      const tagged = parseFloat(w.tags?.height ?? "");
      const height = (!isNaN(tagged) && tagged > 0 ? tagged : w.tags?.barrier === "retaining_wall" ? 1.2 : 1.8) / METERS_PER_UNIT;
      for (const chain of clippedChains(p, w)) {
        const shape = buildRoadShape(chain, 0.18);
        if (shape) walls.push({ shape, height });
      }
    }

    // Benches and street lamps.
    const benches: Instance[] = [];
    for (const b of details.benches) {
      if (!inBbox(p, b.lat, b.lon)) continue;
      const [x, z] = toWorld(p, b.lat, b.lon);
      benches.push({ matrix: compose(x, g(x, z), z, 0.8, 0.22, 0.28, hash01(b.id, 6) * Math.PI) });
    }
    const posts: Instance[] = [];
    const heads: Instance[] = [];
    const pools: Instance[] = [];
    for (const l of details.lamps) {
      if (!inBbox(p, l.lat, l.lon)) continue;
      const [x, z] = toWorld(p, l.lat, l.lon);
      const y = g(x, z);
      posts.push({ matrix: compose(x, y - 0.2, z, 1, LAMP_HEIGHT + 0.2, 1) });
      heads.push({ matrix: compose(x, y + LAMP_HEIGHT + 0.08, z, 1, 1, 1) });
      pools.push({ matrix: compose(x, y + 0.2, z, 8, 1, 8) });
    }

    return { trunks, crowns, tramBeds, rails, walls, benches, posts, heads, pools };
  }, [projection, details, terrain]);

  // Extruded geometries for ribbons (tracks, walls) – rebuilt only when data changes.
  const ribbons = useMemo(() => {
    if (!data || !projection) return [];
    const extrude = (shape: THREE.Shape, depth: number) => {
      const flat = new THREE.ExtrudeGeometry(shape, { steps: 1, depth, bevelEnabled: false });
      if (!terrain) return flat;
      const fine = TESSELLATOR.modify(flat);
      flat.dispose();
      // mesh is rotated -90° around X: local (x, y, z) → world (x, z, -y)
      return drapeGeometry(fine, terrain, projection, (x, y) => [x, -y], "z");
    };
    return [
      ...data.tramBeds.map((s) => ({ geo: extrude(s, 0.02), mat: TRAM_BED_MAT, y: 0.1 })),
      ...data.rails.map((s) => ({ geo: extrude(s, 0.05), mat: RAIL_MAT, y: 0.12 })),
      ...data.walls.map((w) => ({ geo: extrude(w.shape, w.height), mat: WALL_MAT, y: 0 })),
    ];
  }, [data, terrain, projection]);
  useEffect(() => () => ribbons.forEach((r) => r.geo.dispose()), [ribbons]);

  if (!data) return null;
  return (
    <group>
      <Instances geometry={TRUNK_GEO} material={TRUNK_MAT} items={data.trunks} />
      <Instances geometry={CROWN_GEO} material={CROWN_MAT} items={data.crowns} />
      <Instances geometry={BENCH_GEO} material={BENCH_MAT} items={data.benches} />
      <Instances geometry={POST_GEO} material={LAMP_POST_MAT} items={data.posts} />
      <Instances geometry={HEAD_GEO} material={LAMP_HEAD_MAT} items={data.heads} />
      <Instances geometry={POOL_GEO} material={poolMat} items={data.pools} visible={ghostMode} />
      {ribbons.map((r, i) => (
        <mesh key={i} geometry={r.geo} material={r.mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, r.y, 0]} raycast={noRaycast} />
      ))}
    </group>
  );
}
