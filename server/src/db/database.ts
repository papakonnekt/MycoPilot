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
 * Run a schema migration.
 * Idempotent: uses CREATE TABLE IF NOT EXISTS throughout.
 */
export function migrate(): void {
  const database = getDb();

  // Run integrity check on boot
  console.log('Verifying database integrity...');
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    console.error('CRITICAL: Database integrity check failed!', integrity);
    throw new Error('Database corrupted');
  }

  // Create migrations table
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // First, apply the base schema.sql (idempotent)
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    database.exec(schema);
  } catch (err) {
    const msg = (err as Error).message;
    // Tolerate "already exists" for idempotent re-runs
    if (!msg.includes('already exists') && !msg.includes('duplicate column')) {
      throw err;
    }
  }

  // Run subsequent manual migrations from migrations/ folder
  const migrationsDir = path.resolve(__dirname, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    
    const getApplied = database.prepare('SELECT name FROM _migrations').pluck().all() as string[];
    const appliedSet = new Set(getApplied);

    for (const file of files) {
      if (!appliedSet.has(file)) {
        console.log(`Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        database.transaction(() => {
          database.exec(sql);
          database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
        })();
      }
    }
  }

  console.log('✅ Database schema migrated.');
}
