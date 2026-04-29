import Database from "@tauri-apps/plugin-sql";

/**
 * Connection string for the active database. Mirrors what the Rust side
 * registers via `tauri-plugin-sql`. Use this when calling Rust commands
 * (e.g. `db_execute_batch`) so the path resolution stays in sync between
 * the plugin and our own connections.
 */
export function dbUrl(): string {
  return import.meta.env.DEV ? "sqlite:ganbaruai-dev.db" : "sqlite:ganbaruai.db";
}

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(dbUrl());
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function execute(
  query: string,
  bindValues?: unknown[],
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  const database = await getDb();
  const result = await database.execute(query, bindValues);
  return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId ?? 0 };
}

export async function select<T>(
  query: string,
  bindValues?: unknown[],
): Promise<T[]> {
  const database = await getDb();
  return database.select<T[]>(query, bindValues);
}
