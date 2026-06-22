/**
 * Fridge Manager — handles daily expiry of colonized Gen2 bags
 * that exceed the 90-day shelf-life.
 * Q2: 90-day fridge expiry is enforced here via daily cron.
 */
import { getDb } from '../db/database';

export function expireFridgeBags(): number {
  const db = getDb();

  // Find all fridge entries past expiry date
  const expired = db.prepare(`
    SELECT fb.*, b.species_id, s.common_name
    FROM fridge_buffer fb
    JOIN batch b ON b.id = fb.batch_id
    JOIN species s ON s.id = b.species_id
    WHERE fb.date_expires <= date('now')
      AND fb.quantity_available > 0
  `).all() as Array<{ id: number; batch_id: number; common_name: string; quantity_available: number }>;

  if (expired.length === 0) return 0;

  const expireBuffer = db.prepare(`UPDATE fridge_buffer SET quantity_available = 0 WHERE id = ?`);
  const expireBatch  = db.prepare(`UPDATE batch SET status = 'EXPIRED', updated_at = datetime('now') WHERE id = ?`);
  const insertTask   = db.prepare(`
    INSERT INTO task (task_date, task_type, title, description, species_id, batch_id, estimated_mins, status, created_by)
    VALUES (date('now'), 'REVIEW_BATCH',
      'Dispose expired fridge batch — ' || ?,
      'Gen2 bag batch has exceeded 90-day fridge shelf-life. Mycelium vigor compromised. Dispose safely.',
      ?, ?, 5, 'PENDING', 'SCHEDULER')
  `);

  const processAll = db.transaction(() => {
    for (const row of expired) {
      expireBuffer.run(row.id);
      expireBatch.run(row.batch_id);
      insertTask.run(row.common_name, row.batch_id, row.batch_id);
      console.log(`[FRIDGE MANAGER] Expired: ${row.common_name} batch ${row.batch_id} (${row.quantity_available} bags)`);
    }
  });

  processAll();
  console.log(`[FRIDGE MANAGER] Expired ${expired.length} fridge batch(es).`);
  return expired.length;
}
