// ── GHOST PULSE – shared data types ────────────────────────────────────────
//
// These types describe the (fictional) sensor network. They are deliberately
// independent of React and Three.js so that the simulated data source can be
// swapped for a real API (sensors, traffic, weather …) without touching the UI.

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type GhostEventType =
  | "temperature_drop"
  | "ectoplasm"
  | "shadow_movement"
  | "whispers"
  | "full_manifestation"
  /** A wandering wisp started, passed or reached a sensor (see `message`). */
  | "wisp"
  /** The acoustic sensor picked up a werewolf howl. */
  | "howl";

/** Scene position in Three.js units: [x, y, z] (Y is up). */
export type Vec3 = [number, number, number];

/** Static description of a sensor – where it is and how "haunted" the spot is. */
export type SensorDefinition = {
  sensor_id: string;
  name: string;
  /** Short description of the spot, shown in the UI. */
  location: string;
  lat: number;
  lon: number;
  /** Baseline ghost energy (0–100). Some places are simply more haunted. */
  baseline: number;
  /** Resolved scene position – filled in once the 3D scene exists. */
  position?: Vec3;
  /** Terrain height under the sensor (scene units). */
  ground?: number;
  /** Extra baseline from real history nearby (Wikipedia places within ~130 m). */
  history_boost?: number;
  history_nearby?: string[];
};

/** One measurement from one sensor. Field names follow the project spec. */
export type SensorReading = {
  sensor_id: string;
  position: Vec3;
  ghost_energy: number;
  /** Simulated temperature drop in °C relative to the surroundings. */
  temperature_drop: number;
  spectral_activity: string;
  risk_level: RiskLevel;
  /** Active paranormal event at this sensor, if any. */
  active_event: GhostEventType | null;
  timestamp: number;
};

/** A paranormal event as written to the event log. */
export type GhostEvent = {
  id: string;
  sensor_id: string;
  type: GhostEventType;
  /** 0–1, how strong the event is. */
  intensity: number;
  ghost_energy: number;
  timestamp: number;
  /** True when the event is an "echo" that spread from a neighbouring sensor. */
  echo: boolean;
  /** Free text for movement events, e.g. "Irrbloss 3 rör sig längs Haga Nygata mot Feskekôrka". */
  message?: string;
};

/** A route along real streets (world x/z), with cumulative lengths. */
export type StreetPath = {
  points: Array<[number, number]>;
  lengths: number[];
  total: number;
  /** Street names passed, in order (consecutive duplicates removed). */
  streets: string[];
};

/**
 * Something moving through the street network. Like live vehicle data, the
 * source sends the route, start time and speed; clients animate in between.
 */
export type GhostEntity = {
  id: string;
  kind: "wisp";
  name: string;
  path: StreetPath;
  /** scene units per second */
  speed: number;
  startedAt: number;
  /** 0–1 */
  intensity: number;
  from_sensor?: string;
  target_sensor?: string;
};

/** Energy streaming along the streets between two sensors (hot → cold). */
export type GhostFlow = {
  id: string;
  from_sensor: string;
  to_sensor: string;
  path: StreetPath;
  /** 0–1 */
  intensity: number;
};

export type GhostBatch = {
  readings: SensorReading[];
  /** Events that started during this tick. */
  events: GhostEvent[];
  /** Wisps currently moving (empty when no street network is available). */
  entities?: GhostEntity[];
  /** Active energy flows between sensors. */
  flows?: GhostFlow[];
  /** Acoustic (sound) sensor readings. */
  acoustic?: AcousticReading[];
};

/** A (fictional) acoustic sensor listening for werewolf howls. */
export type AcousticReading = {
  sensor_id: string;
  position: Vec3;
  /** Sound level in dB(A). */
  level_db: number;
  howl: boolean;
  /** 0–1 while howling */
  howl_intensity: number;
  /** Dominant frequency while howling, Hz */
  peak_hz: number | null;
  timestamp: number;
};

/** Extra context a source may use – the simulator moves ghosts along these streets. */
export type GhostContext = {
  streets?: import("./streetGraph.ts").StreetGraph;
  /** Extra energy added to every sensor each tick, e.g. from the real moon phase. */
  ambient?: () => number;
  /** Acoustic sensors to simulate. */
  acoustic?: SensorDefinition[];
  /** Real-world conditions that steer the simulation: moon illumination 0–1, wind m/s. */
  environment?: () => { moon: number; wind: number };
};

/**
 * Anything that can feed the map with sensor data.
 * The simulator implements this today; a real API client can implement it later.
 */
export interface GhostDataSource {
  start(sensors: SensorDefinition[], context?: GhostContext): void;
  stop(): void;
  subscribe(listener: (batch: GhostBatch) => void): () => void;
  /** Milliseconds between batches (used for the "next update" countdown). */
  readonly intervalMs: number;
}
