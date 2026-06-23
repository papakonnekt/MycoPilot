import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

// ── GET /api/species ──────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const species = db.prepare(`
      SELECT s.*, sp.*, ft.min_gen2_bags, ft.target_gen2_bags,
        fs.net_available AS fridge_stock,
        fs.below_threshold AS fridge_low,
        wt.target_blocks_per_wk AS weekly_target
      FROM species s
      LEFT JOIN species_profile sp ON sp.species_id = s.id AND sp.effective_to IS NULL
      LEFT JOIN fridge_thresholds ft ON ft.species_id = s.id
      LEFT JOIN fridge_summary fs ON fs.species_id = s.id
      LEFT JOIN weekly_targets wt ON wt.species_id = s.id AND wt.is_active = 1
      WHERE s.is_active = 1
    `).all();

    res.json({ success: true, data: species });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/species/:id/lineages ─────────────────────────────
router.get('/:id/lineages', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const lineages = db.prepare(`
      SELECT l.*,
        (SELECT COUNT(*) FROM harvest_record hr
          JOIN batch b ON b.id = hr.batch_id
          WHERE b.lineage_id = l.id) AS total_harvests,
        (SELECT AVG(hr.biological_efficiency) FROM harvest_record hr
          JOIN batch b ON b.id = hr.batch_id
          WHERE b.lineage_id = l.id
            AND hr.harvest_date >= date('now', '-90 days')
            AND hr.biological_efficiency IS NOT NULL) AS avg_be_90d,
        (
          SELECT json_group_array(json_object('date', hr.harvest_date, 'be', hr.biological_efficiency))
          FROM (
            SELECT hr.harvest_date, hr.biological_efficiency
            FROM harvest_record hr
            JOIN batch b ON b.id = hr.batch_id
            WHERE b.lineage_id = l.id AND hr.biological_efficiency IS NOT NULL
            ORDER BY hr.harvest_date ASC
          ) hr
        ) AS history_json
      FROM lineage l
      WHERE l.species_id = ?
      ORDER BY l.is_senescent ASC, l.created_at DESC
    `).all(id);

    res.json({ success: true, data: lineages });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/species/:id/lineages ────────────────────────────
router.post('/:id/lineages', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { lineage_code, generation_number, is_senescent } = req.body;
  try {
    const insert = db.prepare(`
      INSERT INTO lineage (species_id, lineage_code, generation_number, is_senescent)
      VALUES (?, ?, ?, ?)
    `);
    const result = insert.run(
      id,
      lineage_code || `L-${Date.now()}`,
      generation_number || 1,
      is_senescent ? 1 : 0
    );
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/species/lineages/:id ─────────────────────────────
router.put('/lineages/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { lineage_code, generation_number, is_senescent } = req.body;
  try {
    db.prepare(`
      UPDATE lineage SET
        lineage_code = COALESCE(@lineage_code, lineage_code),
        generation_number = COALESCE(@generation_number, generation_number),
        is_senescent = COALESCE(@is_senescent, is_senescent),
        updated_at = datetime('now')
      WHERE id = @id
    `).run({ lineage_code, generation_number, is_senescent, id });
    res.json({ success: true, message: 'Lineage updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── DELETE /api/species/lineages/:id ──────────────────────────
router.delete('/lineages/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  try {
    db.prepare(`DELETE FROM lineage WHERE id = ?`).run(id);
    res.json({ success: true, message: 'Lineage deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
