// ── Walk mode: first-person movement at street level ───────────────────────
// Enter: the camera flies down to the nearest street. Move with WASD/arrows
// (Shift = run), look around by dragging, or click on the ground to walk there.
// Buildings and water block the way; the eye height follows the terrain.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAreaStore } from "@/state/areaStore";
import { groundAtWorld } from "@/three/terrain";
import { METERS_PER_UNIT } from "@/three/geo";
import { useGhostStore } from "@/ghost/ghostStore";
import { nearestNode, nearestStreetName } from "@/ghost/streetGraph";
import { useStreetGraph } from "@/ghost/useStreetGraph";
import { localGhostEnergy } from "@/ghost/localEnergy";
import { buildCollider } from "./collision.ts";
import { useWalkStore } from "./walkStore.ts";

const EYE = 0.8; // ≈ 1.7 m
const RADIUS = 0.55; // keeps the camera far enough from walls that it never sees inside
const WALK_NEAR = 0.1; // camera near plane while walking (overview uses 0.5)
const WALK_SPEED = 2.0; // units/s – brisk, so the whole area can be explored
const RUN_SPEED = 6.0;
const LOOK_SPEED = 0.0042;
const FLY_SECONDS = 1.6;

type Anim = { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromQ: THREE.Quaternion; toQ: THREE.Quaternion; t: number; done: () => void };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lookQuaternion(from: THREE.Vector3, to: THREE.Vector3) {
  const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function WalkControls() {
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as any;
  const mode = useWalkStore((s) => s.mode);
  const projection = useAreaStore((s) => s.projection);
  const terrain = useAreaStore((s) => s.terrain);
  const areas = useAreaStore((s) => s.areas);
  const water = useAreaStore((s) => s.waterPolygons);
  const roads = useAreaStore((s) => s.roads);
  const streets = useStreetGraph();

  const collider = useMemo(() => {
    if (!projection) return null;
    const bridges = roads
      .filter((r: any) => r.tags?.bridge === "yes" && r.geometry?.length >= 2)
      .map((r: any) => ({ geometry: r.geometry, halfWidth: (parseFloat(r.tags?.width) || 4) / 2 / METERS_PER_UNIT + 0.5 }));
    return buildCollider(projection, areas, water, bridges);
  }, [projection, areas, water, roads]);

  const ground = (x: number, z: number) => (projection ? groundAtWorld(terrain, projection, x, z) : 0);

  const pos = useRef(new THREE.Vector3());
  const yaw = useRef(0);
  const pitch = useRef(-0.05);
  const target = useRef<THREE.Vector2 | null>(null);
  const stuck = useRef({ t: 0, lastDist: Infinity });
  const anim = useRef<Anim | null>(null);
  const saved = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const keys = useRef<Record<string, boolean>>({});
  const timers = useRef({ street: 0, meter: 0, heading: 0 });
  const marker = useRef<THREE.Mesh>(null!);

  // ── enter / exit transitions ─────────────────────────────────────────────
  useEffect(() => {
    if (mode === "entering" && streets && controls) {
      saved.current = { pos: camera.position.clone(), target: controls.target.clone() };
      controls.enabled = false;
      (camera as THREE.PerspectiveCamera).near = WALK_NEAR;
      camera.updateProjectionMatrix();
      // nearest walkable street node under what the camera was looking at
      let n = nearestNode(streets, controls.target.x, controls.target.z);
      if (collider?.blocked(streets.nodes[n][0], streets.nodes[n][1], RADIUS)) {
        let best = Infinity;
        streets.nodes.forEach(([x, z], i) => {
          const d = (x - controls.target.x) ** 2 + (z - controls.target.z) ** 2;
          if (d < best && !collider.blocked(x, z, RADIUS)) { best = d; n = i; }
        });
      }
      const [x, z] = streets.nodes[n];
      const next = streets.adjacency[n][0];
      const [nx, nz] = next ? streets.nodes[next.to] : [x, z - 1];
      yaw.current = Math.atan2(-(nx - x), -(nz - z));
      pitch.current = -0.05;
      pos.current.set(x, ground(x, z) + EYE, z);
      target.current = null;
      anim.current = {
        fromPos: camera.position.clone(),
        toPos: pos.current.clone(),
        fromQ: camera.quaternion.clone(),
        toQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, "YXZ")),
        t: 0,
        done: () => useWalkStore.getState().setMode("walk"),
      };
    }
    if (mode === "exiting" && saved.current && controls) {
      const s = saved.current;
      anim.current = {
        fromPos: camera.position.clone(),
        toPos: s.pos.clone(),
        fromQ: camera.quaternion.clone(),
        toQ: lookQuaternion(s.pos, s.target),
        t: 0,
        done: () => {
          (camera as THREE.PerspectiveCamera).near = 0.5;
          camera.updateProjectionMatrix();
          controls.target.copy(s.target);
          controls.enabled = true;
          controls.update();
          useWalkStore.getState().setMode("orbit");
          useWalkStore.getState().setStreet(null);
        },
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── keyboard and mouse look ──────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "walk") return;
    const el = gl.domElement;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      keys.current[e.key.toLowerCase()] = true;
      if (e.key.startsWith("Arrow")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    // Escape leaves the street unless a card is open (then Escape closes the card).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const cardOpen = document.querySelector('[role="dialog"] button[aria-label="Stäng"]') || useGhostStore.getState().selectedId || useGhostStore.getState().selectedEntityId || useGhostStore.getState().selectedAcousticId;
      if (!cardOpen) useWalkStore.getState().exit();
    };
    let dragging = false, lastX = 0, lastY = 0;
    const pdown = (e: PointerEvent) => { if (e.button === 0) { dragging = true; lastX = e.clientX; lastY = e.clientY; } };
    const pmove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw.current += (e.clientX - lastX) * LOOK_SPEED;
      pitch.current = THREE.MathUtils.clamp(pitch.current + (e.clientY - lastY) * LOOK_SPEED, -1.2, 1.2);
      lastX = e.clientX; lastY = e.clientY;
    };
    const pup = () => { dragging = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("keydown", esc, true); // capture: runs before cards close on the same key
    el.addEventListener("pointerdown", pdown);
    window.addEventListener("pointermove", pmove);
    window.addEventListener("pointerup", pup);
    return () => {
      keys.current = {};
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("keydown", esc, true);
      el.removeEventListener("pointerdown", pdown);
      window.removeEventListener("pointermove", pmove);
      window.removeEventListener("pointerup", pup);
    };
  }, [mode, gl]);

  // ── per frame ────────────────────────────────────────────────────────────
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / FLY_SECONDS);
      const k = ease(a.t);
      camera.position.lerpVectors(a.fromPos, a.toPos, k);
      camera.quaternion.slerpQuaternions(a.fromQ, a.toQ, k);
      if (a.t >= 1) { anim.current = null; a.done(); }
      return;
    }
    if (mode !== "walk" || !collider || !projection) {
      if (marker.current) marker.current.visible = false;
      return;
    }

    // click on the ground → walk target (march along the view ray until it meets the terrain)
    const click = useWalkStore.getState().takeClick();
    if (click) {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((click.x - rect.left) / rect.width) * 2 - 1, -((click.y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const o = raycaster.ray.origin, d = raycaster.ray.direction;
      for (let t = 0.5; t < 300; t += 0.5) {
        const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
        if (py <= ground(px, pz) + 0.05) { target.current = new THREE.Vector2(px, pz); stuck.current = { t: 0, lastDist: Infinity }; break; }
      }
    }

    // movement
    const k = keys.current;
    const fwd = (k["w"] || k["arrowup"] ? 1 : 0) - (k["s"] || k["arrowdown"] ? 1 : 0);
    const side = (k["d"] || k["arrowright"] ? 1 : 0) - (k["a"] || k["arrowleft"] ? 1 : 0);
    const speed = k["shift"] ? RUN_SPEED : WALK_SPEED;
    let dx = 0, dz = 0;
    const sin = Math.sin(yaw.current), cos = Math.cos(yaw.current);
    if (fwd || side) {
      target.current = null;
      dx = (-sin * fwd + cos * side);
      dz = (-cos * fwd - sin * side);
      const len = Math.hypot(dx, dz) || 1;
      dx = (dx / len) * speed * dt;
      dz = (dz / len) * speed * dt;
    } else if (target.current) {
      const tx = target.current.x - pos.current.x, tz = target.current.y - pos.current.z;
      const dist = Math.hypot(tx, tz);
      if (dist < 0.6) target.current = null;
      else {
        const step = Math.min(dist, WALK_SPEED * 1.5 * dt);
        dx = (tx / dist) * step;
        dz = (tz / dist) * step;
        // turn smoothly towards the target
        const want = Math.atan2(-tx, -tz);
        let diff = want - yaw.current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        yaw.current += diff * Math.min(1, dt * 4);
        // give up if a wall stops us
        stuck.current.t += dt;
        if (stuck.current.t > 0.7) {
          if (stuck.current.lastDist - dist < 0.15) target.current = null;
          stuck.current = { t: 0, lastDist: dist };
        }
      }
    }
    if (dx || dz) {
      const [nx, nz] = collider.move(pos.current.x, pos.current.z, dx, dz, RADIUS);
      pos.current.x = nx;
      pos.current.z = nz;
    }
    const wantY = ground(pos.current.x, pos.current.z) + EYE;
    pos.current.y += (wantY - pos.current.y) * (1 - Math.exp(-dt * 10));
    camera.position.copy(pos.current);
    camera.quaternion.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, "YXZ"));

    if (marker.current) {
      marker.current.visible = !!target.current;
      if (target.current) {
        marker.current.position.set(target.current.x, ground(target.current.x, target.current.y) + 0.15, target.current.y);
        marker.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 6) * 0.15);
      }
    }

    // HUD: street name, compass heading, ghost meter
    const tm = timers.current;
    tm.street += dt; tm.heading += dt; tm.meter += dt;
    const store = useWalkStore.getState();
    if (tm.street > 0.3 && streets) {
      tm.street = 0;
      store.setStreet(nearestStreetName(streets, pos.current.x, pos.current.z, 8) ?? nearestStreetName(streets, pos.current.x, pos.current.z, 5, false));
    }
    if (tm.heading > 0.1) {
      tm.heading = 0;
      const h = ((((-yaw.current * 180) / Math.PI) % 360) + 360) % 360;
      if (Math.abs(h - store.heading) > 0.5) store.setHeading(h);
    }
    if (tm.meter > 0.1) {
      tm.meter = 0;
      store.setMeter(localGhostEnergy(pos.current));
    }
  });

  return (
    <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
      <ringGeometry args={[0.35, 0.5, 32]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
