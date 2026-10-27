// Street-level HUD: street name, compass, controls help and the exit button.
import { css } from "@emotion/react";
import { useWalkStore } from "./walkStore.ts";

const COMPASS = ["N", "NO", "O", "SO", "S", "SV", "V", "NV"];

export function WalkHud({ ghostMode }: { ghostMode: boolean }) {
  const mode = useWalkStore((s) => s.mode);
  const street = useWalkStore((s) => s.street);
  const heading = useWalkStore((s) => s.heading);
  if (mode !== "walk") return null;
  const dir = COMPASS[Math.round(heading / 45) % 8];
  const dark = ghostMode;

  return (
    <div
      css={css({
        position: "absolute",
        left: "50%",
        bottom: "2.8rem",
        transform: "translateX(-50%)",
        zIndex: 1400,
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "10px 16px",
        borderRadius: "14px",
        background: dark ? "rgba(7, 8, 20, 0.82)" : "rgba(255, 255, 255, 0.85)",
        border: `1px solid ${dark ? "rgba(139, 92, 246, 0.35)" : "rgba(0,0,0,0.1)"}`,
        color: dark ? "#e5e7ff" : "#1f2937",
        backdropFilter: "blur(10px)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
        maxWidth: "calc(100vw - 2rem)",
      })}
    >
      <div css={css({ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 46 })}>
        <div
          css={css({ width: 34, height: 34, borderRadius: "50%", border: `1px solid ${dark ? "#6d7cff" : "#9ca3af"}`, position: "relative" })}
          title={`Riktning ${Math.round(heading)}°`}
        >
          <div
            css={css({
              position: "absolute", left: "50%", top: "50%", width: 2, height: 14, background: "#f43f5e",
              transformOrigin: "50% 100%", transform: `translate(-50%, -100%) rotate(${-heading}deg)`, borderRadius: 2,
            })}
          />
          <span css={css({ position: "absolute", top: -2, left: "50%", transform: `translateX(-50%) rotate(0deg)`, fontSize: 8, opacity: 0.7 })}>N</span>
        </div>
        <span css={css({ fontSize: 10, marginTop: 2, opacity: 0.8 })}>{dir}</span>
      </div>
      <div>
        <div css={css({ fontSize: 10, letterSpacing: "0.12em", opacity: 0.6, textTransform: "uppercase" })}>Du står på</div>
        <div css={css({ fontSize: 17, fontWeight: 700 })}>{street ?? "…"}</div>
        <div css={css({ fontSize: 11, opacity: 0.7, marginTop: 2 })}>
          WASD / pilar: gå · Shift: spring · Dra: titta · Klicka på marken: gå dit · Esc: lämna
        </div>
      </div>
      <button
        onClick={() => useWalkStore.getState().exit()}
        css={css({
          marginLeft: 6, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
          border: `1px solid ${dark ? "#a855f7" : "#7c3aed"}`, background: dark ? "rgba(168,85,247,0.2)" : "#7c3aed", color: "#fff",
        })}
      >
        ⬆ Lämna gatan
      </button>
    </div>
  );
}
