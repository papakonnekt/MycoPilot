import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

// ── GET /api/batches ──────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { status, stage, speciesId } = req.query;

  try {
    let query = `
      SELECT b.*, s.common_name AS species_name,
        CAST(julianday(b.colonization_target) - julianday('now') AS INTEGER) AS days_to_colonized,
        CAST(julianday(b.fruiting_target_end) - julianday('now') AS INTEGER)  AS days_to_harvest
      FROM batch b
      JOIN species s ON s.id = b.species_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) { query += ` AND b.status = ?`; params.push(status); }
    if (stage)  { query += ` AND b.stage = ?`;  params.push(stage); }
    if (speciesId) { query += ` AND b.species_id = ?`; params.push(speciesId); }

    query += ` ORDER BY b.colonization_target ASC, b.created_at DESC`;

    const batches = db.prepare(query).all(...params);
    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/batches/incubating ───────────────────────────────
// Mobile-friendly incubation status view with countdown timers
router.get('/incubating', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const batches = db.prepare(`
      SELECT
        b.*,
        s.common_name AS species_name,
        CAST(julianday(b.colonization_target) - julianday('now') AS INTEGER) AS days_remaining,
        ROUND(
          CAST(julianday('now') - julianday(b.colonization_start) AS REAL) /
          CAST(julianday(b.colonization_target) - julianday(b.colonization_start) AS REAL) * 100,
          1
        ) AS pct_complete
      FROM batch b
      JOIN species s ON s.id = b.species_id
      WHERE b.status = 'INCUBATING'
      ORDER BY b.colonization_target ASC
    `).all();

    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/batches/:id/harvest ─────────────────────────────
// Log harvest weight for a fruiting block
router.post('/:id/harvest', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { flushNumber, wetWeightGrams, dryWeightGrams, blockWeightGrams, notes } = req.body;

  try {
    const batch = db.prepare(`SELECT * FROM batch WHERE id = ?`).get(id) as any;
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    // Insert harvest record
    db.prepare(`
      INSERT INTO harvest_record (batch_id, lineage_id, flush_number, harvest_date, wet_weight_grams, dry_weight_grams, block_weight_grams, notes)
      VALUES (?, ?, ?, date('now'), ?, ?, ?, ?)
    `).run(id, batch.lineage_id, flushNumber, wetWeightGrams, dryWeightGrams ?? null, blockWeightGrams ?? null, notes ?? null);

    // Update batch flush count
    db.prepare(`UPDATE batch SET flush_count = flush_count + 1, updated_at = datetime('now') WHERE id = ?`).run(id);

    // Senescence check: query avg BE for this lineage over last 90 days
    if (batch.lineage_id) {
      const beResult = db.prepare(`
        SELECT AVG(biological_efficiency) AS avg_be
        FROM harvest_record
        WHERE lineage_id = ?
          AND harvest_date >= date('now', '-90 days')
          AND biological_efficiency IS NOT NULL
      `).get(batch.lineage_id) as { avg_be: number | null };

      if (beResult?.avg_be != null) {
        const profile = db.prepare(`
          SELECT target_biological_efficiency, senescence_threshold_pct
          FROM species_profile WHERE species_id = ? AND effective_to IS NULL
        `).get(batch.species_id) as any;

        if (profile) {
          const threshold = profile.target_biological_efficiency * (1 - profile.senescence_threshold_pct);
          if (beResult.avg_be < threshold) {
            // Flag lineage as senescent
            db.prepare(`
              UPDATE lineage SET is_senescent = 1, senescence_flagged_at = datetime('now')
              WHERE id = ?
            `).run(batch.lineage_id);

            // Generate senescence task
            db.prepare(`
              INSERT INTO task (task_date, task_type, title, description, species_id, lineage_id, estimated_mins, status, created_by)
              VALUES (date('now'), 'FLAG_SENESCENCE',
                'Lineage Senescence Detected — Start new LC from Spore Print',
                'Average BE of ' || ROUND(?, 1) || '% is below threshold of ' || ROUND(?, 1) || '%. Begin genetic refresh.',
                ?, ?, 30, 'FLAGGED', 'SCHEDULER')
            `).run(
              beResult.avg_be * 100,
              threshold * 100,
              batch.species_id,
              batch.lineage_id
            );
          }
        }
      }
    }

    res.json({ success: true, message: 'Harvest logged.', data: { flushCount: batch.flush_count + 1 } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/batches/:id/traceback ────────────────────────────
router.get('/:id/traceback', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const traceback = db.prepare(`
      SELECT 'BATCH' AS level, b.batch_id AS identifier, b.stage AS detail, b.status, b.created_at
      FROM batch b WHERE b.id = ?
      UNION ALL
      SELECT 'PC RUN', pc.batch_id,
        pc.run_type || ' — ' || pc.bag_count || ' bags on ' || pc.scheduled_date ||
        ' (' || (
          SELECT COUNT(*) FROM batch b2 WHERE b2.source_pc_run_id = pc.id AND b2.status = 'CONTAMINATED'
        ) || ' of ' || (
          SELECT COUNT(*) FROM batch b3 WHERE b3.source_pc_run_id = pc.id
        ) || ' batches contaminated)',
        pc.status, pc.completed_at
      FROM pc_run pc
      JOIN batch b ON b.source_pc_run_id = pc.id
      WHERE b.id = ?
      UNION ALL
      SELECT 'LC SOURCE', gm.batch_id,
        gm.material_type || ' — created: ' || gm.created_at,
        gm.status, gm.created_at
      FROM genetic_material gm
      JOIN batch b ON b.source_genetic_id = gm.id
      WHERE b.id = ?
      UNION ALL
      SELECT 'PARENT BATCH', pb.batch_id,
        pb.stage || ' — ' || pb.quantity || ' bags',
        pb.status, pb.created_at
      FROM batch pb
      JOIN batch b ON b.parent_batch_id = pb.id
      WHERE b.id = ?
    `).all(id, id, id, id);

    res.json({ success: true, data: traceback });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
