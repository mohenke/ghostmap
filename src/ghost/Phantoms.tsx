// ── Gastar: misty phantoms drifting along the streets (Ghost Mode, decoration) ──
// Each phantom follows a random walk on the real street network, fades in,
// drifts for a while, dissolves and reappears somewhere else. Purely visual –
// not part of the (fictional) measurement data.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAreaStore } from "@/state/areaStore";
import { groundAtWorld } from "@/three/terrain";
import { getGlowTexture } from "./glow.ts";
import { pointAt, randomWalk, toStreetPath, type StreetGraph } from "./streetGraph.ts";
import { useStreetGraph } from "./useStreetGraph.ts";
import type { StreetPath } from "./types.ts";
import { useWalkStore } from "@/walk/walkStore";

const COUNT = 9;
const HEIGHT = 5.5; // ≈ 12 m – larger than life, so they read from the overview
const TRAIL = 6;
const noRaycast = () => null;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// A classic sheet ghost: round head, widening body, wavy hem, dark eye holes – all misty.
const FRAG = /* glsl */ `
  uniform float uTime; uniform float uOpacity; uniform float uSeed; uniform vec3 uColor;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
  void main() {
    vec2 p = vUv;
    float t = uTime + uSeed * 10.0;
    p.x += sin(p.y * 6.0 + t * 1.3) * 0.025 * (1.0 - p.y);          // the sheet ripples
    float head = 1.0 - smoothstep(0.17, 0.25, distance(p, vec2(0.5, 0.74)));
    float halfW = 0.2 + (0.74 - p.y) * 0.14;
    float body = (1.0 - smoothstep(halfW - 0.05, halfW + 0.03, abs(p.x - 0.5))) * step(p.y, 0.74);
    float hem = 0.12 + 0.05 * sin(p.x * 28.0 + t * 3.0) + 0.03 * sin(p.x * 13.0 - t * 2.0);
    body *= smoothstep(hem - 0.08, hem + 0.06, p.y);                 // ragged, fading hem
    float shape = max(head, body);
    float mist = fbm(vec2(p.x * 4.0, p.y * 3.0 - t * 0.35));
    shape *= 0.55 + 0.6 * mist;
    float eyes = (1.0 - smoothstep(0.03, 0.05, distance(p * vec2(1.0, 0.8), vec2(0.43, 0.62))))
               + (1.0 - smoothstep(0.03, 0.05, distance(p * vec2(1.0, 0.8), vec2(0.57, 0.62))));
    float mouth = 1.0 - smoothstep(0.025, 0.045, distance(p * vec2(1.0, 1.3), vec2(0.5, 0.87)));
    vec3 col = mix(uColor, vec3(0.02, 0.0, 0.06), clamp(eyes + mouth * 0.8, 0.0, 1.0));
    float glow = 1.25 + 0.2 * sin(t * 2.0);
    gl_FragColor = vec4(col * glow, clamp(shape * 1.25, 0.0, 1.0) * uOpacity);
  }`;

type Phantom = {
  path: StreetPath;
  dist: number;
  speed: number;
  life: number;
  age: number;
  seed: number;
};

function newPhantom(g: StreetGraph, from?: number): Phantom {
  const start = from ?? Math.floor(Math.random() * g.nodes.length);
  const ids = randomWalk(g, start, 120 + Math.random() * 120, Math.random);
  return {
    path: toStreetPath(g, ids.length > 1 ? ids : [start, g.adjacency[start][0]?.to ?? start]),
    dist: 0,
    speed: 0.45 + Math.random() * 0.45, // ≈ 1–2 m/s: a slow, drifting glide
    life: 28 + Math.random() * 30,
    age: 0,
    seed: Math.random(),
  };
}

function PhantomMesh({ graph, index }: { graph: StreetGraph; index: number }) {
  const terrain = useAreaStore((s) => s.terrain);
  const projection = useAreaStore((s) => s.projection);
  const group = useRef<THREE.Group>(null!);
  const lift = useRef(4.5);
  const plane = useRef<THREE.Mesh>(null!);
  const halo = useRef<THREE.Sprite>(null!);
  const trail = useRef<THREE.Sprite[]>([]);
  const history = useRef<THREE.Vector3[]>([]);
  // stagger the first appearances so they don't all fade in at once
  const state = useRef<Phantom>({ ...newPhantom(graph), age: -index * 2 });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uSeed: { value: Math.random() },
          uColor: { value: new THREE.Color(index % 3 === 0 ? "#cfe8ff" : index % 3 === 1 ? "#e3d9ff" : "#d4fff4") },
        },
      }),
    [index]
  );
  const trailMats = useMemo(
    () => Array.from({ length: TRAIL }, () => new THREE.SpriteMaterial({ map: getGlowTexture(), color: "#bcd4ff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })),
    []
  );
  useEffect(() => () => { material.dispose(); trailMats.forEach((m) => m.dispose()); }, [material, trailMats]);

  useFrame((frame, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const ph = state.current;
    ph.age += dt;
    if (ph.age < 0) { group.current.visible = false; return; }
    ph.dist += ph.speed * dt;
    if (ph.dist >= ph.path.total) {
      // keep wandering from where the route ended
      const last = ph.path.points[ph.path.points.length - 1];
      let end = 0, best = Infinity;
      graph.nodes.forEach(([x, z], i) => { const d = (x - last[0]) ** 2 + (z - last[1]) ** 2; if (d < best) { best = d; end = i; } });
      Object.assign(ph, { path: newPhantom(graph, end).path, dist: 0 });
    }
    if (ph.age > ph.life) {
      state.current = newPhantom(graph); // dissolve and reappear elsewhere
      history.current = [];
      return;
    }
    const fade = Math.min(1, ph.age / 3, (ph.life - ph.age) / 4);
    const t = frame.clock.elapsedTime + ph.seed * 20;
    const p = pointAt(ph.path, ph.dist);
    const ground = projection ? groundAtWorld(terrain, projection, p.x, p.z) : 0;
    // Above the rooftops in the overview (street canyons would hide them), at eye level when walking.
    const walking = useWalkStore.getState().mode !== "orbit";
    const wantLift = walking ? 0.4 : 5.5;
    lift.current += (wantLift - lift.current) * Math.min(1, dt * 1.5);
    const y = ground + lift.current + Math.sin(t * 1.1) * 0.35;
    group.current.visible = true;
    group.current.position.set(p.x, y, p.z);
    // human-sized at street level, giant spectres in the overview
    group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x || 1, walking ? 0.45 : 1, Math.min(1, dt * 1.5)));

    // billboard around the vertical axis only, so the ghost stays upright
    const cam = frame.camera.position;
    plane.current.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
    plane.current.rotation.z = Math.sin(t * 0.8) * 0.06;
    const flicker = 0.75 + 0.25 * Math.sin(t * 3.3) * Math.sin(t * 1.7);
    material.uniforms.uTime.value = frame.clock.elapsedTime;
    material.uniforms.uOpacity.value = fade * 0.95 * flicker;
    (halo.current.material as THREE.SpriteMaterial).opacity = fade * 0.75;

    // misty trail of fading puffs
    const hist = history.current;
    if (!hist.length || hist[0].distanceToSquared(group.current.position) > 0.6) {
      hist.unshift(group.current.position.clone());
      if (hist.length > TRAIL) hist.pop();
    }
    trail.current.forEach((sp, i) => {
      if (!sp) return;
      const h = hist[i + 1];
      sp.visible = !!h;
      if (!h) return;
      sp.position.set(h.x - p.x, h.y - y + 0.6, h.z - p.z);
      trailMats[i].opacity = fade * 0.22 * (1 - i / TRAIL);
      sp.scale.setScalar(1.6 + i * 0.35);
    });
  });

  return (
    <group ref={group} visible={false}>
      <sprite ref={halo} position={[0, HEIGHT * 0.55, 0]} scale={[HEIGHT * 2.2, HEIGHT * 2.2, 1]} raycast={noRaycast}>
        <spriteMaterial map={getGlowTexture()} color="#9fb8ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0} />
      </sprite>
      <mesh ref={plane} position={[0, HEIGHT / 2, 0]} material={material} raycast={noRaycast} renderOrder={4}>
        <planeGeometry args={[HEIGHT * 0.8, HEIGHT]} />
      </mesh>
      {trailMats.map((m, i) => (
        <sprite key={i} ref={(el) => { if (el) trail.current[i] = el; }} material={m} raycast={noRaycast} />
      ))}
    </group>
  );
}

export function Phantoms() {
  const graph = useStreetGraph();
  if (!graph || graph.nodes.length < 2) return null;
  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <PhantomMesh key={i} graph={graph} index={i} />
      ))}
    </>
  );
}
