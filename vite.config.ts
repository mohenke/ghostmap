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
  // Same security headers as nginx.conf, so `npm run preview` tests the real policy.
  preview: {
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://upload.wikimedia.org https://*.wikimedia.org https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self' https://opendata-download-metfcst.smhi.se https://data.sensor.community https://sv.wikipedia.org https://s3.amazonaws.com https://overpass-api.de https://overpass.kumi.systems https://maps.mail.ru https://nominatim.openstreetmap.org; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  },
  resolve: {
    alias: [{ find: "@", replacement: "/src" }],
  },
});
