import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./ui/App.tsx";
import { AppErrorBoundary, ErrorOverlay } from "./components/ErrorOverlay.tsx";

createRoot(document.getElementById("root")!).render(
  <>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ErrorOverlay />
  </>
);
