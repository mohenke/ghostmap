// Orbit camera for the overview. It stays mounted but is disabled while walking,
// so it remembers where the overview camera was looking.
import { OrbitControls } from "@react-three/drei";
import { useWalkStore } from "@/walk/walkStore";

export function CameraControls() {
  const mode = useWalkStore((s) => s.mode);
  return (
    <OrbitControls
      makeDefault
      enabled={mode === "orbit"}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={6}
      maxDistance={1200}
    />
  );
}
