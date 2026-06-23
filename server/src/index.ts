import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { migrate } from './db/database';
import tasksRouter from './routes/tasks';
import schedulerRouter from './routes/scheduler';
import settingsRouter from './routes/settings';
import inventoryRouter from './routes/inventory';
import batchesRouter from './routes/batches';
import speciesRouter from './routes/species';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── MIDDLEWARE ────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',') 
  : ['http://localhost:5173', 'http://localhost', 'https://localhost', 'capacitor://localhost'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// ── DATABASE INIT ─────────────────────────────────────────────
// Apply schema on every startup (idempotent CREATE IF NOT EXISTS)
migrate(false);


// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/tasks',     tasksRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/settings',  settingsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/batches',   batchesRouter);
app.use('/api/species',   speciesRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── STATIC ASSETS (PRODUCTION) ────────────────────────────────
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? path.resolve(__dirname, '../../../../client/dist');
app.use(express.static(PUBLIC_DIR));

// Fallback to React app index.html for SPA routes (any non-API request)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── CRON JOBS ─────────────────────────────────────────────────
// Daily at 6 AM: run scheduler to update 28-day horizon
cron.schedule('0 6 * * *', async () => {
  console.log('[CRON] Running daily scheduler refresh...');
  try {
    const { runScheduler } = await import('./scheduler/runner');
    await runScheduler('CRON');
    console.log('[CRON] Scheduler complete.');
  } catch (err) {
    console.error('[CRON] Scheduler error:', err);
  }
});

// Daily at midnight: expire fridge bags older than 90 days
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Checking fridge expiry...');
  try {
    const { expireFridgeBags } = await import('./scheduler/fridgeManager');
    expireFridgeBags();
    console.log('[CRON] Fridge expiry check complete.');
  } catch (err) {
    console.error('[CRON] Fridge expiry error:', err);
  }
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🍄 MycoScheduler API running on http://localhost:${PORT}`);
  console.log(`   Horizon:  28 days`);
  console.log(`   Cron:     Daily refresh at 06:00\n`);
});

export default app;
