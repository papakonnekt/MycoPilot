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
        s.protocol_markdown,
        CAST(julianday(b.colonization_target) - julianday('now') AS INTEGER) AS days_remaining,
        ROUND(
          CAST(julianday('now') - julianday(b.colonization_start) AS REAL) /
          CAST(julianday(b.colonization_target) - julianday(b.colonization_start) AS REAL) * 100,
          1
        ) AS pct_complete
      FROM batch b
      JOIN species s ON s.id = b.species_id
      WHERE b.status IN ('INCUBATING', 'COLONIZED')
        AND b.stage IN ('GEN1_GRAIN','GEN2_GRAIN','BULK_BLOCK')
      ORDER BY b.colonization_target ASC
    `).all();

    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/batches/forecast ─────────────────────────────────
// Returns active FRUITING batches sorted by expected harvest date
router.get('/forecast', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const forecast = db.prepare(`
      SELECT
        b.id, b.batch_id, b.quantity, b.flush_count,
        b.fruiting_start, b.fruiting_target_end,
        s.common_name AS species_name,
        CAST(julianday(b.fruiting_target_end) - julianday('now') AS INTEGER) AS days_to_harvest
      FROM batch b
      JOIN species s ON s.id = b.species_id
      WHERE b.status = 'FRUITING'
        AND b.fruiting_target_end IS NOT NULL
      ORDER BY b.fruiting_target_end ASC
    `).all();

    res.json({ success: true, data: forecast });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
// ── GET /api/batches/:id/report ─────────────────────────────
// Returns a printable HTML report for a batch
router.get('/:id/report', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const batch = db.prepare(`
      SELECT b.*, s.common_name AS species_name, s.scientific_name,
        l.lineage_code, l.generation_count
      FROM batch b
      JOIN species s ON s.id = b.species_id
      LEFT JOIN lineage l ON l.id = b.lineage_id
      WHERE b.id = ?
    `).get(id) as any;

    if (!batch) return res.status(404).send('Batch not found');

    const tasks = db.prepare(`SELECT * FROM task WHERE batch_id = ? ORDER BY task_date ASC`).all(id) as any[];
    const harvests = db.prepare(`SELECT * FROM harvest_record WHERE batch_id = ? ORDER BY flush_number ASC`).all(id) as any[];

    const html = `
<!doctype html>
<html>
<head>
  <title>Batch Report - ${batch.batch_ref}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #111; max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { margin: 0 0 0.5rem; font-size: 2rem; border-bottom: 2px solid #000; padding-bottom: 0.5rem; }
    h2 { font-size: 1.2rem; margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; }
    .meta div { background: #f5f5f5; padding: 1rem; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    th { font-weight: 600; color: #555; }
    .barcode { font-family: monospace; font-size: 1.5rem; letter-spacing: 2px; text-align: center; padding: 2rem; border: 2px dashed #ccc; margin-top: 2rem; }
    @media print {
      body { padding: 0; }
      button { display: none; }
    }
  </style>
</head>
<body onload="window.print()">
  <h1>Batch: ${batch.batch_ref}</h1>
  <div class="meta">
    <div>
      <strong>Species:</strong> ${batch.species_name} <em>(${batch.scientific_name})</em><br>
      <strong>Lineage:</strong> ${batch.lineage_code || 'N/A'} (Gen ${batch.generation_count || '?'})<br>
      <strong>Stage:</strong> ${batch.stage || 'PENDING'}<br>
    </div>
    <div>
      <strong>Created:</strong> ${batch.created_at?.split('T')[0]}<br>
      <strong>Col. Target:</strong> ${batch.colonization_target || 'N/A'}<br>
      <strong>Fruiting End:</strong> ${batch.fruiting_target_end || 'N/A'}<br>
    </div>
  </div>

  <h2>Task History</h2>
  <table>
    <thead><tr><th>Date</th><th>Task</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>
      ${tasks.map(t => `
        <tr>
          <td>${t.task_date}</td>
          <td>${t.title}</td>
          <td>${t.status}</td>
          <td>${t.notes || ''}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Harvest Records</h2>
  <table>
    <thead><tr><th>Date</th><th>Flush</th><th>Wet Weight (g)</th><th>BE</th></tr></thead>
    <tbody>
      ${harvests.length ? harvests.map(h => `
        <tr>
          <td>${h.harvest_date}</td>
          <td>${h.flush_number}</td>
          <td>${h.wet_weight_grams}g</td>
          <td>${h.biological_efficiency ? (h.biological_efficiency * 100).toFixed(1) + '%' : '-'}</td>
        </tr>
      `).join('') : '<tr><td colspan="4">No harvests recorded yet.</td></tr>'}
    </tbody>
  </table>

  <div class="barcode">*${batch.batch_ref}*</div>
  <p style="text-align:center; color:#888; font-size:0.8rem; margin-top:2rem;">Generated by Myco Lab</p>
</body>
</html>
    `;

    res.send(html);
  } catch (err) {
    res.status(500).send('Failed to generate report');
  }
});

// Log harvest weight for a fruiting block
router.post('/:id/harvest', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { flushNumber, wetWeightGrams, dryWeightGrams, blockWeightGrams, notes } = req.body;

  try {
    const batch = db.prepare(`SELECT * FROM batch WHERE id = ?`).get(id) as any;
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    // Compute estimated cost (labor + materials)
    const costQuery = db.prepare(`
      SELECT 
        SUM(t.estimated_mins) as total_mins,
        SUM(mur.quantity_per_bag * rm.cost_per_unit * b.quantity) as total_material_cost
      FROM task t
      JOIN batch b ON b.id = t.batch_id
      LEFT JOIN material_usage_recipe mur ON mur.task_type = t.task_type
      LEFT JOIN raw_material rm ON rm.id = mur.material_id
      WHERE t.batch_id = ? AND t.status = 'COMPLETE'
    `).get(id) as { total_mins: number | null, total_material_cost: number | null };

    const laborCost = ((costQuery?.total_mins || 0) / 60) * 20; // Assume $20/hr
    const materialCost = costQuery?.total_material_cost || 0;
    const cost_estimated = laborCost + materialCost;

    // Insert harvest record
    db.prepare(`
      INSERT INTO harvest_record (batch_id, lineage_id, flush_number, harvest_date, wet_weight_grams, dry_weight_grams, block_weight_grams, cost_estimated, notes)
      VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?)
    `).run(id, batch.lineage_id, flushNumber, wetWeightGrams, dryWeightGrams ?? null, blockWeightGrams ?? null, cost_estimated, notes ?? null);

    // Update batch flush count using the provided flush number
    db.prepare(`UPDATE batch SET flush_count = MAX(COALESCE(flush_count, 0), ?), updated_at = datetime('now') WHERE id = ?`).run(flushNumber, id);

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
// ── GET /api/batches/:id/photos ─────────────────────────────
router.get('/:id/photos', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const photos = db.prepare(`SELECT * FROM batch_photo WHERE batch_id = ? ORDER BY captured_at DESC`).all(id);
    res.json({ success: true, data: photos });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/batches/:id/photos ────────────────────────────
router.post('/:id/photos', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { photo_data_b64, notes } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO batch_photo (batch_id, photo_data_b64, notes)
      VALUES (?, ?, ?)
    `).run(id, photo_data_b64, notes || null);
    
    res.json({ success: true, message: 'Photo saved.', data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
// ── POST /api/batches ──────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const b = req.body;
  try {
    const insert = db.prepare(`
      INSERT INTO batch (
        batch_id, species_id, lineage_id, stage, status, quantity,
        weight_per_bag_lbs, colonization_start, colonization_target,
        fruiting_start, fruiting_target_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      b.batch_id || `B-${Date.now()}`,
      b.species_id,
      b.lineage_id || null,
      b.stage || 'INCUBATING',
      b.status || 'INCUBATING',
      b.quantity || 1,
      b.weight_per_bag_lbs || null,
      b.colonization_start || null,
      b.colonization_target || null,
      b.fruiting_start || null,
      b.fruiting_target_end || null
    );
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/batches/:id ───────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const b = req.body;
  try {
    db.prepare(`
      UPDATE batch SET
        species_id = COALESCE(@species_id, species_id),
        lineage_id = COALESCE(@lineage_id, lineage_id),
        stage = COALESCE(@stage, stage),
        status = COALESCE(@status, status),
        quantity = COALESCE(@quantity, quantity),
        weight_per_bag_lbs = COALESCE(@weight_per_bag_lbs, weight_per_bag_lbs),
        colonization_start = COALESCE(@colonization_start, colonization_start),
        colonization_target = COALESCE(@colonization_target, colonization_target),
        fruiting_start = COALESCE(@fruiting_start, fruiting_start),
        fruiting_target_end = COALESCE(@fruiting_target_end, fruiting_target_end),
        notes = COALESCE(@notes, notes),
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      species_id: null,
      lineage_id: null,
      stage: null,
      status: null,
      quantity: null,
      weight_per_bag_lbs: null,
      colonization_start: null,
      colonization_target: null,
      fruiting_start: null,
      fruiting_target_end: null,
      notes: null,
      ...b,
      id
    });
    res.json({ success: true, message: 'Batch updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/batches/:id/progress ─────────────────────────────────
router.put('/:id/progress', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { pct } = req.body;
  if (typeof pct !== 'number') return res.status(400).json({ success: false, error: 'pct is required' });

  try {
    const batch = db.prepare(`
      SELECT b.stage, sp.lc_to_gen1_days_max, sp.gen2_colonization_days_max, sp.bulk_colonization_days_max
      FROM batch b
      JOIN species_profile sp ON b.species_id = sp.species_id
      WHERE b.id = ?
    `).get(id) as any;

    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    let totalDays = 14;
    if (batch.stage === 'GEN1_GRAIN') totalDays = batch.lc_to_gen1_days_max ?? 21;
    else if (batch.stage === 'GEN2_GRAIN') totalDays = batch.gen2_colonization_days_max ?? 21;
    else if (batch.stage === 'BULK_BLOCK') totalDays = batch.bulk_colonization_days_max ?? 21;

    const daysAgo = (pct / 100) * totalDays;
    const targetDaysFromNow = totalDays - daysAgo;

    const startStr = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const targetStr = new Date(Date.now() + targetDaysFromNow * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE batch SET 
        colonization_start = ?,
        colonization_target = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(startStr, targetStr, id);

    res.json({ success: true, message: 'Progress updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/batches/:id/advance ──────────────────────────────
// Auto-detects the next logical stage and advances the batch.
router.put('/:id/advance', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const batch = db.prepare(`SELECT * FROM batch WHERE id = ?`).get(id) as any;
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    const stage = batch.stage as string;
    const status = batch.status as string;

    let nextStage = stage;
    let nextStatus = status;
    let description = '';

    if (stage === 'GEN1_GRAIN' && status === 'INCUBATING') {
      nextStatus = 'COLONIZED';
      description = 'Gen 1 Grain marked as Colonized';
    } else if (stage === 'GEN1_GRAIN' && status === 'COLONIZED') {
      nextStage = 'GEN2_GRAIN';
      nextStatus = 'INCUBATING';
      description = 'Gen 1 → Gen 2 Grain (G2G Transfer)';
    } else if (stage === 'GEN2_GRAIN' && status === 'INCUBATING') {
      nextStatus = 'COLONIZED';
      description = 'Gen 2 Grain marked as Colonized';
    } else if (stage === 'GEN2_GRAIN' && status === 'COLONIZED') {
      nextStage = 'FRIDGE';
      nextStatus = 'IN_FRIDGE';
      description = 'Gen 2 Grain moved to Fridge Buffer';
    } else if (stage === 'FRIDGE' || status === 'IN_FRIDGE') {
      nextStage = 'BULK_BLOCK';
      nextStatus = 'INCUBATING';
      description = 'Pulled from Fridge → Inoculated as Bulk Block';
    } else if (stage === 'BULK_BLOCK' && status === 'INCUBATING') {
      nextStatus = 'COLONIZED';
      description = 'Bulk Block marked as Fully Colonized';
    } else if (stage === 'BULK_BLOCK' && status === 'COLONIZED') {
      nextStage = 'FRUITING';
      nextStatus = 'FRUITING';
      description = 'Bulk Block moved to Fruiting';
    } else if (stage === 'FRUITING') {
      nextStatus = 'SPENT';
      description = 'Fruiting block marked as Spent';
    } else {
      return res.status(400).json({
        success: false,
        error: `No advancement path defined for stage=${stage}, status=${status}`,
      });
    }

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
      stage: nextStage,
      status: nextStatus,
      updated_at: now,
    };

    if (nextStage === 'FRUITING' && stage !== 'FRUITING') {
      updates.fruiting_start = now;
      const profile = db.prepare(`
        SELECT fruiting_days_max FROM species_profile
        WHERE species_id = ? AND effective_to IS NULL
      `).get(batch.species_id) as any;
      if (profile) {
        const targetDate = new Date(Date.now() + (profile.fruiting_days_max ?? 14) * 86400000);
        updates.fruiting_target_end = targetDate.toISOString();
      }
    }

    if (nextStatus === 'COLONIZED' && !batch.colonization_start) {
      updates.colonization_start = now;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE batch SET ${setClauses} WHERE id = @id`).run({ ...updates, id });

    res.json({
      success: true,
      message: description,
      data: { previousStage: stage, previousStatus: status, nextStage, nextStatus, description },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/batches/:id/contaminate ─────────────────────────
router.put('/:id/contaminate', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { contaminationType = 'UNKNOWN', quantity, notes } = req.body;

  const validTypes = ['TRICH', 'BACTERIA', 'MOLD', 'WET_ROT', 'UNKNOWN'];
  if (!validTypes.includes(contaminationType)) {
    return res.status(400).json({ success: false, error: 'Invalid contamination type' });
  }

  try {
    const batch = db.prepare(`SELECT * FROM batch WHERE id = ?`).get(id) as any;
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE batch SET
          status = 'CONTAMINATED',
          contamination_type = ?,
          contamination_qty = ?,
          contaminated_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(contaminationType, quantity ?? batch.quantity, now, now, id);

      db.prepare(`
        INSERT INTO contam_log (batch_id, lineage_id, contam_type, contam_stage, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, batch.lineage_id ?? null, contaminationType, batch.stage, notes ?? null);
    })();

    res.json({ success: true, message: `Batch ${batch.batch_id} marked as contaminated.` });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── DELETE /api/batches/:id ────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  try {
    db.prepare(`DELETE FROM batch WHERE id = ?`).run(id);
    res.json({ success: true, message: 'Batch deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
