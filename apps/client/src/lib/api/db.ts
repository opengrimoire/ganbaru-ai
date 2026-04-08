import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    const dbName = import.meta.env.DEV ? "sqlite:ganbaruai-dev.db" : "sqlite:ganbaruai.db";
    dbPromise = Database.load(dbName);
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
