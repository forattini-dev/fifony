import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Stamp the service worker with a build timestamp so cache names change on every build
function stampServiceWorker() {
  return {
    name: "stamp-service-worker",
    writeBundle() {
      const swPath = resolve("app/dist/service-worker.js");
      try {
        const content = readFileSync(swPath, "utf8");
        const stamped = content.replace("__BUILD_TIMESTAMP__", String(Date.now()));
        writeFileSync(swPath, stamped, "utf8");
      } catch {}
    },
  };
}

export default defineConfig(({ command }) => ({
  // In build mode, assets go under /assets/ so they don't collide with routes
  // In dev mode, base must be / for the router to work
  base: command === "build" ? "/assets/" : "/",
  plugins: [
    tailwindcss(),
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    ...(command === "build" ? [stampServiceWorker()] : []),
  ],
  root: "app",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/@tanstack/react-query/") ||
            id.includes("node_modules/@tanstack/react-router/")
          ) {
            return "vendor";
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "@tanstack/react-query",
      "@tanstack/react-router",
    ],
  },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/react-router"],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: false,
        // Allow SSE (text/event-stream) to flow without buffering
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            const ct = proxyRes.headers["content-type"] || "";
            if (ct.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/ws": { target: "ws://localhost:4000", ws: true },
      "/docs": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
}));
