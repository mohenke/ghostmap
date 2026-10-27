// ── GHOST PULSE – simulated paranormal sensor network ─────────────────────
//
// ALL DATA PRODUCED HERE IS FICTIONAL.
//
// The model is intentionally simple but not purely random:
//
//   energy = baseline                (some places are more haunted than others)
//          + slow wave               (each sensor "breathes" with its own period)
//          + night cycle             (a shared ~10 minute "witching hour" wave)
//          + drift                   (smooth random noise, Ornstein–Uhlenbeck style)
//          + event boost             (temporary paranormal events → strong spikes)
//
// Events fade out over a few ticks and can spread as weaker "echoes" to the
// nearest neighbouring sensor, so activity appears to wander through the area.
//
// With a street network (context.streets) the simulation also moves ghosts:
//   wisps  – wander the real streets; sensor events release wisps that head for
//            a hot sensor. A wisp passing or reaching a sensor raises its energy.
//   flows  – energy streaming along the streets between the hottest sensor pairs.

import type {
  GhostBatch,
  GhostContext,
  GhostDataSource,
  GhostEntity,
  GhostEvent,
  GhostEventType,
  GhostFlow,
  RiskLevel,
  SensorDefinition,
  SensorReading,
  StreetPath,
  AcousticReading,
} from "./types.ts";
import { nearestNode, pointAt, randomWalk, shortestPath, toStreetPath, type StreetGraph } from "./streetGraph.ts";

const MAX_WISPS = 10;
const BASE_WANDERERS = 2;
const PASS_RADIUS = 9; // scene units (~20 m)
const FLOW_COUNT = 5;
/** Events that release a wisp heading for another sensor. */
const WISP_EVENTS = new Set<GhostEventType>(["ectoplasm", "shadow_movement", "full_manifestation"]);
const GENERIC_STREET = /^(gata|gångväg|trappa|cykelbana|infart)$/;

type WispState = GhostEntity & { travelled: number; passed: Set<string> };

type AcousticState = { def: SensorDefinition; howlTicks: number; howlTotal: number; intensity: number; peak: number };

type EventSpec = {
  type: GhostEventType;
  /** Relative likelihood when an event occurs. */
  weight: number;
  /** Energy added at full intensity. */
  boost: number;
  /** Extra temperature drop (°C) at full intensity. */
  cold: number;
  /** Duration range in ticks. */
  duration: [number, number];
};

export const EVENT_SPECS: EventSpec[] = [
  { type: "temperature_drop",   weight: 30, boost: 18, cold: 7,  duration: [3, 6] },
  { type: "whispers",           weight: 26, boost: 14, cold: 2,  duration: [2, 5] },
  { type: "shadow_movement",    weight: 22, boost: 22, cold: 3,  duration: [2, 4] },
  { type: "ectoplasm",          weight: 16, boost: 32, cold: 5,  duration: [4, 7] },
  { type: "full_manifestation", weight: 6,  boost: 55, cold: 12, duration: [4, 8] },
];

const SPEC_BY_TYPE = Object.fromEntries(EVENT_SPECS.map((s) => [s.type, s])) as Record<
  GhostEventType,
  EventSpec
>;

export function riskFromEnergy(energy: number): RiskLevel {
  if (energy >= 80) return "critical";
  if (energy >= 55) return "high";
  if (energy >= 30) return "medium";
  return "low";
}

/** Small deterministic PRNG so runs can be reproduced in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ActiveEvent = {
  type: GhostEventType;
  intensity: number;
  ticksLeft: number;
  totalTicks: number;
};

type SensorState = {
  def: SensorDefinition;
  period: number; // seconds
  phase: number;
  drift: number;
  event: ActiveEvent | null;
  pendingEcho: { type: GhostEventType; intensity: number } | null;
  /** Extra energy from passing wisps; fades each tick. */
  visit: number;
  /** Nearest street node (when a street network is available). */
  node: number;
  energy: number;
};

export type SimulationOptions = {
  intervalMs?: number;
  seed?: number;
  /** Clock override for tests. */
  now?: () => number;
};

export class SimulatedGhostSource implements GhostDataSource {
  readonly intervalMs: number;
  private rng: () => number;
  private now: () => number;
  private sensors: SensorState[] = [];
  private listeners = new Set<(batch: GhostBatch) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private eventCounter = 0;
  private streets: StreetGraph | null = null;
  private wisps: WispState[] = [];
  private wispCounter = 0;
  private routeCache = new Map<string, StreetPath | null>();
  private ambient: (() => number) | null = null;
  private acoustic: AcousticState[] = [];
  private environment: () => { moon: number; wind: number } = () => ({ moon: 0.5, wind: 3 });

  constructor(opts: SimulationOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 5000;
    this.rng = opts.seed != null ? mulberry32(opts.seed) : Math.random;
    this.now = opts.now ?? Date.now;
  }

  start(sensors: SensorDefinition[], context: GhostContext = {}): void {
    this.stop();
    this.startedAt = this.now();
    this.sensors = sensors.map((def) => ({
      def,
      period: 70 + this.rng() * 110,
      phase: this.rng() * Math.PI * 2,
      drift: (this.rng() - 0.5) * 10,
      event: null,
      pendingEcho: null,
      visit: 0,
      node: -1,
      energy: def.baseline,
    }));
    this.streets = context.streets && context.streets.nodes.length > 1 ? context.streets : null;
    this.ambient = context.ambient ?? null;
    this.acoustic = (context.acoustic ?? []).map((def) => ({ def, howlTicks: 0, howlTotal: 0, intensity: 0, peak: 0 }));
    if (context.environment) this.environment = context.environment;
    this.wisps = [];
    this.routeCache.clear();
    if (this.streets) {
      for (const s of this.sensors) {
        const p = s.def.position;
        if (p) s.node = nearestNode(this.streets, p[0], p[2]);
      }
    }
    // Emit a first batch right away so the UI never starts empty.
    this.emit(this.tick());
    this.timer = setInterval(() => this.emit(this.tick()), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(listener: (batch: GhostBatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(batch: GhostBatch) {
    this.listeners.forEach((l) => l(batch));
  }

  private gaussian(): number {
    // Box–Muller
    const u = 1 - this.rng();
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private pickEventType(): GhostEventType {
    const total = EVENT_SPECS.reduce((s, e) => s + e.weight, 0);
    let r = this.rng() * total;
    for (const spec of EVENT_SPECS) {
      r -= spec.weight;
      if (r <= 0) return spec.type;
    }
    return EVENT_SPECS[0].type;
  }

  private startEvent(s: SensorState, type: GhostEventType, intensity: number) {
    const [min, max] = SPEC_BY_TYPE[type].duration;
    const totalTicks = Math.round(min + this.rng() * (max - min));
    s.event = { type, intensity, ticksLeft: totalTicks, totalTicks };
  }

  private nearestNeighbour(s: SensorState): SensorState | null {
    let best: SensorState | null = null;
    let bestD = Infinity;
    for (const o of this.sensors) {
      if (o === s) continue;
      const d = Math.hypot(o.def.lat - s.def.lat, (o.def.lon - s.def.lon) * 0.53);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /** Advance the simulation one step. Public so tests can drive it directly. */
  tick(): GhostBatch {
    const timestamp = this.now();
    const t = (timestamp - this.startedAt) / 1000;
    const events: GhostEvent[] = [];
    // Shared slow "witching hour" cycle (~10 minutes) plus any external influence (moon).
    const night = Math.sin((2 * Math.PI * t) / 600) * 8 + (this.ambient?.() ?? 0);

    // 1. Age running events, start echoes queued last tick, maybe spawn new events.
    for (const s of this.sensors) {
      if (s.event) {
        s.event.ticksLeft -= 1;
        if (s.event.ticksLeft <= 0) s.event = null;
      }
      if (!s.event && s.pendingEcho) {
        this.startEvent(s, s.pendingEcho.type, s.pendingEcho.intensity);
        events.push(this.logEvent(s, true));
      }
      s.pendingEcho = null;

      if (!s.event) {
        // More haunted places have more frequent events.
        const p = 0.015 + 0.16 * (s.def.baseline / 100);
        if (this.rng() < p) {
          const type = this.pickEventType();
          this.startEvent(s, type, 0.55 + this.rng() * 0.45);
          events.push(this.logEvent(s, false));
          // Strong events may spread to the nearest sensor next tick.
          const n = this.nearestNeighbour(s);
          if (n && !n.event && this.rng() < 0.45) {
            n.pendingEcho = { type, intensity: s.event!.intensity * 0.4 };
          }
        }
      }
    }

    // 2. Move wisps: passing sensors and arrivals raise sensor energy.
    const newlyEventful = events.filter((e) => !e.echo && WISP_EVENTS.has(e.type)).map((e) => e.sensor_id);
    if (this.streets) {
      events.push(...this.moveWisps(timestamp));
      for (const id of newlyEventful) {
        const s = this.sensors.find((x) => x.def.sensor_id === id);
        if (s) { const e = this.releaseWisp(s, timestamp); if (e) events.push(e); }
      }
      while (this.wisps.filter((w) => !w.target_sensor).length < BASE_WANDERERS && this.wisps.length < MAX_WISPS) {
        this.spawnWanderer(timestamp);
      }
    }

    // 2b. Acoustic sensors: werewolf howls – much more likely when the (real) moon is full.
    const acoustic = this.tickAcoustic(timestamp, events);

    // 3. Compute readings.
    const readings: SensorReading[] = this.sensors.map((s) => {
      s.drift = s.drift * 0.75 + this.gaussian() * 3.5;
      const wave = Math.sin((2 * Math.PI * t) / s.period + s.phase) * 10;

      let boost = 0;
      let cold = 0;
      if (s.event) {
        const spec = SPEC_BY_TYPE[s.event.type];
        // Rises fast, fades out over the event's lifetime.
        const life = s.event.ticksLeft / s.event.totalTicks;
        const envelope = Math.min(1, life * 1.6);
        boost = spec.boost * s.event.intensity * envelope;
        cold = spec.cold * s.event.intensity * envelope;
      }

      const energy = round1(clamp(s.def.baseline + wave + night + s.drift + boost + s.visit, 0, 100));
      s.visit *= 0.6;
      s.energy = energy;
      const temperature_drop = Math.max(0, 0.4 + energy * 0.09 + cold + this.gaussian() * 0.4);

      return {
        sensor_id: s.def.sensor_id,
        position: s.def.position ?? [0, 0, 0],
        ghost_energy: energy,
        temperature_drop: round1(temperature_drop),
        spectral_activity: s.event ? s.event.type : backgroundActivity(energy),
        risk_level: riskFromEnergy(energy),
        active_event: s.event?.type ?? null,
        timestamp,
      };
    });

    return {
      readings,
      events,
      entities: this.wisps.map(({ travelled: _t, passed: _p, ...e }) => e),
      flows: this.streets ? this.computeFlows() : [],
      acoustic,
    };
  }

  private tickAcoustic(timestamp: number, events: GhostEvent[]): AcousticReading[] {
    const env = this.environment();
    return this.acoustic.map((a) => {
      if (a.howlTicks > 0) a.howlTicks -= 1;
      else if (this.rng() < 0.008 + 0.06 * env.moon * env.moon) {
        a.howlTotal = a.howlTicks = 2 + Math.floor(this.rng() * 2);
        a.intensity = 0.6 + this.rng() * 0.4;
        a.peak = Math.round(380 + this.rng() * 320);
        const db = Math.round(62 + 22 * a.intensity);
        // the howl stirs up the nearest ghost sensor
        let nearest: SensorState | null = null, best = Infinity;
        for (const s of this.sensors) {
          const d = Math.hypot(s.def.lat - a.def.lat, (s.def.lon - a.def.lon) * 0.53);
          if (d < best) { best = d; nearest = s; }
        }
        if (nearest) nearest.visit += 12 * a.intensity;
        events.push({
          id: `evt-${++this.eventCounter}`,
          sensor_id: a.def.sensor_id,
          type: "howl",
          intensity: round1(a.intensity * 100) / 100,
          ghost_energy: db,
          timestamp,
          echo: false,
          message: `Varulvsylande vid ${a.def.name} – ${db} dB, ${a.peak} Hz${nearest ? ` (${nearest.def.name} reagerar)` : ""}`,
        });
      }
      const howling = a.howlTicks > 0;
      const envelope = howling ? a.howlTicks / a.howlTotal : 0;
      // night-time park ≈ 35 dB, plus wind noise in the microphone
      const base = 33 + env.wind * 1.3 + this.gaussian() * 1.8;
      const level = clamp(base + (howling ? (28 + 20 * a.intensity) * (0.6 + 0.4 * envelope) : 0), 20, 100);
      return {
        sensor_id: a.def.sensor_id,
        position: a.def.position ?? [0, 0, 0],
        level_db: round1(level),
        howl: howling,
        howl_intensity: howling ? round1(a.intensity * envelope * 100) / 100 : 0,
        peak_hz: howling ? a.peak : null,
        timestamp,
      };
    });
  }

  // ── street movement ──────────────────────────────────────────────────────

  private route(from: SensorState, to: SensorState): StreetPath | null {
    const key = `${from.def.sensor_id}>${to.def.sensor_id}`;
    if (!this.routeCache.has(key)) {
      const ids = this.streets && from.node >= 0 && to.node >= 0 ? shortestPath(this.streets, from.node, to.node) : null;
      this.routeCache.set(key, ids && ids.length > 1 ? toStreetPath(this.streets!, ids) : null);
    }
    return this.routeCache.get(key)!;
  }

  private nextWispName() {
    return `Irrbloss ${++this.wispCounter}`;
  }

  private spawnWanderer(now: number) {
    const g = this.streets!;
    const start = Math.floor(this.rng() * g.nodes.length);
    const ids = randomWalk(g, start, 140 + this.rng() * 120, this.rng);
    if (ids.length < 2) return;
    this.wisps.push({
      id: `wisp-${this.wispCounter + 1}`,
      kind: "wisp",
      name: this.nextWispName(),
      path: toStreetPath(g, ids),
      speed: 1.2 + this.rng() * 1.0,
      startedAt: now,
      intensity: 0.25 + this.rng() * 0.25,
      travelled: 0,
      passed: new Set(),
    });
  }

  /** A sensor event releases a wisp that heads for another sensor – hotter ones attract more. */
  private releaseWisp(from: SensorState, now: number): GhostEvent | null {
    if (this.wisps.length >= MAX_WISPS) return null;
    const others = this.sensors.filter((s) => s !== from && s.node >= 0);
    if (others.length === 0 || from.node < 0) return null;
    const weights = others.map((s) => Math.max(5, s.energy) ** 2);
    let r = this.rng() * weights.reduce((a, b) => a + b, 0);
    let target = others[0];
    for (let i = 0; i < others.length; i++) { r -= weights[i]; if (r <= 0) { target = others[i]; break; } }
    const path = this.route(from, target);
    if (!path) return null;
    const intensity = from.event ? from.event.intensity : 0.6;
    const wisp: WispState = {
      id: `wisp-${this.wispCounter + 1}`,
      kind: "wisp",
      name: this.nextWispName(),
      path,
      speed: 1.4 + this.rng() * 1.6,
      startedAt: now,
      intensity,
      from_sensor: from.def.sensor_id,
      target_sensor: target.def.sensor_id,
      travelled: 0,
      passed: new Set([from.def.sensor_id]),
    };
    this.wisps.push(wisp);
    const street = path.streets.find((n) => !GENERIC_STREET.test(n));
    return this.wispEvent(from, intensity, `${wisp.name} lämnar ${from.def.name}${street ? ` längs ${street}` : ""} mot ${target.def.name}`);
  }

  private moveWisps(now: number): GhostEvent[] {
    const events: GhostEvent[] = [];
    const remaining: WispState[] = [];
    for (const w of this.wisps) {
      const dist = Math.min(w.path.total, ((now - w.startedAt) / 1000) * w.speed);
      // check the stretch covered since last tick, every 2 units
      for (let d = w.travelled; d <= dist; d += 2) {
        const p = pointAt(w.path, d);
        for (const s of this.sensors) {
          const sp = s.def.position;
          if (!sp || w.passed.has(s.def.sensor_id) || s.def.sensor_id === w.target_sensor) continue;
          if (Math.hypot(sp[0] - p.x, sp[2] - p.z) < PASS_RADIUS) {
            w.passed.add(s.def.sensor_id);
            s.visit += 14 * w.intensity;
            events.push(this.wispEvent(s, w.intensity, `${w.name} passerade ${s.def.name}`));
          }
        }
      }
      w.travelled = dist;
      if (dist >= w.path.total) {
        const target = this.sensors.find((s) => s.def.sensor_id === w.target_sensor);
        if (target) {
          target.visit += 24 * w.intensity;
          events.push(this.wispEvent(target, w.intensity, `${w.name} nådde ${target.def.name} – energin stiger`));
        }
      } else {
        remaining.push(w);
      }
    }
    this.wisps = remaining;
    return events;
  }

  /** Energy flows between the hottest sensor pairs, from hot to cold. */
  private computeFlows(): GhostFlow[] {
    const pairs: Array<{ a: SensorState; b: SensorState; avg: number }> = [];
    for (let i = 0; i < this.sensors.length; i++) {
      for (let j = i + 1; j < this.sensors.length; j++) {
        const a = this.sensors[i], b = this.sensors[j];
        pairs.push({ a, b, avg: (a.energy + b.energy) / 2 });
      }
    }
    pairs.sort((x, y) => y.avg - x.avg);
    const flows: GhostFlow[] = [];
    for (const { a, b, avg } of pairs.slice(0, FLOW_COUNT)) {
      const [from, to] = a.energy >= b.energy ? [a, b] : [b, a];
      const path = this.route(from, to);
      if (!path) continue;
      flows.push({
        id: `${from.def.sensor_id}>${to.def.sensor_id}`,
        from_sensor: from.def.sensor_id,
        to_sensor: to.def.sensor_id,
        path,
        intensity: round1(clamp((avg - 20) / 70, 0.1, 1) * 100) / 100,
      });
    }
    return flows;
  }

  private wispEvent(s: SensorState, intensity: number, message: string): GhostEvent {
    return {
      id: `evt-${++this.eventCounter}`,
      sensor_id: s.def.sensor_id,
      type: "wisp",
      intensity: round1(intensity * 100) / 100,
      ghost_energy: round1(s.energy),
      timestamp: this.now(),
      echo: false,
      message,
    };
  }

  private logEvent(s: SensorState, echo: boolean): GhostEvent {
    const spec = SPEC_BY_TYPE[s.event!.type];
    return {
      id: `evt-${++this.eventCounter}`,
      sensor_id: s.def.sensor_id,
      type: s.event!.type,
      intensity: round1(s.event!.intensity * 100) / 100,
      ghost_energy: round1(clamp(s.def.baseline + spec.boost * s.event!.intensity, 0, 100)),
      timestamp: this.now(),
      echo,
    };
  }
}

/** Activity label when no specific event is running. */
export function backgroundActivity(energy: number): string {
  if (energy >= 75) return "intense_spectral";
  if (energy >= 55) return "cold_spots";
  if (energy >= 30) return "emf_fluctuation";
  return "background_noise";
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
