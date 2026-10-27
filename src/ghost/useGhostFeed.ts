import { useEffect, useMemo } from "react";
import { useAreaStore } from "@/state/areaStore";
import { useGhostStore } from "./ghostStore.ts";
import { placeAcousticSensors, placeSensors } from "./sensors.ts";
import { useWeatherStore } from "@/weather/weatherStore";
import { SimulatedGhostSource } from "./simulation.ts";
import type { GhostDataSource } from "./types.ts";
import { useStreetGraph } from "./useStreetGraph.ts";
import { useOpenData } from "@/opendata/openDataStore";
import { moonIllumination } from "@/opendata/moon";

/** The real moon adds up to +5 energy at full moon. */
export const moonBoost = () => moonIllumination(new Date()) * 5;

/**
 * The single place where the data source is chosen.
 * To use a real API later: implement GhostDataSource (e.g. polling fetch or a
 * WebSocket) and return it here instead of the simulator.
 */
export function createDataSource(): GhostDataSource {
  return new SimulatedGhostSource({ intervalMs: 5000 });
}

/** Places sensors in the current scene and streams readings into the ghost store while Ghost Mode is on. */
export function useGhostFeed() {
  const ghostMode = useGhostStore((s) => s.ghostMode);
  const projection = useAreaStore((s) => s.projection);
  const areas = useAreaStore((s) => s.areas);
  const terrain = useAreaStore((s) => s.terrain);
  const streets = useStreetGraph();
  const history = useOpenData((s) => s.history);

  const sensors = useMemo(
    () => (projection ? placeSensors(projection, areas, terrain, history) : []),
    [projection, areas, terrain, history]
  );

  const acoustic = useMemo(() => (projection ? placeAcousticSensors(projection, terrain) : []), [projection, terrain]);

  useEffect(() => {
    const { setSensors, setAcousticSensors, reset } = useGhostStore.getState();
    setSensors(sensors);
    setAcousticSensors(acoustic);
    reset();
  }, [sensors, acoustic]);

  useEffect(() => {
    if (!ghostMode || sensors.length === 0) return;
    const { ingest, setIntervalMs } = useGhostStore.getState();
    const source = createDataSource();
    setIntervalMs(source.intervalMs);
    const unsubscribe = source.subscribe(ingest);
    source.start(sensors, {
      streets: streets ?? undefined,
      ambient: moonBoost,
      acoustic,
      // real moon phase and real wind steer the werewolf detector
      environment: () => ({ moon: moonIllumination(new Date()), wind: useWeatherStore.getState().weather.windSpeed }),
    });
    return () => {
      unsubscribe();
      source.stop();
    };
  }, [ghostMode, sensors, streets, acoustic]);
}
