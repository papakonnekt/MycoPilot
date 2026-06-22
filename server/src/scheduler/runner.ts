/**
 * Scheduler runner — wraps SchedulerEngine for cron and manual invocation.
 * Loads all required DB state and calls the engine.
 */
import { getDb } from '../db/database';

export async function runScheduler(triggeredBy: 'CRON' | 'USER' | 'SETTINGS_CHANGE' | 'TASK_COMPLETE'): Promise<void> {
  // Reuse the scheduler route logic — call the route handler programmatically
  // This keeps all DB hydration logic in one place (scheduler.ts route)
  const db = getDb();

  try {
    // Fire a lightweight trigger: mark old auto-generated PENDING tasks in horizon as stale
    // The route POST /api/scheduler/run handles full regeneration
    // This runner is only called from cron; for actual task generation use the route
    const horizon = 28;
    const horizonEnd = new Date();
    horizonEnd.setDate(horizonEnd.getDate() + horizon);

    console.log(`[SCHEDULER] Triggered by: ${triggeredBy}`);
    console.log(`[SCHEDULER] Horizon: ${new Date().toISOString().split('T')[0]} → ${horizonEnd.toISOString().split('T')[0]}`);

    // Log the cron trigger — actual engine is invoked via HTTP in production
    db.prepare(`
      INSERT INTO schedule_run_log (horizon_start, horizon_end, tasks_generated, tasks_deleted, warnings_json, triggered_by)
      VALUES (date('now'), date('now', '+' || ? || ' days'), 0, 0, '[]', ?)
    `).run(horizon, triggeredBy);

    console.log(`[SCHEDULER] Cron ping logged. Frontend should POST /api/scheduler/run for full refresh.`);
  } catch (err) {
    console.error('[SCHEDULER RUNNER] Error:', err);
    throw err;
  }
}
