// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [ // file statici da public/
        "favicon.svg",
        "apple-touch-icon.png"
      ],
      manifest: {
        name: "AceTV Pair",
        short_name: "AceTV",
        description: "Cerca stream e invia i comandi alla tua TV",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          // crea questi PNG (almeno 192/512 e una maskable)
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // caching di base per HTML/CSS/JS + chiamate API
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/acestream"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-acestream",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 30, maxAgeSeconds: 3600 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      "/acestream": { target: "http://192.168.1.15:5000", changeOrigin: true, secure: false },
      "^/tv($|/)": { target: "http://192.168.1.15:5000", changeOrigin: true, secure: false },
      "/auth": { target: "http://192.168.1.15:5000", changeOrigin: true, secure: false },
    },
  },
});
