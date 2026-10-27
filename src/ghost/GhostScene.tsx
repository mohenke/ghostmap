// ── GHOST PULSE – 3D layer rendered inside Mapforge's <Canvas> ────────────
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Stars } from "@react-three/drei";
import * as THREE from "three";
import { useGhostStore } from "./ghostStore.ts";
import { EVENT_ICON, EVENT_LABEL, RISK_COLOR, RISK_LABEL, activityLabel, energyColor, energyColorCss, formatTime } from "./labels.ts";
import type { SensorDefinition } from "./types.ts";
import { BlenderCity } from "./BlenderCity.tsx";
import { StreetFlows } from "./StreetFlows.tsx";
import { SoundSensors } from "./SoundSensor.tsx";
import { keepEventsInCard } from "@/three/htmlEvents";

const NIGHT_SKY = new THREE.Color("#04040b");
const FOG_COLOR = new THREE.Color("#0b0a1f");
const noRaycast = () => null;

export { getGlowTexture } from "./glow.ts";
import { getGlowTexture } from "./glow.ts";
import { useWalkStore } from "@/walk/walkStore";

// ── Atmosphere: night sky and moonlight (fog is handled by weather/WeatherEffects) ──

function Atmosphere() {
  const { scene } = useThree();

  useEffect(() => {
    const prevBg = scene.background;
    scene.background = NIGHT_SKY;
    return () => { scene.background = prevBg; };
  }, [scene]);


  return (
    <>
      <ambientLight intensity={0.55} color="#6b78d6" />
      <hemisphereLight args={["#5b3fb0", "#05060d", 0.8]} />
      <directionalLight position={[-120, 220, -90]} intensity={1.3} color="#a9bbff" />
      <Stars radius={900} depth={200} count={2500} factor={8} saturation={0.4} fade speed={0.5} />
    </>
  );
}

// ── Glowing building outlines (one merged draw call) ───────────────────────

export type GhostBuilding = { geometry: THREE.BufferGeometry };

function BuildingEdges({ buildings }: { buildings: GhostBuilding[] }) {
  const geometry = useMemo(() => {
    const chunks: Float32Array[] = [];
    let total = 0;
    for (const b of buildings) {
      // Building geometry is already in world coordinates.
      const edges = new THREE.EdgesGeometry(b.geometry, 25);
      const out = edges.attributes.position.array as Float32Array;
      chunks.push(out.slice());
      total += out.length;
      edges.dispose();
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(merged, 3));
    return g;
  }, [buildings]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} raycast={noRaycast}>
      <lineBasicMaterial color="#7f8cff" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
  );
}

// ── Sensor marker ──────────────────────────────────────────────────────────

function SensorMarker({ def, index }: { def: SensorDefinition; index: number }) {
  const reading = useGhostStore((s) => s.readings[def.sensor_id]);
  const isSelected = useGhostStore((s) => s.selectedId === def.sensor_id);
  const layers = useGhostStore((s) => s.layers);
  const select = useGhostStore((s) => s.select);

  const [x, y, z] = def.position!;
  const energy = useRef(reading?.ghost_energy ?? def.baseline);
  const flash = useRef(0);
  const lastEvent = useRef<string | null>(null);
  const color = useMemo(() => new THREE.Color(), []);

  const core = useRef<THREE.Mesh>(null!);
  const halo = useRef<THREE.Sprite>(null!);
  const field = useRef<THREE.Mesh>(null!);
  const shell = useRef<THREE.Mesh>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const ring2 = useRef<THREE.Mesh>(null!);
  const beam = useRef<THREE.Mesh>(null!);
  const light = useRef<THREE.PointLight>(null!);

  // A new event at this sensor triggers a short flash.
  useEffect(() => {
    const ev = reading?.active_event ?? null;
    if (ev && ev !== lastEvent.current) flash.current = 1;
    lastEvent.current = ev;
  }, [reading?.active_event]);

  useFrame((state, dt) => {
    if (!core.current) return; // layer hidden – nothing mounted to animate
    const target = reading?.ghost_energy ?? def.baseline;
    // Animate smoothly towards the newest reading.
    energy.current += (target - energy.current) * Math.min(1, dt * 1.4);
    flash.current = Math.max(0, flash.current - dt * 0.7);
    const e = energy.current / 100;
    const t = state.clock.elapsedTime + index * 1.7;
    energyColor(energy.current, color);
    const pulse = 0.5 + 0.5 * Math.sin(t * (1.6 + e * 5));
    const f = flash.current;

    const coreScale = (0.7 + e * 1.3) * (1 + 0.18 * pulse) * (1 + f * 0.8) * (isSelected ? 1.2 : 1);
    core.current.scale.setScalar(coreScale);
    (core.current.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(1.4);

    halo.current.scale.setScalar((7 + e * 12) * (0.85 + 0.3 * pulse) * (1 + f));
    const haloMat = halo.current.material as THREE.SpriteMaterial;
    haloMat.color.copy(color);
    haloMat.opacity = 0.45 + 0.45 * e;

    // Energy field: only visible when energy is high.
    const fieldStrength = THREE.MathUtils.smoothstep(energy.current, 40, 95);
    const radius = 5 + e * 16;
    // Standing inside the field at street level: soften it so it doesn't wash out the view.
    const camDist = state.camera.position.distanceTo(new THREE.Vector3(x, y, z));
    const inside = THREE.MathUtils.smoothstep(camDist, radius * 0.6, radius * 1.3); // 0 deep inside → 1 outside
    const soften = 0.18 + 0.82 * inside;
    field.current.visible = layers.fields && fieldStrength > 0.01;
    shell.current.visible = field.current.visible;
    field.current.scale.setScalar(radius * (1 + 0.04 * pulse));
    shell.current.scale.setScalar(radius * 1.02);
    shell.current.rotation.y += dt * (0.15 + e * 0.6);
    shell.current.rotation.x += dt * 0.05;
    const fieldMat = field.current.material as THREE.MeshBasicMaterial;
    fieldMat.color.copy(color);
    fieldMat.opacity = fieldStrength * (0.12 + 0.06 * pulse + f * 0.1) * soften;
    const shellMat = shell.current.material as THREE.MeshBasicMaterial;
    shellMat.color.copy(color);
    shellMat.opacity = fieldStrength * 0.28 * (0.4 + 0.6 * inside);

    // Radar ping rings on the ground.
    const speed = 0.35 + e * 0.6;
    [ring.current, ring2.current].forEach((r, i) => {
      const phase = (t * speed + i * 0.5) % 1;
      r.scale.setScalar(2 + phase * (8 + e * 22));
      const m = r.material as THREE.MeshBasicMaterial;
      m.color.copy(color);
      m.opacity = (1 - phase) * (0.35 + 0.4 * e) * soften;
    });

    beam.current.visible = layers.beams;
    const beamMat = beam.current.material as THREE.MeshBasicMaterial;
    beamMat.color.copy(color);
    beamMat.opacity = 0.08 + 0.3 * e + f * 0.3;

    light.current.color.copy(color);
    // The light pool under a sensor looks good from above but blinds you at street level.
    light.current.intensity = (60 + e * 420 + f * 500) * (0.1 + 0.9 * inside);
  });

  if (!layers.sensors) return null;

  const onClick = (ev: any) => {
    ev.stopPropagation();
    select(isSelected ? null : def.sensor_id);
  };
  const ground = def.ground ?? 0;
  const beamHeight = y + 40 - ground;
  const risk = reading?.risk_level ?? "low";

  return (
    <group position={[x, 0, z]}>
      {/* Clickable hit area, larger than the visible core */}
      <mesh
        position={[0, y, 0]}
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        <sphereGeometry args={[3.2, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={core} position={[0, y, 0]} raycast={noRaycast}>
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <sprite ref={halo} position={[0, y, 0]} raycast={noRaycast}>
        <spriteMaterial map={getGlowTexture()} blending={THREE.AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
      </sprite>
      <pointLight ref={light} position={[0, y + 1, 0]} distance={70} decay={2} />

      <mesh ref={field} position={[0, y, 0]} raycast={noRaycast}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={shell} position={[0, y, 0]} raycast={noRaycast}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial wireframe transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      <mesh ref={beam} position={[0, ground + beamHeight / 2, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.25, 0.6, beamHeight, 12, 1, true]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      {[ring, ring2].map((r, i) => (
        <mesh key={i} ref={r} position={[0, ground + 0.3 + i * 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}

      {layers.labels && !isSelected && (
        <Html position={[0, y + 6, 0]} center zIndexRange={[100, 0]}>
          <div
            ref={keepEventsInCard}
            onClick={onClick}
            style={{
              ...labelStyle,
              borderColor: RISK_COLOR[risk] + "99",
            }}
          >
            <span style={{ color: "#c4b5fd" }}>{def.sensor_id}</span>
            <span style={{ fontWeight: 700 }}>{reading ? Math.round(reading.ghost_energy) : "–"}</span>
            {reading?.active_event && <span title={EVENT_LABEL[reading.active_event]}>{EVENT_ICON[reading.active_event]}</span>}
          </div>
        </Html>
      )}

      {isSelected && (
        <Html position={[0, y + 4, 0]} zIndexRange={[110, 0]} style={{ transform: "translate(24px, -50%)" }}>
          <SensorCard def={def} />
        </Html>
      )}
    </group>
  );
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const labelStyle: React.CSSProperties = {
  display: "flex",
  gap: "6px",
  alignItems: "center",
  padding: "3px 8px",
  borderRadius: "999px",
  border: "1px solid",
  background: "rgba(8, 8, 22, 0.78)",
  color: "#e5e7ff",
  fontFamily: mono,
  fontSize: "11px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  backdropFilter: "blur(4px)",
};

function SensorCard({ def }: { def: SensorDefinition }) {
  const reading = useGhostStore((s) => s.readings[def.sensor_id]);
  const lastEvent = useGhostStore((s) => s.events.find((e) => e.sensor_id === def.sensor_id));
  const select = useGhostStore((s) => s.select);
  if (!reading) return null;
  const risk = reading.risk_level;

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "3px 0" }}>
      <span style={{ color: "#9ca3c7" }}>{label}</span>
      <span style={{ color: "#f1f2ff", textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <div
      ref={keepEventsInCard}
      style={{
        width: "250px",
        padding: "12px 14px",
        borderRadius: "10px",
        background: "rgba(9, 9, 26, 0.92)",
        border: `1px solid ${RISK_COLOR[risk]}88`,
        boxShadow: `0 0 24px ${RISK_COLOR[risk]}40`,
        color: "#e5e7ff",
        fontSize: "12px",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: "11px", color: "#c4b5fd", letterSpacing: "0.08em" }}>{def.sensor_id}</div>
          <div style={{ fontSize: "15px", fontWeight: 700 }}>{def.name}</div>
          <div style={{ color: "#9ca3c7", fontSize: "11px" }}>{def.location}</div>
        </div>
        <button
          onClick={() => select(null)}
          style={{ background: "none", border: "none", color: "#9ca3c7", cursor: "pointer", fontSize: "16px", lineHeight: 1 }}
          aria-label="Stäng"
        >
          ×
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "6px", margin: "10px 0 6px" }}>
        <span style={{ fontFamily: mono, fontSize: "30px", fontWeight: 700 }}>{reading.ghost_energy.toFixed(1)}</span>
        <span style={{ color: "#9ca3c7" }}>/ 100 spökenergi</span>
      </div>
      <div style={{ height: "4px", borderRadius: "4px", background: "#1f2140", marginBottom: "8px" }}>
        <div style={{ width: `${reading.ghost_energy}%`, height: "100%", borderRadius: "4px", background: energyColorCss(reading.ghost_energy), transition: "width 1s ease" }} />
      </div>
      {row("Risknivå", <span style={{ color: RISK_COLOR[risk], fontWeight: 600 }}>● {RISK_LABEL[risk]}</span>)}
      {row("Temperaturfall", <span style={{ fontFamily: mono }}>−{reading.temperature_drop.toFixed(1)} °C</span>)}
      {row("Spektral aktivitet", activityLabel(reading.spectral_activity))}
      {def.history_boost ? row("Historisk laddning", <span title={def.history_nearby?.join(", ")}>+{def.history_boost} · {def.history_nearby?.length} platser</span>) : null}
      {row("Senaste händelse", lastEvent ? `${EVENT_ICON[lastEvent.type]} ${EVENT_LABEL[lastEvent.type]}` : "Ingen registrerad")}
      {lastEvent && row("Händelsetid", <span style={{ fontFamily: mono }}>{formatTime(lastEvent.timestamp)}</span>)}
      {row("Mätning", <span style={{ fontFamily: mono }}>{formatTime(reading.timestamp)}</span>)}
      <div style={{ marginTop: "8px", fontSize: "10px", color: "#fb923c", letterSpacing: "0.04em" }}>
        ⚠ SIMULERADE, FIKTIVA DATA
      </div>
    </div>
  );
}

// ── Camera: fly to the selected sensor ─────────────────────────────────────

function CameraFocus() {
  const selectedId = useGhostStore((s) => s.selectedId);
  const sensors = useGhostStore((s) => s.sensors);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;
  const anim = useRef<{ fromT: THREE.Vector3; toT: THREE.Vector3; fromC: THREE.Vector3; toC: THREE.Vector3; p: number } | null>(null);

  useEffect(() => {
    const s = sensors.find((x) => x.sensor_id === selectedId);
    // Only fly the camera in the overview – not while walking the streets.
    if (!s || !controls || useWalkStore.getState().mode !== "orbit") return;
    const toT = new THREE.Vector3(...s.position!);
    const dir = camera.position.clone().sub(controls.target);
    const dist = THREE.MathUtils.clamp(dir.length(), 70, 120);
    dir.normalize();
    if (dir.y < 0.45) { dir.y = 0.45; dir.normalize(); }
    anim.current = {
      fromT: controls.target.clone(),
      toT,
      fromC: camera.position.clone(),
      toC: toT.clone().add(dir.multiplyScalar(dist)),
      p: 0,
    };
  }, [selectedId, sensors, controls, camera]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.p = Math.min(1, a.p + dt / 1.2);
    const k = 1 - Math.pow(1 - a.p, 3); // ease-out
    controls.target.lerpVectors(a.fromT, a.toT, k);
    camera.position.lerpVectors(a.fromC, a.toC, k);
    controls.update();
    if (a.p >= 1) anim.current = null;
  });

  return null;
}

// ── Root ───────────────────────────────────────────────────────────────────

export function GhostScene({ buildings }: { buildings: GhostBuilding[] }) {
  const sensors = useGhostStore((s) => s.sensors);
  const modelUrl = useGhostStore((s) => s.modelUrl);
  const showModel = useGhostStore((s) => s.layers.model);
  return (
    <>
      <Atmosphere />
      {modelUrl && showModel && <BlenderCity url={modelUrl} />}
      <BuildingEdges buildings={buildings} />
      <StreetFlows />
      <SoundSensors />
      {sensors.map((s, i) => (
        <SensorMarker key={s.sensor_id} def={s} index={i} />
      ))}
      <CameraFocus />
    </>
  );
}
