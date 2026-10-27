import { create } from "zustand";
import type { AcousticReading, GhostBatch, GhostEntity, GhostEvent, GhostFlow, SensorDefinition, SensorReading } from "./types.ts";

export type GhostLayers = {
  model: boolean;
  flows: boolean;
  wisps: boolean;
  phantoms: boolean;
  sensors: boolean;
  fields: boolean;
  beams: boolean;
  labels: boolean;
  fog: boolean;
};

const HISTORY_LENGTH = 36;
const MAX_EVENTS = 60;

type GhostStore = {
  ghostMode: boolean;
  sensors: SensorDefinition[];
  readings: Record<string, SensorReading>;
  /** Recent energy values per sensor, oldest first (for sparklines). */
  history: Record<string, number[]>;
  events: GhostEvent[];
  /** Wisps moving along the streets right now. */
  entities: GhostEntity[];
  /** Energy flows between sensors. */
  flows: GhostFlow[];
  selectedEntityId: string | null;
  /** Acoustic sensors (werewolf detector) */
  acousticSensors: SensorDefinition[];
  acoustic: Record<string, AcousticReading>;
  acousticHistory: Record<string, number[]>;
  howlCount: number;
  lastHowl: number | null;
  selectedAcousticId: string | null;
  /** Play synthesized sounds (off by default; needs a click to start audio). */
  sound: boolean;
  lastUpdate: number;
  intervalMs: number;
  selectedId: string | null;
  layers: GhostLayers;
  /** City model enhanced in Blender, if one exists for the current area. */
  modelUrl: string | null;
  modelStatus: "idle" | "loaded" | "failed";

  setGhostMode: (on: boolean) => void;
  setSensors: (sensors: SensorDefinition[]) => void;
  setIntervalMs: (ms: number) => void;
  ingest: (batch: GhostBatch) => void;
  select: (id: string | null) => void;
  selectEntity: (id: string | null) => void;
  setAcousticSensors: (s: SensorDefinition[]) => void;
  selectAcoustic: (id: string | null) => void;
  setSound: (on: boolean) => void;
  toggleLayer: (key: keyof GhostLayers) => void;
  reset: () => void;
  setModelUrl: (url: string | null) => void;
  setModelStatus: (status: "idle" | "loaded" | "failed") => void;
};

export const useGhostStore = create<GhostStore>((set) => ({
  ghostMode: false,
  sensors: [],
  readings: {},
  history: {},
  events: [],
  entities: [],
  flows: [],
  selectedEntityId: null,
  acousticSensors: [],
  acoustic: {},
  acousticHistory: {},
  howlCount: 0,
  lastHowl: null,
  selectedAcousticId: null,
  sound: false,
  lastUpdate: 0,
  intervalMs: 5000,
  selectedId: null,
  modelUrl: null,
  modelStatus: "idle",
  layers: { model: true, flows: true, wisps: true, phantoms: true, sensors: true, fields: true, beams: true, labels: true, fog: true },

  setGhostMode: (ghostMode) => {
    document.body.dataset.ghost = String(ghostMode);
    set({ ghostMode, selectedId: null });
  },
  setSensors: (sensors) => set({ sensors }),
  setIntervalMs: (intervalMs) => set({ intervalMs }),
  ingest: ({ readings, events, entities = [], flows = [], acoustic = [] }) =>
    set((s) => {
      const nextReadings = { ...s.readings };
      const nextHistory = { ...s.history };
      for (const r of readings) {
        nextReadings[r.sensor_id] = r;
        nextHistory[r.sensor_id] = [...(nextHistory[r.sensor_id] ?? []), r.ghost_energy].slice(-HISTORY_LENGTH);
      }
      return {
        readings: nextReadings,
        history: nextHistory,
        events: [...events.slice().reverse(), ...s.events].slice(0, MAX_EVENTS),
        lastUpdate: readings[0]?.timestamp ?? Date.now(),
        entities,
        flows,
        acoustic: Object.fromEntries(acoustic.map((a) => [a.sensor_id, a])),
        acousticHistory: Object.fromEntries(
          acoustic.map((a) => [a.sensor_id, [...(s.acousticHistory[a.sensor_id] ?? []), a.level_db].slice(-48)])
        ),
        howlCount: s.howlCount + events.filter((e) => e.type === "howl").length,
        lastHowl: events.find((e) => e.type === "howl")?.timestamp ?? s.lastHowl,
        selectedEntityId: entities.some((e) => e.id === s.selectedEntityId) ? s.selectedEntityId : null,
      };
    }),
  select: (selectedId) => set({ selectedId }),
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
  setAcousticSensors: (acousticSensors) => set({ acousticSensors }),
  selectAcoustic: (selectedAcousticId) => set({ selectedAcousticId }),
  setSound: (sound) => set({ sound }),
  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  setModelUrl: (modelUrl) => set({ modelUrl, modelStatus: "idle" }),
  setModelStatus: (modelStatus) => set({ modelStatus }),
  reset: () => set({ readings: {}, history: {}, events: [], entities: [], flows: [], acoustic: {}, acousticHistory: {}, howlCount: 0, lastHowl: null, selectedId: null, selectedEntityId: null, lastUpdate: 0 }),
}));
