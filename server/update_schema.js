const Database = require('better-sqlite3');
const db = new Database('d:/myco tasks/myco.db');
try {
  db.exec('ALTER TABLE species ADD COLUMN protocol_markdown TEXT');
  console.log('Added protocol_markdown column to species');
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log('protocol_markdown column already exists');
  } else {
    console.error(e);
  }
}
