import fs from "node:fs";
import path from "node:path";
import { env } from "../env";

export function ensureAppDirectories(): void {
  [env.DATA_DIR, env.LOG_DIR, env.UPLOADS_DIR].forEach(target => {
    fs.mkdirSync(path.resolve(target), { recursive: true });
  });
}
