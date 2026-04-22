import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { requireAuth } from "./auth";
import { initializeDatabase } from "./db/client";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { analysisSettingsRouter } from "./routes/analysisSettings";
import { painPointsRouter } from "./routes/painPoints";
import { productsRouter } from "./routes/products";
import { reviewsRouter } from "./routes/reviews";
import { shopsRouter } from "./routes/shops";
import { statsRouter } from "./routes/stats";
import { uploadsRouter } from "./routes/uploads";
import { ensureAppDirectories } from "./utils/fs";
import { logger } from "./utils/logger";
import { recoverInterruptedUploads } from "./services/recoverInterruptedUploads";

function createApp() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, data: { status: "ok" } });
  });

  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth);
  app.use("/api/shops/:shopId/products", productsRouter);
  app.use("/api/shops", shopsRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/pain-points", painPointsRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/settings", analysisSettingsRouter);

  if (env.NODE_ENV === "production") {
    const clientPath = path.resolve(process.cwd(), "dist", "client");
    app.use(express.static(clientPath));
    app.get(/^(?!\/api).*/, (_request, response) => {
      response.sendFile(path.join(clientPath, "index.html"));
    });
  }

  return app;
}

async function startServer(): Promise<void> {
  ensureAppDirectories();
  await initializeDatabase();
  await recoverInterruptedUploads();

  const app = createApp();
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "server started");
  });
}

const isMainModule = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  startServer().catch(error => {
    logger.error({ error }, "server failed to start");
    process.exit(1);
  });
}

export { createApp, startServer };
