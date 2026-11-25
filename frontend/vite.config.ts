import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const backend = "http://localhost:8000";

export default defineConfig({
  server: {
    proxy: {
      "/api": backend,
      "/auth": backend,
      "/healthz": backend,
      "/client": backend,
    },
  },
  build: {
    target: "es2022",
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Filmlog",
        short_name: "Filmlog",
        description: "Analoges Aufnahmeprotokoll",
        lang: "de",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#52402d",
        background_color: "#52402d",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff,woff2,svg,png,ico,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/client\//, /^\/healthz/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/") ||
              url.pathname.startsWith("/auth/") ||
              url.pathname.startsWith("/client/") ||
              url.pathname.startsWith("/healthz"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
