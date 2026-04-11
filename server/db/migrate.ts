import { migrate } from "drizzle-orm/libsql/migrator";
import { db, initializeDatabase } from "./client";
import { ensureAppDirectories } from "../utils/fs";

async function main(): Promise<void> {
  ensureAppDirectories();
  await initializeDatabase();
  await migrate(db, { migrationsFolder: "./drizzle" });
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
