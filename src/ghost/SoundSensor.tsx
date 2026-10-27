// ── Acoustic sensor (werewolf detector) in the 3D scene ────────────────────
// A microphone mast with a ring of spectrum bars and sound waves that ripple
// outwards. Howls turn it amber/red, log an event and – with sound on – play a
// synthesized howl whose volume depends on how close the camera is.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { keepEventsInCard } from "@/three/htmlEvents";
import { moonIllumination } from "@/opendata/moon";
import { useWeatherStore } from "@/weather/weatherStore";
import { useGhostStore } from "./ghostStore.ts";
import { formatTime } from "./labels.ts";
import { playHowl, unlockAudio } from "./howlAudio.ts";
import type { SensorDefinition } from "./types.ts";

const noRaycast = () => null;
const BARS = 20;
const QUIET = new THREE.Color("#22d3ee");
const HOWL = new THREE.Color("#fb923c");
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function levelStatus(db: number, howl: boolean) {
  if (howl) return "VARULVSYLANDE";
  if (db >= 60) return "Högt";
  if (db >= 45) return "Måttligt";
  return "Tyst";
}

function SoundSensorMarker({ def }: { def: SensorDefinition }) {
  const reading = useGhostStore((s) => s.acoustic[def.sensor_id]);
  const selected = useGhostStore((s) => s.selectedAcousticId === def.sensor_id);
  const select = useGhostStore((s) => s.selectAcoustic);
  const showLabels = useGhostStore((s) => s.layers.labels);
  const { camera } = useThree();
  const [x, y, z] = def.position!;
  const ground = def.ground ?? 0;
  const mast = y - ground;

  const bars = useRef<THREE.InstancedMesh>(null!);
  const waves = useRef<THREE.Mesh[]>([]);
  const head = useRef<THREE.Mesh>(null!);
  const level = useRef(35);
  const lastHowl = useRef(false);
  const color = useMemo(() => new THREE.Color(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);

  // With sound on, play a howl when one starts; louder the closer the camera is.
  useEffect(() => {
    const howl = !!reading?.howl;
    if (howl && !lastHowl.current && useGhostStore.getState().sound) {
      const d = camera.position.distanceTo(new THREE.Vector3(x, y, z));
      playHowl(THREE.MathUtils.clamp(1.1 - d / 450, 0.12, 1), reading!.howl_intensity || 0.8);
    }
    lastHowl.current = howl;
  }, [reading?.howl, reading?.timestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, dt) => {
    if (!bars.current) return;
    const target = reading?.level_db ?? 35;
    level.current += (target - level.current) * Math.min(1, dt * 3);
    const howl = !!reading?.howl;
    const e = THREE.MathUtils.clamp((level.current - 30) / 55, 0, 1);
    const t = state.clock.elapsedTime;
    color.copy(QUIET).lerp(HOWL, howl ? 1 : e * 0.4);

    // spectrum ring: bar heights follow the level, with a peak band while howling
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2;
      const band = howl ? Math.exp(-(((i - 7) / 3) ** 2)) * 2.2 : 0;
      const h = 0.15 + e * 1.4 * (0.5 + 0.5 * Math.abs(Math.sin(t * (3 + i * 0.7) + i))) + band * (0.7 + 0.3 * Math.sin(t * 12 + i));
      m4.compose(
        new THREE.Vector3(Math.cos(a) * 1.4, h / 2 - mast + 0.05, Math.sin(a) * 1.4),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
        new THREE.Vector3(1, h, 1)
      );
      bars.current.setMatrixAt(i, m4);
    }
    bars.current.instanceMatrix.needsUpdate = true;
    (bars.current.material as THREE.MeshBasicMaterial).color.copy(color);

    // sound waves rippling outwards – faster and bigger when loud
    waves.current.forEach((w, i) => {
      if (!w) return;
      const phase = (t * (0.35 + e * 0.9) + i / 3) % 1;
      w.scale.setScalar(0.6 + phase * (howl ? 28 : 6 + e * 10));
      const m = w.material as THREE.MeshBasicMaterial;
      m.color.copy(color);
      m.opacity = (1 - phase) * (howl ? 0.55 : 0.12 + e * 0.25);
    });
    (head.current.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(1.3);
    head.current.scale.setScalar(howl ? 1 + 0.15 * Math.sin(t * 18) : 1);
  });

  const onClick = (ev: any) => { ev.stopPropagation(); select(selected ? null : def.sensor_id); };
  const howl = !!reading?.howl;
  return (
    <group position={[x, y, z]}>
      {/* mast + microphone */}
      <mesh position={[0, -mast / 2, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.06, 0.09, mast, 6]} />
        <meshStandardMaterial color="#1b1d2e" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh ref={head} onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}>
        <capsuleGeometry args={[0.28, 0.5, 6, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <instancedMesh ref={bars} args={[undefined, undefined, BARS]} raycast={noRaycast} frustumCulled={false}>
        <boxGeometry args={[0.16, 1, 0.16]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { if (el) waves.current[i] = el; }} raycast={noRaycast}>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial wireframe transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
      {showLabels && !selected && (
        <Html position={[0, 2.2, 0]} center zIndexRange={[100, 0]}>
          <div ref={keepEventsInCard} onClick={onClick} style={{
            display: "flex", gap: 6, alignItems: "center", padding: "3px 8px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${howl ? "#fb923c" : "rgba(34,211,238,0.6)"}`, background: howl ? "rgba(60,20,4,0.85)" : "rgba(8,8,22,0.78)",
            color: "#e5e7ff", fontFamily: mono, fontSize: 11, whiteSpace: "nowrap",
            boxShadow: howl ? "0 0 14px rgba(251,146,60,0.7)" : "none",
          }}>
            <span style={{ color: howl ? "#fdba74" : "#67e8f9" }}>{def.sensor_id}</span>
            <b>{reading ? Math.round(reading.level_db) : "–"} dB</b>
            {howl && <span>🐺 AUUU!</span>}
          </div>
        </Html>
      )}
      {selected && (
        <Html position={[0, 2, 0]} zIndexRange={[1600, 1500]} style={{ transform: "translate(22px, -40%)" }}>
          <SoundCard def={def} />
        </Html>
      )}
    </group>
  );
}

/** Mini waveform of recent levels (dB). */
export function LevelWave({ values, width = 220, height = 42, color = "#22d3ee" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const step = width / (values.length - 1);
  const y = (v: number) => height - 2 - ((Math.min(95, Math.max(25, v)) - 25) / 70) * (height - 4);
  const line = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Ljudnivå senaste mätningarna, nu ${Math.round(values[values.length - 1])} dB`}>
      <line x1="0" x2={width} y1={y(60)} y2={y(60)} stroke="rgba(251,146,60,0.35)" strokeDasharray="3 3" />
      <polyline points={`0,${height} ${line} ${width},${height}`} fill={`${color}22`} stroke="none" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SoundCard({ def }: { def: SensorDefinition }) {
  const reading = useGhostStore((s) => s.acoustic[def.sensor_id]);
  const history = useGhostStore((s) => s.acousticHistory[def.sensor_id] ?? []);
  const howls = useGhostStore((s) => s.howlCount);
  const lastHowl = useGhostStore((s) => s.lastHowl);
  const select = useGhostStore((s) => s.selectAcoustic);
  const wind = useWeatherStore((s) => s.weather.windSpeed);
  const moon = moonIllumination(new Date());
  if (!reading) return null;
  const howl = reading.howl;
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ color: "#9ca3c7" }}>{k}</span>
      <span style={{ color: "#f1f2ff", textAlign: "right" }}>{v}</span>
    </div>
  );
  return (
    <div ref={keepEventsInCard} style={{
      width: 270, padding: "12px 14px", borderRadius: 12, background: "rgba(9,9,26,0.94)",
      border: `1px solid ${howl ? "#fb923c" : "rgba(34,211,238,0.5)"}`, color: "#e5e7ff", fontSize: 12, backdropFilter: "blur(6px)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 11, color: "#67e8f9", letterSpacing: "0.08em" }}>{def.sensor_id} · LJUDSENSOR</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{def.name}</div>
          <div style={{ color: "#9ca3c7", fontSize: 11 }}>{def.location}</div>
        </div>
        <button onClick={() => select(null)} aria-label="Stäng" style={{ background: "none", border: "none", color: "#9ca3c7", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "8px 0 2px" }}>
        <span style={{ fontFamily: mono, fontSize: 28, fontWeight: 700 }}>{reading.level_db.toFixed(0)}</span>
        <span style={{ color: "#9ca3c7" }}>dB(A)</span>
        <span style={{ marginLeft: "auto", fontWeight: 700, color: howl ? "#fb923c" : "#67e8f9" }}>{howl ? "🐺 " : ""}{levelStatus(reading.level_db, howl)}</span>
      </div>
      <LevelWave values={history} width={242} color={howl ? "#fb923c" : "#22d3ee"} />
      {howl && reading.peak_hz && row("Toppfrekvens", `${reading.peak_hz} Hz`)}
      {row("Ylanden registrerade", `${howls}`)}
      {row("Senaste ylande", lastHowl ? formatTime(lastHowl) : "inget ännu")}
      {row("Ylrisk från månen", `${Math.round(moon * 100)} % belyst → ${moon > 0.8 ? "hög" : moon > 0.4 ? "måttlig" : "låg"}`)}
      {row("Vindbrus (SMHI)", `+${(wind * 1.3).toFixed(0)} dB vid ${wind.toFixed(0)} m/s`)}
      <button
        onClick={() => { unlockAudio(); playHowl(0.8, 0.9); }}
        style={{ marginTop: 8, width: "100%", padding: "6px 0", borderRadius: 8, cursor: "pointer", fontSize: 12, border: "1px solid #fb923c", background: "rgba(251,146,60,0.15)", color: "#ffedd5" }}
      >
        ▶ Lyssna på ett ylande
      </button>
      <div style={{ marginTop: 6, fontSize: 10, color: "#fb923c" }}>⚠ SIMULERADE, FIKTIVA DATA · månfas och vind är verkliga</div>
    </div>
  );
}

export function SoundSensors() {
  const sensors = useGhostStore((s) => s.acousticSensors);
  const show = useGhostStore((s) => s.layers.sensors);
  if (!show) return null;
  return <>{sensors.map((s) => <SoundSensorMarker key={s.sensor_id} def={s} />)}</>;
}
