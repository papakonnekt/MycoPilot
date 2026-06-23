import { Router } from 'express';
import { getDb } from '../db/database';

const router = Router();

export interface PerformanceMatrixRow {
  species_id: number;
  species_name: string;
  recipe_id: number | null;
  recipe_name: string | null;
  avg_biological_efficiency: number;
  harvest_count: number;
}

/**
 * GET /api/analytics/performance
 * Returns average biological efficiency grouped by species and recipe
 */
router.get('/performance', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        s.id AS species_id,
        s.common_name AS species_name,
        r.id AS recipe_id,
        r.name AS recipe_name,
        AVG(hl.biological_efficiency) AS avg_biological_efficiency,
        COUNT(hl.id) AS harvest_count
      FROM harvest_record hl
      JOIN batch b ON hl.batch_id = b.id
      JOIN species s ON b.species_id = s.id
      LEFT JOIN substrate_recipe r ON b.recipe_id = r.id
      WHERE hl.biological_efficiency IS NOT NULL
      GROUP BY s.id, r.id
      ORDER BY s.common_name, r.name
    `).all() as PerformanceMatrixRow[];

    res.json(rows);
  } catch (err) {
    console.error('[API] GET /analytics/performance error:', err);
    res.status(500).json({ error: 'Failed to fetch performance analytics' });
  }
});

export interface PcRunAnalyticsRow {
  pc_run_id: number;
  run_date: string;
  run_type: string;
  bag_count: number;
  contam_count: number;
  contam_rate: number;
}

/**
 * GET /api/analytics/pc-runs
 * Returns PC run history and contamination rate per run
 */
router.get('/pc-runs', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        p.id AS pc_run_id,
        p.scheduled_date AS run_date,
        p.run_type,
        p.bag_count,
        (SELECT COUNT(*) FROM contam_log c WHERE c.pc_run_id = p.id) AS contam_count,
        CASE WHEN p.bag_count > 0 
          THEN ROUND(CAST((SELECT COUNT(*) FROM contam_log c WHERE c.pc_run_id = p.id) AS REAL) / p.bag_count, 4) 
          ELSE 0 END AS contam_rate
      FROM pc_run p
      WHERE p.status = 'COMPLETE'
      ORDER BY p.scheduled_date DESC
      LIMIT 20
    `).all() as PcRunAnalyticsRow[];

    res.json(rows);
  } catch (err) {
    console.error('[API] GET /analytics/pc-runs error:', err);
    res.status(500).json({ error: 'Failed to fetch PC run analytics' });
  }
});

export default router;
