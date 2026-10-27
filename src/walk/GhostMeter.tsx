// Handheld ghost meter (a nod to the Ghostbusters PKE meter), shown while walking
// in Ghost Mode. It reads the simulated energy where you stand: nearby sensors,
// passing wisps and energy flows in the street.
import { css, keyframes } from "@emotion/react";
import { energyColorCss } from "@/ghost/labels";
import { useWalkStore } from "./walkStore.ts";

const shake = keyframes`0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}75%{transform:translateX(1px)}`;
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

function status(v: number) {
  if (v >= 88) return "KRITISKT";
  if (v >= 70) return "Nära!";
  if (v >= 45) return "Aktivitet";
  if (v >= 20) return "Svag aktivitet";
  return "Lugnt";
}

/** Point on the gauge arc for value 0–100 (left → right over the top). */
function arcPoint(v: number, r: number) {
  const a = Math.PI - (v / 100) * Math.PI;
  return [60 + Math.cos(a) * r, 62 - Math.sin(a) * r];
}

export function GhostMeter() {
  const mode = useWalkStore((s) => s.mode);
  const { value, nearestWispM } = useWalkStore((s) => s.meter);
  if (mode !== "walk") return null;

  const color = energyColorCss(value);
  const angle = -90 + (value / 100) * 180;
  const segments = [0, 20, 45, 70, 88, 100];
  const segColors = ["#22d3ee", "#818cf8", "#a855f7", "#fb923c", "#f43f5e"];
  const leds = 12;
  const lit = Math.round((value / 100) * leds);
  const near = nearestWispM !== null && nearestWispM < 50;
  const vignette = nearestWispM === null ? 0 : Math.max(0, 1 - nearestWispM / 45);

  return (
    <>
      {/* cold blue edge when a wisp is close */}
      <div
        css={css({
          position: "absolute", inset: 0, zIndex: 900, pointerEvents: "none",
          background: "radial-gradient(ellipse at center, transparent 55%, rgba(34, 211, 238, 0.55) 100%)",
          opacity: vignette * 0.9, transition: "opacity .4s ease",
        })}
      />
      <div
        css={css({
          position: "absolute", left: "1rem", bottom: "2.8rem", zIndex: 1400, width: 210, padding: "10px 12px 12px",
          // phones: smaller, top-left (the joystick and street bar use the bottom)
          "@media (max-width: 768px)": { left: 8, top: "4.9rem", bottom: "auto", zoom: 0.72 },
          borderRadius: 14, background: "linear-gradient(160deg, rgba(30,30,40,0.95), rgba(10,10,18,0.95))",
          border: "1px solid rgba(250, 204, 21, 0.35)", color: "#f3f4f6", boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
          animation: value >= 70 ? `${shake} .12s linear infinite` : "none",
        })}
      >
        <div css={css({ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: "0.14em", color: "#facc15" })}>
          <span>SPÖKMÄTARE</span>
          <span css={css({ fontFamily: mono })}>PKE-3</span>
        </div>
        <svg viewBox="0 0 120 70" width="186" height="108" role="img" aria-label={`Spökenergi här: ${Math.round(value)} av 100`}>
          {segments.slice(0, -1).map((s, i) => {
            const [x1, y1] = arcPoint(s, 48);
            const [x2, y2] = arcPoint(segments[i + 1], 48);
            return <path key={i} d={`M ${x1} ${y1} A 48 48 0 0 1 ${x2} ${y2}`} stroke={segColors[i]} strokeWidth="7" fill="none" opacity={value >= s ? 1 : 0.25} />;
          })}
          {[0, 25, 50, 75, 100].map((t) => {
            const [x1, y1] = arcPoint(t, 40);
            const [x2, y2] = arcPoint(t, 44);
            return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9ca3af" strokeWidth="1" />;
          })}
          <g transform={`rotate(${angle} 60 62)`} style={{ transition: "transform .12s linear" }}>
            <line x1="60" y1="62" x2="60" y2="20" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <circle cx="60" cy="62" r="4" fill="#e5e7eb" />
        </svg>
        <div css={css({ display: "flex", gap: 3, margin: "-4px 0 8px" })}>
          {Array.from({ length: leds }, (_, i) => (
            <div key={i} css={css({ flex: 1, height: 6, borderRadius: 2, background: i < lit ? segColors[Math.min(4, Math.floor((i / leds) * 5))] : "rgba(255,255,255,0.08)" })} />
          ))}
        </div>
        <div css={css({ display: "flex", justifyContent: "space-between", alignItems: "baseline" })}>
          <span css={css({ fontFamily: mono, fontSize: 26, fontWeight: 700 })}>{Math.round(value)}</span>
          <span css={css({ fontSize: 12, fontWeight: 700, color })}>{status(value)}</span>
        </div>
        <div css={css({ fontSize: 11, color: near ? "#a5f3fc" : "#9ca3af", marginTop: 2 })}>
          {nearestWispM === null ? "Inga irrbloss i närheten" : `Närmaste irrbloss: ${Math.round(nearestWispM)} m`}
        </div>
        <div css={css({ fontSize: 9, color: "#fb923c", marginTop: 4, letterSpacing: "0.05em" })}>SIMULERADE, FIKTIVA DATA</div>
      </div>
    </>
  );
}
