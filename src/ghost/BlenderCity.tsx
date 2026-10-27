// ── GHOST PULSE – city model enhanced in Blender ───────────────────────────
//
// Pipeline: Mapforge "Export GLB" → Blender (via MCP) → public/models/haga-ghost.glb
// The Blender file keeps Mapforge's coordinates, so the model lines up 1:1 with
// the procedural scene. Empties named SENSOR_<id> carry sensor positions.
import { Component, Suspense, useEffect, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useGhostStore } from "./ghostStore.ts";
import type { Vec3 } from "./types.ts";

const noRaycast = () => null;

// The model is Draco-compressed. Use the decoder bundled with Three.js
// (copied to public/draco) instead of drei's default CDN, so everything runs locally.
useGLTF.setDecoderPath("/draco/");

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const setModelStatus = useGhostStore((s) => s.setModelStatus);

  useEffect(() => {
    const positions: Record<string, Vec3> = {};
    scene.traverse((o) => {
      // The model is decoration only – clicks go to the Mapforge buildings and sensors.
      o.raycast = noRaycast;
      // Mapforge's export flag survives the Blender round trip as glTF extras –
      // drop it so "Export GLB" never includes this decoration model.
      delete o.userData.exportToGLB;
      const id = o.userData?.sensor_id;
      if (id) positions[id] = [o.position.x, o.position.y, o.position.z];
      if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        // Let strongly emissive parts (windows, lanterns, sensor rings) glow at full brightness.
        if (m.emissiveIntensity > 2) m.toneMapped = false;
      }
    });

    // Use the named sensor positions from Blender, and report any difference
    // from the positions computed in the browser.
    const { sensors, setSensors } = useGhostStore.getState();
    const diffs = sensors
      .filter((s) => positions[s.sensor_id])
      .map((s) => ({
        sensor: s.sensor_id,
        diff: +new THREE.Vector3(...s.position!).distanceTo(new THREE.Vector3(...positions[s.sensor_id])).toFixed(3),
      }));
    console.table(diffs);
    setSensors(sensors.map((s) => (positions[s.sensor_id] ? { ...s, position: positions[s.sensor_id] } : s)));
    setModelStatus("loaded");
  }, [scene, setModelStatus]);

  return <primitive object={scene} />;
}

class ModelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("Blender model could not be loaded – using the Mapforge geometry instead.", err);
    useGhostStore.getState().setModelStatus("failed");
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BlenderCity({ url }: { url: string }) {
  return (
    <ModelErrorBoundary>
      <Suspense fallback={null}>
        <Model url={url} />
      </Suspense>
    </ModelErrorBoundary>
  );
}
