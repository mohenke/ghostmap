// On-screen joystick for walking on touch screens. Push to walk, push all the way to run.
import { css } from "@emotion/react";
import { useRef, useState } from "react";
import { useWalkStore } from "./walkStore.ts";

const SIZE = 110;
const KNOB = 46;

export function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number) => {
    const r = base.current!.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const max = (SIZE - KNOB) / 2;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    setKnob({ x: dx, y: dy });
    useWalkStore.getState().setJoystick(dx / max, -dy / max); // up on screen = forward
  };
  const release = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    useWalkStore.getState().setJoystick(0, 0);
  };

  return (
    <div
      ref={base}
      aria-label="Styrspak: dra för att gå"
      onPointerDown={(e) => { pointer.current = e.pointerId; (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (e.pointerId === pointer.current) update(e.clientX, e.clientY); }}
      onPointerUp={release}
      onPointerCancel={release}
      css={css({
        position: "absolute", left: 16, bottom: 96, width: SIZE, height: SIZE, borderRadius: "50%", zIndex: 1500,
        background: "radial-gradient(circle, rgba(34,211,238,0.12), rgba(7,8,20,0.55))", border: "1px solid rgba(34,211,238,0.45)",
        touchAction: "none", userSelect: "none",
      })}
    >
      <div
        css={css({
          position: "absolute", left: "50%", top: "50%", width: KNOB, height: KNOB, borderRadius: "50%", pointerEvents: "none",
          background: "rgba(34,211,238,0.45)", border: "1px solid rgba(165,243,252,0.9)", boxShadow: "0 0 14px rgba(34,211,238,0.5)",
        })}
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}
