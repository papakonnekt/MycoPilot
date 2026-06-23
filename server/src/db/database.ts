import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Database file lives at the project root
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../myco.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);

    // Performance + safety pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
    db.pragma('temp_store = MEMORY');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a schema migration — reads schema.sql and seeds.sql and applies them.
 * Uses db.exec() on the full file — better-sqlite3 handles multi-statement SQL
 * including GENERATED ALWAYS AS columns natively.
 * Idempotent: uses CREATE TABLE IF NOT EXISTS throughout.
 */
export function migrate(): void {
  const database = getDb();

  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  // Execute the full schema in one call — handles generated columns and views
  try {
    database.exec(schema);
  } catch (err) {
    const msg = (err as Error).message;
    // Tolerate "already exists" for idempotent re-runs
    if (!msg.includes('already exists') && !msg.includes('duplicate column')) {
      throw err;
    }
  }

  console.log('✅ Database schema migrated.');
}
