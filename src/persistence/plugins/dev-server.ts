import { resolve } from "node:path";
import { PACKAGE_ROOT } from "../../concerns/constants.ts";
import { logger } from "../../concerns/logger.ts";

export async function startDevFrontend(apiPort: number, devPort: number, options?: { tls?: boolean }): Promise<void> {
  const VITE_CONFIG_PATH = resolve(PACKAGE_ROOT, "app/vite.config.js");
  let createViteServer: typeof import("vite").createServer;
  try {
    const vite = await import("vite");
    createViteServer = vite.createServer;
  } catch {
    logger.warn("Vite not installed (devDependency). Run 'pnpm install' in the project to enable --dev mode.");
    return;
  }

  const tls = options?.tls ?? false;
  const scheme = tls ? "https" : "http";
  const wsScheme = tls ? "wss" : "ws";

  // Wait for the API server to be ready before starting the proxy
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(`${scheme}://localhost:${apiPort}/api/health`, {
        ...(tls ? { dispatcher: undefined } : {}),
      });
      if (res.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  try {
    const server = await createViteServer({
      configFile: VITE_CONFIG_PATH,
      customLogger: {
        info: (msg: string) => logger.info(`[Vite] ${msg}`),
        warn: (msg: string) => logger.warn(`[Vite] ${msg}`),
        warnOnce: (msg: string) => logger.warn(`[Vite] ${msg}`),
        error: (msg: string) => {
          if (msg.includes("ws proxy error") || msg.includes("ws proxy socket error")) {
            logger.debug(`[Vite] ${msg.split("\n")[0]} (transient, suppressed)`);
            return;
          }
          logger.error(`[Vite] ${msg}`);
        },
        hasErrorLogged: () => false,
        clearScreen: () => {},
        hasWarned: false,
      },
      server: {
        port: devPort,
        host: true,
        proxy: {
          "/api": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/ws": {
            target: `${wsScheme}://localhost:${apiPort}`,
            ws: true,
            secure: false,
            configure: (proxy) => {
              const silence = (err: any) => {
                logger.debug(`[Vite] WS proxy transient: ${err.code || err.message}`);
              };
              proxy.on("error", silence);
              proxy.on("proxyReqWs", (_proxyReq: any, _req: any, socket: any) => {
                socket.on("error", silence);
              });
            },
          },
          "/docs": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/health": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/manifest.webmanifest": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/service-worker.js": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/icon.svg": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/icon-maskable.svg": { target: `${scheme}://localhost:${apiPort}`, secure: false },
          "/offline.html": { target: `${scheme}://localhost:${apiPort}`, secure: false },
        },
      },
    });
    await server.listen();
    logger.info(`Dev frontend available at http://localhost:${devPort}`);
  } catch (error) {
    logger.warn(`Failed to start Vite dev server: ${String(error)}`);
  }
}
