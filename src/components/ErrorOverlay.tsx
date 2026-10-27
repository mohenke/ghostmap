// Makes runtime errors visible on the page itself – useful when the demo runs
// on another machine and nobody has the developer tools open.
import { Component, useEffect, useState, type ReactNode } from "react";

const boxStyle: React.CSSProperties = {
  position: "fixed",
  left: "1rem",
  bottom: "2.6rem",
  maxWidth: "min(560px, calc(100vw - 2rem))",
  zIndex: 100000,
  background: "rgba(40, 6, 16, 0.94)",
  border: "1px solid #f43f5e",
  borderRadius: "10px",
  color: "#ffe4e6",
  font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
  padding: "10px 12px",
  boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
  userSelect: "text",
};

/** Lists uncaught errors and promise rejections in a small box. */
export function ErrorOverlay() {
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    const add = (msg: string) => setErrors((e) => [...e.slice(-4), msg]);
    const onError = (e: ErrorEvent) => add(e.message || String(e.error));
    const onRejection = (e: PromiseRejectionEvent) => add("Promise: " + (e.reason?.message ?? String(e.reason)));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  if (errors.length === 0) return null;
  return (
    <div style={boxStyle} role="alert">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", fontWeight: 700, marginBottom: 4 }}>
        <span>Ett fel uppstod i webbläsaren</span>
        <button onClick={() => setErrors([])} style={{ background: "none", border: "none", color: "#ffe4e6", cursor: "pointer" }} aria-label="Stäng">
          ×
        </button>
      </div>
      {errors.map((e, i) => (
        <div key={i} style={{ wordBreak: "break-word" }}>• {e}</div>
      ))}
    </div>
  );
}

/** Catches render errors so the page shows a message instead of going blank. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ ...boxStyle, left: "50%", bottom: "auto", top: "30%", transform: "translateX(-50%)" }} role="alert">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>GHOST PULSE kunde inte visas</div>
        <div style={{ wordBreak: "break-word", marginBottom: 8 }}>{this.state.error.message}</div>
        <button onClick={() => location.reload()} style={{ padding: "4px 10px", cursor: "pointer" }}>
          Ladda om
        </button>
      </div>
    );
  }
}
