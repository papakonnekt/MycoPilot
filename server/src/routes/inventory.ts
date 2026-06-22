import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

// ── GET /api/inventory ────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const materials = db.prepare(`
      SELECT *, (quantity_on_hand <= reorder_threshold) AS is_low
      FROM raw_material
      ORDER BY (quantity_on_hand <= reorder_threshold) DESC, material_name ASC
    `).all();

    const lcStatus = db.prepare(`
      SELECT id, common_name, lc_volume_ml_available, lc_restock_threshold_ml,
        (lc_volume_ml_available <= lc_restock_threshold_ml) AS lc_is_low
      FROM species WHERE is_active = 1
    `).all();

    const fridgeSummary = db.prepare(`SELECT * FROM fridge_summary`).all();

    const recentTransactions = db.prepare(`
      SELECT mt.*, rm.material_name, rm.unit
      FROM material_transaction mt
      JOIN raw_material rm ON rm.id = mt.material_id
      ORDER BY mt.transaction_date DESC
      LIMIT 50
    `).all();

    res.json({ success: true, data: { materials, lcStatus, fridgeSummary, recentTransactions } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/inventory/restock ───────────────────────────────
router.post('/restock', (req: Request, res: Response) => {
  const db = getDb();
  const { materialId, quantity, notes } = req.body as { materialId: number; quantity: number; notes?: string };

  try {
    db.prepare(`UPDATE raw_material SET quantity_on_hand = quantity_on_hand + ?, updated_at = datetime('now') WHERE id = ?`)
      .run(quantity, materialId);

    db.prepare(`
      INSERT INTO material_transaction (material_id, transaction_type, quantity, notes)
      VALUES (?, 'RESTOCK', ?, ?)
    `).run(materialId, quantity, notes ?? null);

    res.json({ success: true, message: `Restocked ${quantity} units.` });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/inventory/lc-restock ───────────────────────────
// Add LC volume to a species aggregate
router.post('/lc-restock', (req: Request, res: Response) => {
  const db = getDb();
  const { speciesId, volumeMl } = req.body as { speciesId: number; volumeMl: number };

  try {
    db.prepare(`UPDATE species SET lc_volume_ml_available = lc_volume_ml_available + ? WHERE id = ?`)
      .run(volumeMl, speciesId);

    res.json({ success: true, message: `Added ${volumeMl}mL to LC inventory for species ${speciesId}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/inventory/fridge ─────────────────────────────────
router.get('/fridge', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const fridgeDetails = db.prepare(`
      SELECT
        fb.*,
        s.common_name,
        b.batch_id AS batch_ref,
        b.colonization_target,
        CAST(julianday(fb.date_expires) - julianday('now') AS INTEGER) AS days_until_expiry
      FROM fridge_buffer fb
      JOIN species s ON s.id = fb.species_id
      JOIN batch b   ON b.id = fb.batch_id
      WHERE (fb.quantity_available - fb.reserved_quantity) > 0
        AND fb.date_expires > date('now')
      ORDER BY fb.date_expires ASC
    `).all();

    const expired = db.prepare(`
      SELECT fb.*, s.common_name, b.batch_id AS batch_ref
      FROM fridge_buffer fb
      JOIN species s ON s.id = fb.species_id
      JOIN batch b   ON b.id = fb.batch_id
      WHERE fb.date_expires <= date('now') AND fb.quantity_available > 0
    `).all();

    res.json({ success: true, data: { active: fridgeDetails, expired } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── DELETE /api/inventory/fridge/:id/expire ───────────────────
// Manually expire a fridge batch
router.delete('/fridge/:id/expire', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const row = db.prepare(`SELECT * FROM fridge_buffer WHERE id = ?`).get(id) as any;
    if (!row) return res.status(404).json({ success: false, error: 'Fridge entry not found' });

    db.prepare(`UPDATE fridge_buffer SET quantity_available = 0 WHERE id = ?`).run(id);
    db.prepare(`UPDATE batch SET status = 'EXPIRED', updated_at = datetime('now') WHERE id = ?`).run(row.batch_id);

    res.json({ success: true, message: 'Batch expired and removed from fridge inventory.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/inventory/fridge ────────────────────────────────
router.post('/fridge', (req: Request, res: Response) => {
  const db = getDb();
  const { species_id, batch_id, date_placed, date_expires, quantity_available } = req.body;
  try {
    const insert = db.prepare(`
      INSERT INTO fridge_buffer (species_id, batch_id, date_placed, date_expires, quantity_available)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      species_id,
      batch_id,
      date_placed || new Date().toISOString().split('T')[0],
      date_expires,
      quantity_available || 1
    );
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/inventory/fridge/:id ─────────────────────────────
router.put('/fridge/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const b = req.body;
  try {
    db.prepare(`
      UPDATE fridge_buffer SET
        quantity_available = COALESCE(@quantity_available, quantity_available),
        reserved_quantity = COALESCE(@reserved_quantity, reserved_quantity),
        date_expires = COALESCE(@date_expires, date_expires),
        updated_at = datetime('now')
      WHERE id = @id
    `).run({ ...b, id });
    res.json({ success: true, message: 'Fridge entry updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
