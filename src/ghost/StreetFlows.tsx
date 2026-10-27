// ── Moving ghost data in the streets ───────────────────────────────────────
//   FlowRibbons – energy pulses streaming along the street routes between
//                 sensors (all flows merged into one draw call)
//   WispMarker  – glowing wisps drifting along the streets with a fading tail
// Positions are derived from each entity's route, start time and speed, so the
// motion is smooth between the data source's 5-second updates.
import { useEffect, useMemo, useRef } from "react";
import { CardSheet } from "@/components/CardSheet";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useAreaStore } from "@/state/areaStore";
import { groundAtWorld } from "@/three/terrain";
import { keepEventsInCard } from "@/three/htmlEvents";
import { METERS_PER_UNIT } from "@/three/geo";
import { useGhostStore } from "./ghostStore.ts";
import { energyColor } from "./labels.ts";
import { getGlowTexture } from "./glow.ts";
import { nearestStreetName } from "./streetGraph.ts";
import { wispPosition } from "./localEnergy.ts";
import { Phantoms } from "./Phantoms.tsx";
import { useStreetGraph } from "./useStreetGraph.ts";
import type { GhostEntity } from "./types.ts";

const noRaycast = () => null;
const FLOW_HALF_WIDTH = 1.0;
const FLOW_LIFT = 0.35;

// ── flows ──────────────────────────────────────────────────────────────────

const flowMaterial = new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.DoubleSide, // ribbons are flat – draw them whichever way they face
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute float aDist;
    attribute float aSide;
    attribute float aIntensity;
    attribute vec3 color;
    varying float vDist; varying float vSide; varying float vI; varying vec3 vColor; varying float vCam;
    void main() {
      vDist = aDist; vSide = aSide; vI = aIntensity; vColor = color;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vCam = distance(world.xyz, cameraPosition);
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying float vDist; varying float vSide; varying float vI; varying vec3 vColor; varying float vCam;
    void main() {
      // pulses travel towards increasing distance, i.e. from the hot sensor to the cold one
      // slow, drifting pulses (≈ 1–2 m/s) with long soft tails
      float pulse = fract(vDist / 14.0 - uTime * (0.07 + vI * 0.1));
      float head = smoothstep(0.35, 0.95, pulse) * (1.0 - smoothstep(0.95, 1.0, pulse));
      float edge = 1.0 - smoothstep(0.2, 1.0, abs(vSide));
      float a = (0.22 + 1.6 * head) * edge * (0.45 + 0.55 * vI);
      // fade out right around the camera (walk mode) so the flow doesn't blind you
      a *= smoothstep(2.0, 18.0, vCam);
      gl_FragColor = vec4(vColor * (0.9 + head * 1.6), a);
    }`,
});

function FlowRibbons() {
  const flows = useGhostStore((s) => s.flows);
  const terrain = useAreaStore((s) => s.terrain);
  const projection = useAreaStore((s) => s.projection);

  const geometry = useMemo(() => {
    const pos: number[] = [], dist: number[] = [], side: number[] = [], inten: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    for (const f of flows) {
      energyColor(25 + f.intensity * 75, c);
      const pts = f.path.points;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / len) * FLOW_HALF_WIDTH, nz = ((bx - ax) / len) * FLOW_HALF_WIDTH;
        const ya = (projection ? groundAtWorld(terrain, projection, ax, az) : 0) + FLOW_LIFT;
        const yb = (projection ? groundAtWorld(terrain, projection, bx, bz) : 0) + FLOW_LIFT;
        const da = f.path.lengths[k], db = f.path.lengths[k + 1];
        const quad: Array<[number, number, number, number, number]> = [
          [ax + nx, ya, az + nz, da, 1], [ax - nx, ya, az - nz, da, -1], [bx - nx, yb, bz - nz, db, -1],
          [ax + nx, ya, az + nz, da, 1], [bx - nx, yb, bz - nz, db, -1], [bx + nx, yb, bz + nz, db, 1],
        ];
        for (const [x, y, z, d, sd] of quad) {
          pos.push(x, y, z); dist.push(d); side.push(sd); inten.push(f.intensity); col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute("aIntensity", new THREE.Float32BufferAttribute(inten, 1));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [flows, terrain, projection]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => { flowMaterial.uniforms.uTime.value = state.clock.elapsedTime; });
  return <mesh geometry={geometry} material={flowMaterial} frustumCulled={false} raycast={noRaycast} renderOrder={2} />;
}

// ── wisps ──────────────────────────────────────────────────────────────────

const TRAIL = 40;


function WispMarker({ entity }: { entity: GhostEntity }) {
  const terrain = useAreaStore((s) => s.terrain);
  const projection = useAreaStore((s) => s.projection);
  const selected = useGhostStore((s) => s.selectedEntityId === entity.id);
  const selectEntity = useGhostStore((s) => s.selectEntity);
  const group = useRef<THREE.Group>(null!);
  const color = useMemo(() => energyColor(30 + entity.intensity * 70), [entity.intensity]);
  const brightColor = useMemo(() => color.clone().lerp(new THREE.Color("#ffffff"), 0.55), [color]);
  const phase = useMemo(() => Math.random() * 10, []);

  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const colors = new Float32Array(TRAIL * 4);
    for (let i = 0; i < TRAIL; i++) {
      colors.set([color.r, color.g, color.b, (1 - i / TRAIL) ** 1.5 * 0.9], i * 4);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    return g;
  }, [color]);
  const trailMat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const trailLine = useMemo(() => {
    const l = new THREE.Line(trail, trailMat);
    l.frustumCulled = false;
    l.raycast = noRaycast;
    return l;
  }, [trail, trailMat]);
  const primed = useRef(false);
  useEffect(() => () => { trail.dispose(); trailMat.dispose(); }, [trail, trailMat]);

  useFrame((state) => {
    const p = wispPosition(entity);
    const ground = projection ? groundAtWorld(terrain, projection, p.x, p.z) : 0;
    const t = state.clock.elapsedTime + phase;
    const y = ground + 2 + Math.sin(t * 2.1) * 0.35;
    const x = p.x + Math.sin(t * 1.3) * 0.25;
    const z = p.z + Math.cos(t * 1.7) * 0.25;
    group.current.position.set(x, y, z);
    group.current.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
    // shift the tail
    const arr = trail.attributes.position.array as Float32Array;
    if (!primed.current) { for (let i = 0; i < TRAIL; i++) arr.set([x, y, z], i * 3); primed.current = true; }
    arr.copyWithin(3, 0, (TRAIL - 1) * 3);
    arr[0] = x; arr[1] = y; arr[2] = z;
    trail.attributes.position.needsUpdate = true;
  });

  return (
    <>
      <primitive object={trailLine} />
      <group ref={group}>
        <mesh
          onClick={(e) => { e.stopPropagation(); selectEntity(selected ? null : entity.id); }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[1.6, 10, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh raycast={noRaycast}>
          <sphereGeometry args={[0.45, 12, 12]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        {/* The glow shows through buildings, like a detector picking it up behind walls */}
        <sprite raycast={noRaycast} renderOrder={5} scale={[14 + entity.intensity * 10, 14 + entity.intensity * 10, 1]}>
          <spriteMaterial map={getGlowTexture()} color={color} blending={THREE.AdditiveBlending} transparent depthWrite={false} depthTest={false} opacity={0.9} toneMapped={false} />
        </sprite>
        <sprite raycast={noRaycast} renderOrder={6} scale={[4.5, 4.5, 1]}>
          <spriteMaterial map={getGlowTexture()} color={brightColor} blending={THREE.AdditiveBlending} transparent depthWrite={false} depthTest={false} toneMapped={false} />
        </sprite>
        {selected && (
          <Html position={[0, 1.2, 0]} zIndexRange={[115, 0]} style={{ transform: "translate(18px, -50%)" }}>
            <CardSheet><WispCard entity={entity} /></CardSheet>
          </Html>
        )}
      </group>
    </>
  );
}

function WispCard({ entity }: { entity: GhostEntity }) {
  const sensors = useGhostStore((s) => s.sensors);
  const selectEntity = useGhostStore((s) => s.selectEntity);
  const streets = useStreetGraph();
  const p = wispPosition(entity);
  const street = (streets && nearestStreetName(streets, p.x, p.z, 10)) ?? "gångväg";
  const target = sensors.find((s) => s.sensor_id === entity.target_sensor)?.name;
  const from = sensors.find((s) => s.sensor_id === entity.from_sensor)?.name;
  const row = (k: string, v: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ color: "#9ca3c7" }}>{k}</span>
      <span style={{ color: "#f1f2ff" }}>{v}</span>
    </div>
  );
  return (
    <div
      ref={keepEventsInCard}
      style={{
        width: 220, padding: "10px 12px", borderRadius: 10, background: "rgba(9,9,26,0.92)",
        border: "1px solid rgba(168,85,247,0.55)", color: "#e5e7ff", fontSize: 12, backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <b style={{ fontSize: 14 }}>✦ {entity.name}</b>
        <button onClick={() => selectEntity(null)} aria-label="Stäng" style={{ background: "none", border: "none", color: "#9ca3c7", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>
      {row("Befinner sig vid", street)}
      {row("Hastighet", `${(entity.speed * METERS_PER_UNIT).toFixed(1)} m/s`)}
      {row("Intensitet", `${Math.round(entity.intensity * 100)} %`)}
      {from && row("Kom från", from)}
      {row("På väg mot", target ?? "vandrar planlöst")}
      <div style={{ marginTop: 6, fontSize: 10, color: "#fb923c" }}>⚠ SIMULERADE, FIKTIVA DATA</div>
    </div>
  );
}

// ── root ───────────────────────────────────────────────────────────────────

export function StreetFlows() {
  const entities = useGhostStore((s) => s.entities);
  const layers = useGhostStore((s) => s.layers);
  return (
    <>
      {layers.flows && <FlowRibbons />}
      {layers.phantoms && <Phantoms />}
      {layers.wisps && entities.map((e) => <WispMarker key={e.id} entity={e} />)}
    </>
  );
}
