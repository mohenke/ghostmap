// ── Real open data in the 3D scene ─────────────────────────────────────────
//   AirSensors  – real Sensor.community stations as pillars, coloured by PM2.5
//   History     – Wikipedia places as amber markers with a card on click
//   Ectoplasm   – (Ghost Mode) green mist over the streets; thickness = real PM2.5
//   Moon        – real moon position and phase
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useAreaStore, type Projection } from "@/state/areaStore";
import { useGhostStore } from "@/ghost/ghostStore";
import { groundAt, groundAtWorld, drapeGeometry, type TerrainGrid } from "@/three/terrain";
import { keepEventsInCard } from "@/three/htmlEvents";
import { getGlowTexture } from "@/ghost/glow";
import { useWalkStore } from "@/walk/walkStore";
import { WEATHER_POINT } from "@/weather/weatherStore";
import { distanceM, interpolatePm25, pmLabel, type AirStation } from "./airSensors.ts";
import { moonIllumination, moonPhaseName, moonPosition, moonWaxing } from "./moon.ts";
import { useOpenData } from "./openDataStore.ts";
import type { HistoryPlace } from "./wikipedia.ts";
import { sunDirection } from "@/weather/sun";

const noRaycast = () => null;
const REAL = "#2dd4bf"; // teal = real data (fictional ghost data uses violet/orange)

const world = (p: Projection, lat: number, lon: number): [number, number] => [(lon - p.refLng) * p.scaleX, -(lat - p.refLat) * p.scaleY];

/** Small badge that tells real and fictional data apart. */
export function RealBadge({ source }: { source: string }) {
  return (
    <div style={{ marginTop: 8, fontSize: 10, color: REAL, letterSpacing: "0.04em" }}>
      ● VERKLIG DATA · {source}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  width: 280, padding: "12px 14px", borderRadius: 12, background: "rgba(6, 14, 18, 0.94)",
  border: `1px solid ${REAL}66`, boxShadow: "0 8px 30px rgba(0,0,0,0.45)", color: "#e6fffb",
  fontSize: 12, fontFamily: "system-ui, -apple-system, sans-serif", backdropFilter: "blur(8px)", userSelect: "text",
};
const closeBtn: React.CSSProperties = {
  border: "none", background: "rgba(255,255,255,0.08)", color: "#e6fffb", borderRadius: 6,
  width: 22, height: 22, cursor: "pointer", fontSize: 15, lineHeight: "20px", flexShrink: 0,
};

function pmColor(pm: number | undefined) {
  if (pm === undefined) return new THREE.Color("#94a3b8");
  if (pm < 5) return new THREE.Color("#2dd4bf");
  if (pm < 10) return new THREE.Color("#a3e635");
  if (pm < 20) return new THREE.Color("#facc15");
  if (pm < 25) return new THREE.Color("#fb923c");
  return new THREE.Color("#f43f5e");
}

// ── air sensors ────────────────────────────────────────────────────────────

function AirStationMarker({ s, p, terrain }: { s: AirStation; p: Projection; terrain: TerrainGrid | null }) {
  const selected = useOpenData((st) => st.selectedAir === s.id);
  const select = useOpenData((st) => st.selectAir);
  // Stations outside the modelled area are shown at its edge, in their real direction,
  // with the distance printed – visible without pretending they stand in Haga.
  const [rx, rz] = world(p, s.lat, s.lon);
  const halfW = ((p.bbox.maxLng - p.bbox.minLng) * p.scaleX) / 2;
  const halfD = ((p.bbox.maxLat - p.bbox.minLat) * p.scaleY) / 2;
  const k = Math.min(1, halfW / Math.max(1e-6, Math.abs(rx)), halfD / Math.max(1e-6, Math.abs(rz)));
  const atEdge = k < 1;
  const [x, z] = [rx * k, rz * k];
  const ground = atEdge ? groundAtWorld(terrain, p, x, z) : groundAt(terrain, s.lat, s.lon);
  const color = useMemo(() => pmColor(s.pm25), [s.pm25]);
  const height = (atEdge ? 6 : 10) + Math.min(20, (s.pm25 ?? 2) * 1.5);
  const compass = ["N", "NO", "O", "SO", "S", "SV", "V", "NV"][Math.round(((Math.atan2(rx, -rz) * 180) / Math.PI + 360) % 360 / 45) % 8];
  const ring = useRef<THREE.Mesh>(null!);
  const dist = Math.round(distanceM(WEATHER_POINT.lat, WEATHER_POINT.lon, s.lat, s.lon));

  useFrame((state) => {
    const t = (state.clock.elapsedTime * 0.4 + s.lat * 100) % 1;
    ring.current.scale.setScalar(1 + t * 6);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.6;
  });

  const onClick = (e: any) => { e.stopPropagation(); select(selected ? null : s.id); };
  return (
    <group position={[x, ground, z]}>
      <mesh position={[0, height / 2, 0]} onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}>
        <cylinderGeometry args={[0.35, 0.35, height, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh position={[0, height + 0.8, 0]} raycast={noRaycast}>
        <octahedronGeometry args={[0.9, 0]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.9, 1.05, 40]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <Html position={[0, height + 3, 0]} center zIndexRange={[100, 0]}>
        <div ref={keepEventsInCard} onClick={onClick} style={{
          display: "flex", gap: 5, alignItems: "center", padding: "2px 7px", borderRadius: 999, cursor: "pointer",
          background: "rgba(6, 14, 18, 0.8)", border: `1px solid ${REAL}88`, color: "#e6fffb", fontSize: 10.5,
          fontFamily: "ui-monospace, Menlo, monospace", whiteSpace: "nowrap",
        }}>
          <span style={{ color: REAL }}>LUFT</span>
          {s.pm25 !== undefined ? <b>{s.pm25.toFixed(1)}</b> : <b>{s.temperature?.toFixed(1)}°</b>}
          {atEdge && <span style={{ color: "#8fb8b2" }}>· {dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(1)} km`} {compass}</span>}
        </div>
      </Html>
      {selected && (
        <Html position={[0, height + 4, 0]} zIndexRange={[1600, 1500]} style={{ transform: "translate(18px, -50%)" }}>
          <div ref={keepEventsInCard} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Luftsensor #{s.id}</div>
                <div style={{ color: "#8fb8b2", fontSize: 11 }}>{dist} m {compass} om Haga Nygata{atEdge ? " – utanför modellen, visas i kanten" : ""} · {s.sensorTypes.join(", ")}</div>
              </div>
              <button style={closeBtn} aria-label="Stäng" onClick={() => select(null)}>×</button>
            </div>
            <div style={{ height: 1, background: `${REAL}44`, margin: "8px 0" }} />
            {s.pm25 !== undefined && <Row k="PM2.5 (fina partiklar)" v={`${s.pm25.toFixed(1)} µg/m³ · ${pmLabel(s.pm25)}`} />}
            {s.pm10 !== undefined && <Row k="PM10" v={`${s.pm10.toFixed(1)} µg/m³`} />}
            {s.temperature !== undefined && <Row k="Temperatur" v={`${s.temperature.toFixed(1)} °C`} />}
            {s.humidity !== undefined && <Row k="Luftfuktighet" v={`${s.humidity.toFixed(0)} %`} />}
            <Row k="Senaste mätning" v={new Date(s.timestamp).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" })} />
            <div style={{ marginTop: 6, color: "#8fb8b2", lineHeight: 1.4 }}>
              Hemmabyggd sensor i medborgarforskningsnätet Sensor.community. I Ghost Mode styr partikelhalten tjockleken på ektoplasmadimman.
            </div>
            <RealBadge source="Sensor.community (ODbL)" />
          </div>
        </Html>
      )}
    </group>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ color: "#8fb8b2" }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

// ── history (Wikipedia) ────────────────────────────────────────────────────

const HISTORY_COLOR = new THREE.Color("#fbbf24");

function HistoryMarker({ place, p, terrain }: { place: HistoryPlace; p: Projection; terrain: TerrainGrid | null }) {
  const selected = useOpenData((st) => st.selectedPlace === place.pageid);
  const select = useOpenData((st) => st.selectPlace);
  const walking = useWalkStore((st) => st.mode !== "orbit");
  const [x, z] = world(p, place.lat, place.lon);
  const ground = groundAt(terrain, place.lat, place.lon);
  const gem = useRef<THREE.Mesh>(null!);
  const top = walking ? 4 : 13; // above the rooftops in the overview, eye level in walk mode
  useFrame((state) => {
    gem.current.rotation.y = state.clock.elapsedTime * 0.8 + place.pageid;
    gem.current.position.y = top + Math.sin(state.clock.elapsedTime * 1.5 + place.pageid) * 0.25;
  });
  const onClick = (e: any) => { e.stopPropagation(); select(selected ? null : place.pageid); };
  return (
    <group position={[x, ground, z]}>
      <mesh position={[0, top / 2, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.04, 0.04, top, 4]} />
        <meshBasicMaterial color={HISTORY_COLOR} transparent opacity={0.45} />
      </mesh>
      <mesh ref={gem} onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}>
        <octahedronGeometry args={[0.8, 0]} />
        <meshBasicMaterial color={HISTORY_COLOR} toneMapped={false} />
      </mesh>
      <sprite position={[0, top, 0]} scale={[4, 4, 1]} raycast={noRaycast}>
        <spriteMaterial map={getGlowTexture()} color={HISTORY_COLOR} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      {selected && (
        <Html position={[0, top + 1, 0]} zIndexRange={[1600, 1500]} style={{ transform: "translate(18px, -18%)" }}>
          <div ref={keepEventsInCard} style={{ ...cardStyle, border: "1px solid rgba(251,191,36,0.5)", background: "rgba(20, 14, 4, 0.94)", color: "#fff7e6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#fbbf24", letterSpacing: "0.1em" }}>📜 HISTORIA</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{place.title}</div>
              </div>
              <button style={closeBtn} aria-label="Stäng" onClick={() => select(null)}>×</button>
            </div>
            {place.thumbnail && (
              <img src={place.thumbnail} alt="" style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 8, margin: "8px 0 4px" }} />
            )}
            <div style={{ lineHeight: 1.45, marginTop: 6, color: "#f5e9cf" }}>{place.extract || "Ingen sammanfattning tillgänglig."}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <div style={{ fontSize: 10, color: REAL }}>● VERKLIG DATA · Wikipedia (CC BY-SA)</div>
              <a href={place.url} target="_blank" rel="noreferrer" style={{ color: "#fbbf24", fontSize: 11 }}>Läs mer ↗</a>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ── ectoplasm (Ghost Mode) ─────────────────────────────────────────────────

const ectoMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uDensity: { value: 0.3 }, uColor: { value: new THREE.Color("#39ff9c") } },
  vertexShader: /* glsl */ `
    varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uDensity; uniform vec3 uColor; varying vec3 vW;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main() {
      vec2 p = vW.xz * 0.035 + vec2(uTime * 0.03, uTime * 0.018);
      float n = fbm(p + fbm(p * 1.7 - uTime * 0.02));
      float mist = smoothstep(0.42, 0.85, n);
      gl_FragColor = vec4(uColor * (0.6 + n), mist * uDensity);
    }`,
});

function Ectoplasm({ p, terrain, pm25 }: { p: Projection; terrain: TerrainGrid | null; pm25: number }) {
  const geometry = useMemo(() => {
    const w = (p.bbox.maxLng - p.bbox.minLng) * p.scaleX * 1.1;
    const d = (p.bbox.maxLat - p.bbox.minLat) * p.scaleY * 1.1;
    const g = new THREE.PlaneGeometry(w, d, 90, 90).rotateX(-Math.PI / 2);
    return drapeGeometry(g, terrain, p, (x, _y, z) => [x, z], "y");
  }, [p, terrain]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Real PM2.5 sets the thickness: clean air → thin wisps, polluted air → thick ectoplasm.
  ectoMaterial.uniforms.uDensity.value = THREE.MathUtils.clamp(0.12 + pm25 * 0.035, 0.12, 0.75);
  useFrame((state) => { ectoMaterial.uniforms.uTime.value = state.clock.elapsedTime; });
  return <mesh geometry={geometry} material={ectoMaterial} position={[0, 1.2, 0]} raycast={noRaycast} renderOrder={1} />;
}

// ── moon ───────────────────────────────────────────────────────────────────

function moonTexture(illum: number, waxing: boolean) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size * 0.32, cx = size / 2, cy = size / 2;
  const halo = g.createRadialGradient(cx, cy, r * 0.8, cx, cy, size / 2);
  halo.addColorStop(0, "rgba(220,230,255,0.35)");
  halo.addColorStop(1, "rgba(220,230,255,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  g.fillStyle = "rgba(40,45,70,0.9)"; // dark side
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  // lit part: a half disc plus an ellipse of width depending on illumination
  g.fillStyle = "#eef1ff";
  const k = 1 - 2 * illum; // 1 = new, -1 = full
  g.beginPath();
  const side = waxing ? 1 : -1; // northern hemisphere: waxing moon is lit on the right
  g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, side < 0);
  g.ellipse(cx, cy, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === side > 0);
  g.fill();
  // a few craters
  g.fillStyle = "rgba(150,160,190,0.35)";
  for (const [dx, dy, rr] of [[-0.3, -0.2, 0.12], [0.2, 0.25, 0.09], [0.1, -0.35, 0.07], [-0.15, 0.3, 0.06]]) {
    g.beginPath(); g.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Moon() {
  const sprite = useRef<THREE.Sprite>(null!);
  const day = new Date().toDateString();
  const texture = useMemo(() => moonTexture(moonIllumination(new Date()), moonWaxing(new Date())), [day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const now = new Date();
    const { elevation, azimuth } = moonPosition(now, WEATHER_POINT.lat, WEATHER_POINT.lon);
    const [dx, dy, dz] = sunDirection(elevation, azimuth);
    sprite.current.visible = elevation > -3;
    sprite.current.position.set(dx * 800, dy * 800, dz * 800);
  });
  return (
    <sprite ref={sprite} scale={[90, 90, 1]} raycast={noRaycast}>
      <spriteMaterial map={texture} transparent depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  );
}

// ── root ───────────────────────────────────────────────────────────────────

export function OpenDataScene() {
  const projection = useAreaStore((s) => s.projection);
  const terrain = useAreaStore((s) => s.terrain);
  const air = useOpenData((s) => s.air);
  const history = useOpenData((s) => s.history);
  const layers = useOpenData((s) => s.layers);
  const ghostMode = useGhostStore((s) => s.ghostMode);

  // Escape closes open-data cards too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useOpenData.setState({ selectedAir: null, selectedPlace: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const placesInArea = useMemo(() => {
    if (!projection) return [];
    const b = projection.bbox;
    return history.filter((h) => h.lat >= b.minLat && h.lat <= b.maxLat && h.lon >= b.minLng && h.lon <= b.maxLng);
  }, [history, projection]);

  if (!projection) return null;
  const pm = interpolatePm25(air, WEATHER_POINT.lat, WEATHER_POINT.lon);
  return (
    <>
      {layers.air && air.map((s) => <AirStationMarker key={s.id} s={s} p={projection} terrain={terrain} />)}
      {layers.history && placesInArea.map((h) => <HistoryMarker key={h.pageid} place={h} p={projection} terrain={terrain} />)}
      {ghostMode && layers.ectoplasm && pm !== null && <Ectoplasm p={projection} terrain={terrain} pm25={pm} />}
      {layers.moon && <Moon />}
    </>
  );
}

export { moonPhaseName };
