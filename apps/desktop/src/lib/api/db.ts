import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:ganbaruai.db");
  }
  return db;
}

export async function execute(
  query: string,
  bindValues?: unknown[],
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  const database = await getDb();
  return database.execute(query, bindValues);
}

export async function select<T>(
  query: string,
  bindValues?: unknown[],
): Promise<T[]> {
  const database = await getDb();
  return database.select<T[]>(query, bindValues);
}
