import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import * as schema from "./schema";

function ensureDirectoryExists(targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

ensureDirectoryExists(env.DB_PATH);

const databaseClient = createClient({
  url: pathToFileURL(env.DB_PATH).href,
});

let initializationPromise: Promise<void> | null = null;

export const db = drizzle(databaseClient, { schema });

export async function initializeDatabase(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    await databaseClient.execute("PRAGMA foreign_keys = ON");
    await databaseClient.execute("PRAGMA journal_mode = WAL");
  })().catch(error => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}
