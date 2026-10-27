// ── GHOST PULSE – monitoring side panel ────────────────────────────────────
import { css, keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import { useWalkStore } from "@/walk/walkStore";
import { useOpenData, type OpenDataLayers } from "@/opendata/openDataStore";
import { LevelWave, levelStatus } from "./SoundSensor.tsx";
import { unlockAudio } from "./howlAudio.ts";
import { useGhostStore, type GhostLayers } from "./ghostStore.ts";
import { EVENT_ICON, EVENT_LABEL, RISK_COLOR, RISK_LABEL, activityLabel, energyColorCss, formatTime } from "./labels.ts";

const C = {
  bg: "rgba(7, 8, 20, 0.86)",
  card: "rgba(255, 255, 255, 0.035)",
  border: "rgba(139, 92, 246, 0.22)",
  text: "#eef0ff",
  muted: "#9ca3c7",
  faint: "#6b7099",
  purple: "#a855f7",
  cyan: "#22d3ee",
  orange: "#fb923c",
};
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const blink = keyframes`0%,100%{opacity:1}50%{opacity:.25}`;
const slideIn = keyframes`from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}`;

const sectionTitle = css({
  fontSize: "10px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: C.faint,
  margin: "0 0 8px",
  fontWeight: 600,
});

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 72;
  const h = 22;
  if (values.length < 2) return <svg width={w} height={h} />;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / 100) * (h - 2)).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={w} height={h} role="img" aria-label={`Energi senaste mätningarna, nu ${Math.round(last)}`}>
      <title>{`Senaste ${values.length} mätningar: ${values.map((v) => Math.round(v)).join(", ")}`}</title>
      <line x1="0" x2={w} y1={h - 1} y2={h - 1} stroke="rgba(255,255,255,0.08)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={h - 1 - (last / 100) * (h - 2)} r="2.2" fill={color} />
    </svg>
  );
}

function StatTile({ label, value, unit, sub, accent }: { label: string; value: string; unit?: string; sub: string; accent: string }) {
  return (
    <div css={css({ background: C.card, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "10px 10px 8px", borderTop: `2px solid ${accent}` })}>
      <div css={css({ fontSize: "10px", color: C.muted, lineHeight: 1.25, minHeight: "25px" })}>{label}</div>
      <div css={css({ fontFamily: mono, fontSize: "22px", fontWeight: 700, color: C.text, marginTop: "2px" })}>
        {value}
        {unit && <span css={css({ fontSize: "11px", color: C.faint, fontWeight: 400 })}>{unit}</span>}
      </div>
      <div css={css({ fontSize: "10px", color: C.faint })}>{sub}</div>
    </div>
  );
}

function useCountdown() {
  const lastUpdate = useGhostStore((s) => s.lastUpdate);
  const intervalMs = useGhostStore((s) => s.intervalMs);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  if (!lastUpdate) return null;
  return Math.max(0, Math.ceil((lastUpdate + intervalMs - now) / 1000));
}

const REAL_LAYER_LABELS: Array<[keyof OpenDataLayers, string]> = [
  ["air", "Luftsensorer"],
  ["history", "Historia (Wikipedia)"],
  ["ectoplasm", "Ektoplasma (från luftdata)"],
  ["moon", "Månen"],
];

const LAYER_LABELS: Array<[keyof GhostLayers, string]> = [
  ["model", "Blender-modell"],
  ["flows", "Spökflöden"],
  ["wisps", "Irrbloss"],
  ["phantoms", "Gastar (dekor)"],
  ["sensors", "Sensorer"],
  ["fields", "Energifält"],
  ["beams", "Ljuspelare"],
  ["labels", "Etiketter"],
  ["fog", "Dimma"],
];

export function GhostPanel() {
  const sensors = useGhostStore((s) => s.sensors);
  const readings = useGhostStore((s) => s.readings);
  const history = useGhostStore((s) => s.history);
  const events = useGhostStore((s) => s.events);
  const selectedId = useGhostStore((s) => s.selectedId);
  const select = useGhostStore((s) => s.select);
  const layers = useGhostStore((s) => s.layers);
  const toggleLayer = useGhostStore((s) => s.toggleLayer);
  const modelUrl = useGhostStore((s) => s.modelUrl);
  const entities = useGhostStore((s) => s.entities);
  const flows = useGhostStore((s) => s.flows);
  const realLayers = useOpenData((s) => s.layers);
  const acousticSensors = useGhostStore((s) => s.acousticSensors);
  const acoustic = useGhostStore((s) => s.acoustic);
  const acousticHistory = useGhostStore((s) => s.acousticHistory);
  const howlCount = useGhostStore((s) => s.howlCount);
  const sound = useGhostStore((s) => s.sound);
  const setSound = useGhostStore((s) => s.setSound);
  const selectAcoustic = useGhostStore((s) => s.selectAcoustic);
  const toggleReal = useOpenData((s) => s.toggleLayer);
  const [collapsed, setCollapsed] = useState(false);
  const walkMode = useWalkStore((s) => s.mode);
  // Make room for the street view: fold the panel while walking, unfold afterwards.
  useEffect(() => {
    if (walkMode === "walk") setCollapsed(true);
    if (walkMode === "orbit") setCollapsed(false);
  }, [walkMode]);
  const countdown = useCountdown();

  const list = sensors.map((d) => ({ def: d, r: readings[d.sensor_id] }));
  const live = list.filter((x) => x.r);
  const total = live.reduce((s, x) => s + x.r!.ghost_energy, 0);
  const avg = live.length ? total / live.length : 0;
  const anomalies = live.filter((x) => x.r!.active_event).length;
  const critical = live.filter((x) => x.r!.risk_level === "critical").length;
  const nameOf = (id: string) => sensors.find((s) => s.sensor_id === id)?.name ?? id;

  return (
    <aside
      css={css({
        position: "absolute",
        top: "3.6rem",
        right: "0.75rem",
        bottom: "2.4rem",
        width: collapsed ? "auto" : "380px",
        maxWidth: "calc(100vw - 1.5rem)",
        zIndex: 1000,
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: "14px",
        color: C.text,
        backdropFilter: "blur(14px)",
        boxShadow: "0 0 40px rgba(88, 28, 235, 0.18)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        userSelect: "text",
        height: collapsed ? "fit-content" : undefined,
        "@media (max-width: 768px)": {
          top: "auto",
          left: "0.5rem",
          right: "0.5rem",
          width: "auto",
          height: collapsed ? "fit-content" : "46vh",
        },
      })}
    >
      {/* Header */}
      <div css={css({ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}` })}>
        <div css={css({ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" })}>
          <div>
            <div css={css({ fontSize: "18px", fontWeight: 800, letterSpacing: "0.18em", background: `linear-gradient(90deg, ${C.cyan}, ${C.purple})`, WebkitBackgroundClip: "text", color: "transparent" })}>
              GHOST PULSE
            </div>
            <div css={css({ fontSize: "11px", color: C.muted, letterSpacing: "0.04em" })}>Paranormal Activity Monitoring System</div>
          </div>
          <div css={css({ display: "flex", gap: 6 })}>
          <button
            onClick={() => { if (!sound) unlockAudio(); setSound(!sound); }}
            title={sound ? "Stäng av ljud" : "Slå på ljud (varulvsylanden)"}
            aria-pressed={sound}
            css={css({ background: sound ? "rgba(251,146,60,0.18)" : "none", border: `1px solid ${sound ? "#fb923c" : C.border}`, color: sound ? "#ffedd5" : C.muted, borderRadius: "6px", cursor: "pointer", padding: "4px 8px", fontSize: "11px" })}
          >
            {sound ? "🔊 Ljud på" : "🔇 Ljud"}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            css={css({ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px", cursor: "pointer", padding: "4px 8px", fontSize: "11px" })}
          >
            {collapsed ? "Visa" : "Dölj"}
          </button>
          </div>
        </div>
        {!collapsed && (
          <div css={css({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", fontSize: "11px" })}>
            <span css={css({ display: "flex", alignItems: "center", gap: "6px", color: C.cyan, fontFamily: mono })}>
              <span css={css({ width: 7, height: 7, borderRadius: "50%", background: C.cyan, boxShadow: `0 0 8px ${C.cyan}`, animation: `${blink} 1.4s infinite` })} />
              LIVE · ny mätning om {countdown ?? "–"} s
            </span>
            <span css={css({ color: C.orange, border: `1px solid ${C.orange}66`, borderRadius: "4px", padding: "1px 6px", fontSize: "10px", letterSpacing: "0.06em" })}>
              SIMULERADE DATA
            </span>
          </div>
        )}
      </div>

      {!collapsed && (
        <div css={css({ overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "18px", flex: 1 })}>
          {/* KPI tiles */}
          <div css={css({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" })}>
            <StatTile label="Total spökenergi" value={Math.round(total).toString()} unit={` /${sensors.length * 100}`} sub={`snitt ${avg.toFixed(0)} per sensor`} accent={C.purple} />
            <StatTile label="Aktiva sensorer" value={`${live.length}`} unit={` /${sensors.length}`} sub={live.length === sensors.length ? "alla rapporterar" : "ansluter…"} accent={C.cyan} />
            <StatTile label="Pågående anomalier" value={`${anomalies}`} sub={critical ? `${critical} kritisk${critical > 1 ? "a" : ""}` : "inga kritiska"} accent={C.orange} />
            <StatTile label="Irrbloss i rörelse" value={`${entities.length}`} sub={`${flows.length} spökflöden längs gatorna`} accent="#e879f9" />
          </div>

          {/* Sensor list */}
          <section>
            <h3 css={sectionTitle}>Sensorer</h3>
            <div css={css({ display: "flex", flexDirection: "column", gap: "6px" })}>
              {list.map(({ def, r }) => {
                const e = r?.ghost_energy ?? 0;
                const color = energyColorCss(e);
                const sel = selectedId === def.sensor_id;
                return (
                  <button
                    key={def.sensor_id}
                    onClick={() => select(sel ? null : def.sensor_id)}
                    css={css({
                      textAlign: "left",
                      background: sel ? "rgba(168, 85, 247, 0.14)" : C.card,
                      border: `1px solid ${sel ? C.purple : "transparent"}`,
                      borderRadius: "10px",
                      padding: "8px 10px",
                      cursor: "pointer",
                      color: C.text,
                      transition: "background .2s",
                      "&:hover": { background: "rgba(168, 85, 247, 0.1)" },
                    })}
                  >
                    <div css={css({ display: "flex", alignItems: "center", gap: "8px" })}>
                      <span css={css({ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0 })} />
                      <span css={css({ fontFamily: mono, fontSize: "11px", color: C.muted })}>{def.sensor_id}</span>
                      <span css={css({ fontSize: "13px", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{def.name}</span>
                      <Sparkline values={history[def.sensor_id] ?? []} color={color} />
                      <span css={css({ fontFamily: mono, fontSize: "15px", fontWeight: 700, width: "30px", textAlign: "right" })}>{r ? Math.round(e) : "–"}</span>
                    </div>
                    <div css={css({ height: "3px", borderRadius: "3px", background: "rgba(255,255,255,0.07)", margin: "6px 0 5px" })}>
                      <div css={css({ width: `${e}%`, height: "100%", borderRadius: "3px", background: color, transition: "width 1.2s ease, background 1.2s ease" })} />
                    </div>
                    <div css={css({ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: C.muted, gap: "8px" })}>
                      <span css={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                        {r?.active_event ? `${EVENT_ICON[r.active_event]} ` : ""}
                        {r ? activityLabel(r.spectral_activity) : "Väntar på data…"}
                      </span>
                      {r && (
                        <span css={css({ whiteSpace: "nowrap" })}>
                          <span css={css({ color: RISK_COLOR[r.risk_level] })}>●</span> {RISK_LABEL[r.risk_level]} · −{r.temperature_drop.toFixed(1)}°C
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Acoustic sensor */}
          {acousticSensors.map((def) => {
            const r = acoustic[def.sensor_id];
            const howl = !!r?.howl;
            return (
              <section key={def.sensor_id}>
                <h3 css={sectionTitle}>Ljudsensor · varulvsdetektor</h3>
                <button
                  onClick={() => selectAcoustic(def.sensor_id)}
                  css={css({
                    width: "100%", textAlign: "left", cursor: "pointer", color: C.text, borderRadius: "10px", padding: "8px 10px",
                    background: howl ? "rgba(251,146,60,0.14)" : C.card, border: `1px solid ${howl ? "#fb923c" : "transparent"}`,
                  })}
                >
                  <div css={css({ display: "flex", alignItems: "center", gap: 8 })}>
                    <span css={css({ fontFamily: mono, fontSize: "11px", color: C.muted })}>{def.sensor_id}</span>
                    <span css={css({ fontSize: "13px", fontWeight: 600, flex: 1 })}>{def.name}</span>
                    <span css={css({ fontFamily: mono, fontSize: "15px", fontWeight: 700 })}>{r ? Math.round(r.level_db) : "–"} <span css={css({ fontSize: 10, color: C.muted })}>dB</span></span>
                  </div>
                  <LevelWave values={acousticHistory[def.sensor_id] ?? []} width={326} height={34} color={howl ? "#fb923c" : "#22d3ee"} />
                  <div css={css({ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: C.muted })}>
                    <span css={css({ color: howl ? "#fb923c" : C.muted, fontWeight: howl ? 700 : 400 })}>{howl ? "🐺 " : ""}{r ? levelStatus(r.level_db, howl) : "Väntar på data…"}</span>
                    <span>{howlCount} ylanden registrerade</span>
                  </div>
                </button>
              </section>
            );
          })}

          {/* Event log */}
          <section>
            <h3 css={sectionTitle}>Händelselogg</h3>
            {events.length === 0 ? (
              <div css={css({ fontSize: "12px", color: C.faint })}>Inga paranormala händelser registrerade ännu…</div>
            ) : (
              <div css={css({ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11.5px" })}>
                {events.slice(0, 14).map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => select(ev.sensor_id)}
                    css={css({
                      display: "grid",
                      gridTemplateColumns: "58px 16px 1fr",
                      gap: "6px",
                      padding: "4px 6px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      animation: `${slideIn} .4s ease`,
                      borderLeft: `2px solid ${ev.type === "full_manifestation" ? RISK_COLOR.critical : ev.type === "wisp" ? "#e879f9" : ev.echo ? C.faint : C.purple}`,
                      "&:hover": { background: C.card },
                    })}
                  >
                    <span css={css({ fontFamily: mono, color: C.faint })}>{formatTime(ev.timestamp)}</span>
                    <span>{EVENT_ICON[ev.type]}</span>
                    {ev.message ? (
                      <span css={css({ color: C.text })}>{ev.message}</span>
                    ) : (
                      <span>
                        <span css={css({ color: C.text })}>{EVENT_LABEL[ev.type]}</span>
                        <span css={css({ color: C.muted })}> · {nameOf(ev.sensor_id)}</span>
                        {ev.echo && <span css={css({ color: C.faint })}> (eko)</span>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Layer toggles */}
          <section>
            <h3 css={sectionTitle}>Spöklager <span css={css({ color: C.orange, letterSpacing: 0 })}>· fiktiva</span></h3>
            <div css={css({ display: "flex", flexWrap: "wrap", gap: "6px" })}>
              {LAYER_LABELS.filter(([key]) => key !== "model" || modelUrl).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => toggleLayer(key)}
                  aria-pressed={layers[key]}
                  css={css({
                    fontSize: "11.5px",
                    padding: "5px 10px",
                    borderRadius: "999px",
                    cursor: "pointer",
                    border: `1px solid ${layers[key] ? C.cyan : C.border}`,
                    background: layers[key] ? "rgba(34, 211, 238, 0.12)" : "transparent",
                    color: layers[key] ? C.text : C.muted,
                  })}
                >
                  {layers[key] ? "✓ " : ""}
                  {label}
                </button>
              ))}
            </div>

            <h3 css={[sectionTitle, css({ marginTop: 14 })]}>Verkliga data <span css={css({ color: "#2dd4bf", letterSpacing: 0 })}>· öppna källor</span></h3>
            <div css={css({ display: "flex", flexWrap: "wrap", gap: "6px" })}>
              {REAL_LAYER_LABELS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => toggleReal(key)}
                  aria-pressed={realLayers[key]}
                  css={css({
                    fontSize: "11.5px", padding: "5px 10px", borderRadius: "999px", cursor: "pointer",
                    border: `1px solid ${realLayers[key] ? "#2dd4bf" : C.border}`,
                    background: realLayers[key] ? "rgba(45, 212, 191, 0.12)" : "transparent",
                    color: realLayers[key] ? C.text : C.muted,
                  })}
                >
                  {realLayers[key] ? "✓ " : ""}
                  {label}
                </button>
              ))}
            </div>
          </section>

          <div css={css({ fontSize: "10.5px", color: C.faint, lineHeight: 1.5, borderTop: `1px solid ${C.border}`, paddingTop: "10px" })}>
            Spökvärdena är <b css={css({ color: C.orange })}>simulerade och fiktiva</b> – genererade i webbläsaren var femte sekund. <b css={css({ color: "#2dd4bf" })}>Verkliga data:</b> byggnader och gator (OpenStreetMap), väder (SMHI), luftsensorer (Sensor.community), historia (Wikipedia) och månen (beräknad). Klicka på en sensor i kartan för detaljer. Dra för att rotera, högerklicka-dra för att panorera, scrolla för att zooma.
          </div>
        </div>
      )}
    </aside>
  );
}
