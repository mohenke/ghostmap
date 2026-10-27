import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      jsxImportSource: "@emotion/react",
      babel: {
        // autoLabel "never": class names stay neutral (e.g. no "-TopNav" suffix),
        // so ad-blocker cosmetic filters don't hide the navigation bar.
        plugins: [["@emotion/babel-plugin", { autoLabel: "never" }]],
      },
    }),
  ],
  resolve: {
    alias: [{ find: "@", replacement: "/src" }],
  },
});
