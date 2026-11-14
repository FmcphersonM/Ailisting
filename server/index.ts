import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { accessMode } from "./auth.js";
import { config } from "./config.js";
import { migrate, recoverInterruptedWork } from "./db.js";
import { api } from "./routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// The built web app sits in web/dist. Its position relative to this file
// differs between development (server/) and production (dist/server/).
const webDir = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")].find((dir) =>
  fs.existsSync(path.join(dir, "index.html")),
);

const app = express();
app.set("trust proxy", 1); // Render sits in front of the app
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  next();
});

// Render calls this to check the app is alive.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.use("/api", express.json({ limit: "300kb" }), cookieParser(), api);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found", message: "Not found." });
});

if (webDir) {
  app.use(
    express.static(webDir, {
      index: false,
      setHeaders(res, filePath) {
        // Files under /assets have a fingerprint in their name and never change.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.set("Cache-Control", "no-cache");
        }
      },
    }),
  );
  // Every other address opens the app, which shows the right screen itself.
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(webDir, "index.html"));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({
      error: "upload_failed",
      message: tooBig ? "That photo is too large to upload." : "The upload did not work. Try again.",
    });
    return;
  }
  console.error("[server]", err);
  res.status(500).json({ error: "server_error", message: "Something went wrong on the server. Try again." });
});

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not set. The app needs a Postgres database.");
  }
  await migrate();
  await recoverInterruptedWork();
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`[server] Selg is running on port ${config.port}`);
    console.log(
      `[server] model=${config.model} effort=${config.effort} access=${accessMode()} ` +
        `anthropicKey=${config.hasAnthropicKey ? "set" : "MISSING"}${config.fakeAi ? " FAKE_AI=on" : ""}`,
    );
    if (!webDir) console.log("[server] web app not built yet (run: npm run build)");
  });
}

main().catch((err) => {
  console.error("[server] could not start:", err);
  process.exit(1);
});
