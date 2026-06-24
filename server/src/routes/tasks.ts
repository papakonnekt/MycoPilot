import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { ApiResponse, Task, DailyView } from '../../../shared/types';

const router = Router();

// ── GET /api/tasks/today ──────────────────────────────────────
// Mobile-first daily view: returns today's tasks with time budget info
router.get('/today', (req: Request, res: Response) => {
  const db = getDb();
  const today = req.query.date as string ?? new Date().toISOString().split('T')[0];

  try {
    const tasks = db.prepare(`
      SELECT
        t.*,
        s.common_name AS species_name,
        b.batch_id    AS batch_ref,
        CASE WHEN t.task_date < date('now') AND t.status = 'PENDING' THEN 1 ELSE 0 END AS is_overdue
      FROM task t
      LEFT JOIN species s ON s.id = t.species_id
      LEFT JOIN batch b   ON b.id = t.batch_id
      WHERE t.task_date = ?
      ORDER BY
        CASE t.status
          WHEN 'OVER_BUDGET_WARNING' THEN 1
          WHEN 'PENDING'             THEN 2
          WHEN 'IN_PROGRESS'         THEN 3
          WHEN 'COMPLETE'            THEN 4
          ELSE 5
        END,
        t.task_type ASC
    `).all(today) as Task[];

    const hw = db.prepare(`SELECT daily_available_mins FROM hardware_settings WHERE is_active = 1`).get() as { daily_available_mins: number };
    const budgetMins = hw?.daily_available_mins ?? 480;
    const totalMins = tasks.reduce((s, t) => s + (t.estimatedMins ?? 0), 0);

    const daily: DailyView = {
      date: today,
      tasks,
      totalEstimatedMins: totalMins,
      dailyBudgetMins: budgetMins,
      isOverBudget: totalMins > budgetMins,
      warningCount: tasks.filter(t => t.status === 'OVER_BUDGET_WARNING' || t.status === 'FLAGGED').length,
    };

    res.json({ success: true, data: daily } as ApiResponse<DailyView>);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/tasks/range ──────────────────────────────────────
// Desktop 28-day calendar view
router.get('/range', (req: Request, res: Response) => {
  const db = getDb();
  const { from, to } = req.query as { from: string; to: string };

  if (!from || !to) {
    return res.status(400).json({ success: false, error: 'from and to dates required' });
  }

  try {
    const tasks = db.prepare(`
      SELECT t.*, s.common_name AS species_name, b.batch_id AS batch_ref
      FROM task t
      LEFT JOIN species s ON s.id = t.species_id
      LEFT JOIN batch b   ON b.id = t.batch_id
      WHERE t.task_date BETWEEN ? AND ?
      ORDER BY t.task_date ASC, t.task_type ASC
    `).all(from, to) as Task[];

    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PATCH /api/tasks/:id/complete ────────────────────────────
// Mark a task complete; triggers downstream effects
router.patch('/:id/complete', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const task = db.prepare('SELECT * FROM task WHERE id = ?').get(id) as Task;
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    db.prepare(`
      UPDATE task SET status = 'COMPLETE', completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    // Downstream effects based on task type
    let sideEffects: string[] = [];

    if (task.taskType === 'INOCULATE_GEN1' || task.taskType === 'G2G_TRANSFER' || task.taskType === 'INOCULATE_BULK') {
      // Start colonization timer on the associated batch
      if (task.batchId) {
        const profile = db.prepare(`
          SELECT sp.* FROM species_profile sp
          JOIN batch b ON b.species_id = sp.species_id
          WHERE b.id = ? AND sp.effective_to IS NULL
        `).get(task.batchId) as { bulk_colonization_days_max: number; gen2_colonization_days_max: number; lc_to_gen1_days_max: number };

        let daysToColon = 14;
        if (task.taskType === 'INOCULATE_GEN1') daysToColon = profile?.lc_to_gen1_days_max ?? 18;
        if (task.taskType === 'G2G_TRANSFER')   daysToColon = profile?.gen2_colonization_days_max ?? 14;
        if (task.taskType === 'INOCULATE_BULK') daysToColon = profile?.bulk_colonization_days_max ?? 14;

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + daysToColon);

        db.prepare(`
          UPDATE batch SET
            status = 'INCUBATING',
            colonization_start = date('now'),
            colonization_target = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(targetDate.toISOString().split('T')[0], task.batchId);

        sideEffects.push(`Batch ${task.batchId} colonization timer started (${daysToColon} days)`);
      }
    }

    if (task.taskType === 'HARVEST') {
      // Deduct LC is handled at inoculation; just record harvest completion
      sideEffects.push('Harvest logged. Use the Harvest Weight form to enter yield data.');
    }

    if (task.taskType === 'MOVE_TO_FRIDGE') {
      if (task.batchId) {
        db.prepare(`UPDATE batch SET status = 'IN_FRIDGE', stage = 'FRIDGE', updated_at = datetime('now') WHERE id = ?`).run(task.batchId);
        db.prepare(`
          INSERT INTO fridge_buffer (species_id, batch_id, quantity_available, date_added, date_expires)
          SELECT species_id, id, quantity, date('now'), date('now', '+90 days')
          FROM batch WHERE id = ?
          ON CONFLICT(species_id, batch_id) DO NOTHING
        `).run(task.batchId);
        sideEffects.push('Batch moved to virtual Fridge (90-day expiry set).');
      }
    }

    if (task.taskType === 'INOCULATE_GEN1') {
      // Deduct LC from species aggregate or individual active jars
      if (task.speciesId && task.batchId) {
        const species = db.prepare('SELECT lc_injection_volume_ml FROM species WHERE id = ?').get(task.speciesId) as any;
        const batch = db.prepare('SELECT quantity FROM batch WHERE id = ?').get(task.batchId) as any;
        
        if (species && batch) {
          let amountToDeduct = (species.lc_injection_volume_ml || 10) * batch.quantity;
          sideEffects.push(`Deducting ${amountToDeduct}ml total LC for ${batch.quantity} bags.`);
          
          // Try to deduct from active jars first
          const jars = db.prepare(`SELECT id, current_volume_ml FROM genetic_material WHERE species_id = ? AND status = 'ACTIVE' AND current_volume_ml > 0 ORDER BY created_at ASC`).all(task.speciesId) as any[];
          
          for (const jar of jars) {
            if (amountToDeduct <= 0) break;
            const deduct = Math.min(jar.current_volume_ml, amountToDeduct);
            amountToDeduct -= deduct;
            const remaining = jar.current_volume_ml - deduct;
            db.prepare(`UPDATE genetic_material SET current_volume_ml = ?, status = ? WHERE id = ?`)
              .run(remaining, remaining <= 0 ? 'DEPLETED' : 'ACTIVE', jar.id);
          }

          if (amountToDeduct > 0) {
            db.prepare(`
              UPDATE species
              SET lc_volume_ml_available = MAX(0, lc_volume_ml_available - ?)
              WHERE id = ?
            `).run(amountToDeduct, task.speciesId);
          }
        }
      }
    }

    if (task.taskType === 'G2G_TRANSFER' || task.taskType === 'INOCULATE_BULK') {
      if (task.speciesId && task.batchId) {
        const profile = db.prepare(`SELECT gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct FROM species_profile WHERE species_id = ? AND effective_to IS NULL`).get(task.speciesId) as any;
        const hw = db.prepare(`SELECT default_bag_weight_lbs FROM hardware_settings LIMIT 1`).get() as any;
        const batch = db.prepare(`SELECT quantity, weight_per_bag_lbs FROM batch WHERE id = ?`).get(task.batchId) as any;

        if (profile && batch && hw) {
          let bagsToPull = 0;
          if (task.taskType === 'G2G_TRANSFER') {
            const ratio = profile.gen1_to_gen2_ratio || 10;
            bagsToPull = Math.ceil(batch.quantity / ratio);
          } else {
            const pct = profile.gen2_to_bulk_spawn_pct || 0.2;
            const bulkWeight = batch.quantity * (batch.weight_per_bag_lbs || hw.default_bag_weight_lbs);
            const spawnNeededLbs = bulkWeight * pct;
            bagsToPull = Math.ceil(spawnNeededLbs / hw.default_bag_weight_lbs);
          }

          if (bagsToPull > 0) {
            sideEffects.push(`Auto-pulled ${bagsToPull} spawn bags from fridge.`);
            const fridgeBags = db.prepare(`
              SELECT id, quantity_available, reserved_quantity 
              FROM fridge_buffer 
              WHERE species_id = ? AND (quantity_available - reserved_quantity) > 0 
              ORDER BY date_added ASC
            `).all(task.speciesId) as any[];

            let remainingToPull = bagsToPull;
            for (const fb of fridgeBags) {
              if (remainingToPull <= 0) break;
              const available = fb.quantity_available - fb.reserved_quantity;
              const pull = Math.min(available, remainingToPull);
              
              remainingToPull -= pull;
              
              db.prepare(`UPDATE fridge_buffer SET quantity_available = quantity_available - ? WHERE id = ?`).run(pull, fb.id);
            }
            if (remainingToPull > 0) {
              sideEffects.push(`WARNING: Short by ${remainingToPull} fridge bags!`);
            }
          }
        }
      }
    }

    res.json({ success: true, data: { taskId: id, sideEffects } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PATCH /api/tasks/:id/reschedule ──────────────────────────
// Reschedule a task; cascades to dependent tasks
router.patch('/:id/reschedule', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { newDate } = req.body as { newDate: string };

  if (!newDate) return res.status(400).json({ success: false, error: 'newDate required' });

  try {
    const task = db.prepare('SELECT * FROM task WHERE id = ?').get(id) as Task;
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const oldDate = new Date(task.taskDate);
    const newDateObj = new Date(newDate);
    const deltaDays = Math.round((newDateObj.getTime() - oldDate.getTime()) / 86400000);

    // Update the task itself
    db.prepare(`
      UPDATE task SET
        task_date = ?,
        status = 'RESCHEDULED',
        rescheduled_from_date = task_date,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newDate, id);

    // Cascade: find all tasks that depend on this one and shift by same delta
    const dependents = db.prepare(`
      SELECT id, task_date FROM task WHERE depends_on_task_id = ? AND status = 'PENDING'
    `).all(id) as Array<{ id: number; task_date: string }>;

    let cascadeCount = 0;
    for (const dep of dependents) {
      const depDate = new Date(dep.task_date);
      depDate.setDate(depDate.getDate() + deltaDays);
      db.prepare(`UPDATE task SET task_date = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(depDate.toISOString().split('T')[0], dep.id);
      cascadeCount++;
    }

    res.json({
      success: true,
      data: {
        taskId: id,
        newDate,
        deltaDays,
        cascadedTasks: cascadeCount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PATCH /api/tasks/batch/:batchId/mark-spent ───────────────
// Q3: Kill switch — immediately cancel all future flush tasks for a batch
router.patch('/batch/:batchId/mark-spent', (req: Request, res: Response) => {
  const db = getDb();
  const { batchId } = req.params;

  try {
    // Kill all pending HARVEST tasks for this batch
    const result = db.prepare(`
      UPDATE task SET status = 'SKIPPED', updated_at = datetime('now')
      WHERE depends_on_batch_id = ?
        AND task_type = 'HARVEST'
        AND status IN ('PENDING', 'OVER_BUDGET_WARNING')
        AND task_date >= date('now')
    `).run(batchId);

    // Mark batch as SPENT
    db.prepare(`UPDATE batch SET status = 'SPENT', updated_at = datetime('now') WHERE id = ?`).run(batchId);

    res.json({
      success: true,
      data: {
        batchId,
        tasksKilled: result.changes,
        message: `Block marked as spent. ${result.changes} future flush tasks cancelled.`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PATCH /api/tasks/:id/contamination ────────────────────────
// Log a contamination event from a task, flag the batch, and kill future tasks
router.patch('/:id/contamination', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { type, qty, notes } = req.body;

  try {
    const task = db.prepare('SELECT * FROM task WHERE id = ?').get(id) as Task;
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (!task.batchId) return res.status(400).json({ success: false, error: 'Task is not associated with a batch' });

    db.transaction(() => {
      // 1. Update task
      db.prepare(`UPDATE task SET status = 'FLAGGED', notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(`CONTAMINATION [${type}]: ${notes || ''}`, id);

      // 2. Update batch
      db.prepare(`
        UPDATE batch SET 
          status = 'CONTAMINATED', 
          contamination_type = ?, 
          contamination_qty = COALESCE(contamination_qty, 0) + ?, 
          contaminated_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(type, qty, task.batchId);

      // 3. Kill pending tasks for this batch
      db.prepare(`
        UPDATE task SET status = 'SKIPPED', updated_at = datetime('now')
        WHERE (depends_on_batch_id = ? OR batch_id = ?)
          AND status IN ('PENDING', 'OVER_BUDGET_WARNING')
          AND id != ?
      `).run(task.batchId, task.batchId, id);
    })();

    res.json({ success: true, data: { taskId: id, message: `Contamination logged. Future tasks for batch ${task.batchId} cancelled.` } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── DELETE /api/tasks/before-horizon ─────────────────────────
// Clean up old auto-generated pending tasks or completed tasks
router.delete('/before-horizon', (req: Request, res: Response) => {
  const db = getDb();
  const { date } = req.query as { date?: string };
  if (!date) return res.status(400).json({ success: false, error: 'date required' });

  try {
    const result = db.prepare(`
      DELETE FROM task 
      WHERE task_date < ? 
        AND status IN ('COMPLETE', 'SKIPPED', 'RESCHEDULED', 'FLAGGED')
    `).run(date);

    res.json({ success: true, data: { tasksDeleted: result.changes } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
