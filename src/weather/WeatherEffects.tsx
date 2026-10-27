// ── Live weather in the 3D scene ───────────────────────────────────────────
// Driven by the weather store (SMHI). Works in both day mode and Ghost Mode.
//   DayLighting   – real sun position over Haga, dimmed by clouds; night after sunset
//   WeatherFog    – fog density from the real visibility
//   Precipitation – rain streaks / snow flakes drifting with the wind
//   Clouds        – soft cloud banks high in the sky, moving with the wind
//   TreeWind      – tree crowns sway with wind speed and direction
//   Lightning     – flashes when the thunderstorm probability is high
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Sky } from "@react-three/drei";
import * as THREE from "three";
import { useGhostStore } from "@/ghost/ghostStore";
import { getGlowTexture } from "@/ghost/glow";
import { LAMP_HEAD_MAT, windUniforms } from "@/three/StreetDetails";
import { setFacadeLights } from "@/three/surfaceShaders";
import { METERS_PER_UNIT } from "@/three/geo";
import { sunDirection, sunPosition } from "./sun.ts";
import { WEATHER_POINT, useWeatherStore } from "./weatherStore.ts";

const RAD = Math.PI / 180;
const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/** Wind as a world-space velocity (scene units/s), blowing towards (from + 180°). */
function windVector(fromDeg: number, speed: number): THREE.Vector2 {
  const to = (fromDeg + 180) * RAD;
  const u = speed / METERS_PER_UNIT;
  return new THREE.Vector2(Math.sin(to) * u, -Math.cos(to) * u); // x = east, y-component = world z (south)
}

/** Sun over Haga, recomputed every minute. dayFactor: 0 = night, 1 = full day. */
function useSun() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    const { elevation, azimuth } = sunPosition(now, WEATHER_POINT.lat, WEATHER_POINT.lon);
    return { elevation, azimuth, dayFactor: smooth(elevation, -6, 8), dir: sunDirection(elevation, azimuth) };
  }, [now]);
}

// ── day mode lighting ──────────────────────────────────────────────────────

export function DayLighting() {
  const weather = useWeatherStore((s) => s.weather);
  const sun = useSun();
  const c = weather.cloudCover;
  const d = sun.dayFactor;
  const applied = useRef<string | null>(null);

  // Street lamps and some windows light up after sunset. Applied from the render
  // loop so it runs after Space has restored the day theme when leaving Ghost Mode.
  useFrame(() => {
    const night = d < 0.4;
    const key = `${night}-${d.toFixed(2)}`;
    if (applied.current === key) return;
    applied.current = key;
    LAMP_HEAD_MAT.emissive.set(night ? "#ffb35c" : "#000000");
    setFacadeLights(d < 0.6 ? 0.12 * (1 - d) : 0, 1.6 * (1 - d));
  });
  useEffect(() => () => { applied.current = null; }, []);

  const sunColor = new THREE.Color("#ffb070").lerp(new THREE.Color("#fff1dc"), smooth(sun.elevation, 0, 25));
  const lightDir = sun.elevation > 2 ? sun.dir : sunDirection(35, (sun.azimuth + 180) % 360); // moonlight-ish at night
  const lightPos: [number, number, number] = [lightDir[0] * 300, lightDir[1] * 300, lightDir[2] * 300];

  return (
    <>
      <ambientLight intensity={0.12 + 0.13 * d + 0.2 * c * d} color={d > 0.3 ? "#ffffff" : "#8090c0"} />
      <directionalLight position={lightPos} intensity={d * 1.9 * (1 - 0.7 * c) + (1 - d) * 0.22} color={d > 0.3 ? sunColor : "#9fb2ff"} />
      <hemisphereLight args={[d > 0.3 ? "#dfe9ff" : "#2a3350", "#8a7f6c", 0.08 + 0.3 * d]} />
      <Sky
        distance={450000}
        sunPosition={[sun.dir[0], sun.dir[1], sun.dir[2]]}
        turbidity={2 + 16 * c}
        rayleigh={0.6 + 1.6 * (1 - c)}
        mieCoefficient={0.005 + 0.02 * c}
        mieDirectionalG={0.8}
      />
      <Environment preset="city" environmentIntensity={0.45 * (0.12 + 0.88 * d) * (1 - 0.35 * c)} />
    </>
  );
}

// ── fog ────────────────────────────────────────────────────────────────────

const GHOST_FOG = new THREE.Color("#0b0a1f");

function WeatherFog({ ghostMode }: { ghostMode: boolean }) {
  const { scene } = useThree();
  const weather = useWeatherStore((s) => s.weather);
  const ghostFogLayer = useGhostStore((s) => s.layers.fog);
  const sun = useSun();

  useEffect(() => {
    // FogExp2 reaches 2 % contrast at distance V when density = 1.978 / V.
    const visibilityUnits = (Math.max(0.05, weather.visibilityKm) * 1000) / METERS_PER_UNIT;
    const weatherDensity = 1.978 / visibilityUnits;
    let density: number;
    let color: THREE.Color;
    if (ghostMode) {
      density = Math.max(ghostFogLayer ? 0.0016 : 0, weatherDensity);
      color = GHOST_FOG;
    } else {
      density = weatherDensity > 0.00025 ? weatherDensity : 0;
      color = new THREE.Color("#dbe3ec").lerp(new THREE.Color("#aab2bb"), weather.cloudCover).lerp(new THREE.Color("#161a24"), 1 - sun.dayFactor);
    }
    scene.fog = density > 0 ? new THREE.FogExp2(color, density) : null;
    return () => {
      scene.fog = null;
    };
  }, [scene, ghostMode, ghostFogLayer, weather.visibilityKm, weather.cloudCover, sun.dayFactor]);
  return null;
}

// ── rain and snow ──────────────────────────────────────────────────────────

const MAX_DROPS = 7000;
const BOX_W = 420;
const BOX_H = 150;
const RAIN_FALL = 22; // units/s – faster than real life so it reads at city scale
const SNOW_FALL = 2.2;

function Precipitation({ ghostMode }: { ghostMode: boolean }) {
  const weather = useWeatherStore((s) => s.weather);
  const controls = useThree((s) => s.controls) as any;

  const { drops, rainGeo, snowGeo } = useMemo(() => {
    const drops = new Float32Array(MAX_DROPS * 3);
    for (let i = 0; i < MAX_DROPS; i++) {
      drops[i * 3] = (Math.random() - 0.5) * BOX_W;
      drops[i * 3 + 1] = Math.random() * BOX_H;
      drops[i * 3 + 2] = (Math.random() - 0.5) * BOX_W;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 6), 3));
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 3), 3));
    return { drops, rainGeo, snowGeo };
  }, []);
  useEffect(() => () => { rainGeo.dispose(); snowGeo.dispose(); }, [rainGeo, snowGeo]);

  const rainMat = useMemo(() => new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }), []);
  const snowMat = useMemo(() => new THREE.PointsMaterial({ size: 1.3, map: getGlowTexture(), transparent: true, depthWrite: false, sizeAttenuation: true }), []);
  useEffect(() => {
    rainMat.color.set(ghostMode ? "#8fd8ff" : "#a9bccf");
    rainMat.opacity = ghostMode ? 0.35 : 0.5;
    rainMat.blending = ghostMode ? THREE.AdditiveBlending : THREE.NormalBlending;
    snowMat.color.set(ghostMode ? "#cfd6ff" : "#ffffff");
    snowMat.opacity = 0.9;
  }, [ghostMode, rainMat, snowMat]);

  const rainRef = useRef<THREE.LineSegments>(null!);
  const snowRef = useRef<THREE.Points>(null!);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const p = weather.precipitation;
    const total = p > 0.05 ? Math.min(MAX_DROPS, Math.round(900 + p * 1100)) : 0;
    const nSnow = Math.round(total * weather.frozenFraction);
    const nRain = total - nSnow;
    rainRef.current.visible = nRain > 0;
    snowRef.current.visible = nSnow > 0;
    if (total === 0) return;

    const wind = windVector(weather.windFrom, weather.windSpeed);
    const cx = controls?.target?.x ?? 0;
    const cz = controls?.target?.z ?? 0;
    const t = state.clock.elapsedTime;
    const rp = rainGeo.attributes.position.array as Float32Array;
    const sp = snowGeo.attributes.position.array as Float32Array;
    const half = BOX_W / 2;

    for (let i = 0; i < total; i++) {
      const snow = i >= nRain;
      const k = i * 3;
      const vx = snow ? wind.x * 0.6 + Math.sin(t * 1.3 + i) * 0.4 : wind.x * 0.7;
      const vz = snow ? wind.y * 0.6 + Math.cos(t * 1.1 + i) * 0.4 : wind.y * 0.7;
      const vy = snow ? -SNOW_FALL : -RAIN_FALL;
      drops[k] += vx * dt;
      drops[k + 1] += vy * dt;
      drops[k + 2] += vz * dt;
      if (drops[k + 1] < 0) drops[k + 1] += BOX_H;
      // keep the volume centred on what the camera looks at
      const x = ((((drops[k] - cx + half) % BOX_W) + BOX_W) % BOX_W) - half + cx;
      const z = ((((drops[k + 2] - cz + half) % BOX_W) + BOX_W) % BOX_W) - half + cz;
      const y = drops[k + 1];
      if (snow) {
        const j = (i - nRain) * 3;
        sp[j] = x; sp[j + 1] = y; sp[j + 2] = z;
      } else {
        const j = i * 6;
        rp[j] = x; rp[j + 1] = y; rp[j + 2] = z;
        rp[j + 3] = x - vx * 0.045; rp[j + 4] = y - vy * 0.045; rp[j + 5] = z - vz * 0.045;
      }
    }
    rainGeo.setDrawRange(0, nRain * 2);
    snowGeo.setDrawRange(0, nSnow);
    rainGeo.attributes.position.needsUpdate = true;
    snowGeo.attributes.position.needsUpdate = true;
  });

  return (
    <>
      <lineSegments ref={rainRef} geometry={rainGeo} material={rainMat} frustumCulled={false} raycast={() => null} />
      <points ref={snowRef} geometry={snowGeo} material={snowMat} frustumCulled={false} raycast={() => null} />
    </>
  );
}

// ── clouds ─────────────────────────────────────────────────────────────────

const CLOUD_COUNT = 18;
const CLOUD_SPREAD = 2400;

function Clouds({ ghostMode }: { ghostMode: boolean }) {
  const weather = useWeatherStore((s) => s.weather);
  const sun = useSun();
  const sprites = useRef<THREE.Sprite[]>([]);
  const seeds = useMemo(
    () => Array.from({ length: CLOUD_COUNT }, () => ({
      x: (Math.random() - 0.5) * CLOUD_SPREAD,
      z: (Math.random() - 0.5) * CLOUD_SPREAD,
      y: 420 + Math.random() * 160,
      s: 500 + Math.random() * 450,
    })),
    []
  );
  const mats = useMemo(() => seeds.map(() => new THREE.SpriteMaterial({ map: getGlowTexture(), transparent: true, depthWrite: false, fog: false })), [seeds]);

  useEffect(() => {
    const c = weather.cloudCover;
    const color = ghostMode
      ? new THREE.Color("#2b2148")
      : new THREE.Color("#ffffff").lerp(new THREE.Color("#8e959c"), c).lerp(new THREE.Color("#262a33"), 1 - sun.dayFactor);
    mats.forEach((m, i) => {
      m.color.copy(color);
      m.opacity = i < Math.round(c * CLOUD_COUNT) ? (ghostMode ? 0.45 : 0.7) : 0;
    });
  }, [weather.cloudCover, ghostMode, sun.dayFactor, mats]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const wind = windVector(weather.windFrom, weather.windSpeed);
    const half = CLOUD_SPREAD / 2;
    sprites.current.forEach((sp, i) => {
      if (!sp) return;
      const sd = seeds[i];
      sd.x += wind.x * dt * 1.5;
      sd.z += wind.y * dt * 1.5;
      if (sd.x > half) sd.x -= CLOUD_SPREAD; else if (sd.x < -half) sd.x += CLOUD_SPREAD;
      if (sd.z > half) sd.z -= CLOUD_SPREAD; else if (sd.z < -half) sd.z += CLOUD_SPREAD;
      sp.position.set(sd.x, sd.y, sd.z);
    });
  });

  return (
    <>
      {seeds.map((sd, i) => (
        <sprite key={i} ref={(el) => { if (el) sprites.current[i] = el; }} material={mats[i]} scale={[sd.s, sd.s * 0.42, 1]} raycast={() => null} />
      ))}
    </>
  );
}

// ── wind in the trees ──────────────────────────────────────────────────────

function TreeWind() {
  const weather = useWeatherStore((s) => s.weather);
  useFrame((state) => {
    windUniforms.uTime.value = state.clock.elapsedTime;
    const to = (weather.windFrom + 180) * RAD;
    // crowns lean up to ~1 unit in a gale; gusts make them move faster
    const amp = Math.min(weather.windSpeed / 18, 1.2) * 0.8;
    windUniforms.uWind.value.set(Math.sin(to) * amp, -Math.cos(to) * amp);
    windUniforms.uFreq.value = 1 + Math.min(weather.windGust, 30) * 0.06;
  });
  return null;
}

// ── lightning ──────────────────────────────────────────────────────────────

function Lightning() {
  const weather = useWeatherStore((s) => s.weather);
  const light = useRef<THREE.AmbientLight>(null!);
  const next = useRef(4);
  const flash = useRef(0);
  const active = weather.thunderProbability >= 40;

  useFrame((state, dt) => {
    if (!active) { light.current.intensity = 0; return; }
    const t = state.clock.elapsedTime;
    if (t > next.current) {
      flash.current = 1;
      next.current = t + 5 + Math.random() * 12;
    }
    flash.current = Math.max(0, flash.current - dt * 4);
    // double flicker
    const f = flash.current;
    light.current.intensity = f > 0 ? (f > 0.6 || (f < 0.4 && f > 0.25) ? 4 : 0.6) * f : 0;
  });
  return <ambientLight ref={light} color="#dfe6ff" intensity={0} />;
}

// ── root ───────────────────────────────────────────────────────────────────

export function WeatherEffects() {
  const ghostMode = useGhostStore((s) => s.ghostMode);
  return (
    <>
      <WeatherFog ghostMode={ghostMode} />
      <Precipitation ghostMode={ghostMode} />
      <Clouds ghostMode={ghostMode} />
      <TreeWind />
      <Lightning />
    </>
  );
}
