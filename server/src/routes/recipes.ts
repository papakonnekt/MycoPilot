import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

// ── GET /api/recipes ──────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const recipes = db.prepare(`
      SELECT r.*, 
        (SELECT json_group_array(json_object(
          'id', ri.id,
          'ingredient', ri.ingredient,
          'amount', ri.amount,
          'unit', ri.unit,
          'notes', ri.notes
        )) FROM recipe_ingredient ri WHERE ri.recipe_id = r.id)
        AS ingredients_json
      FROM substrate_recipe r
      WHERE r.is_active = 1
      ORDER BY r.created_at ASC
    `).all() as any[];

    const recipes_parsed = recipes.map(r => ({
      ...r,
      ingredients: r.ingredients_json ? JSON.parse(r.ingredients_json) : [],
    }));

    res.json({ success: true, data: recipes_parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/recipes/:id ──────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const recipe = db.prepare(`SELECT * FROM substrate_recipe WHERE id = ?`).get(id) as any;
    if (!recipe) return res.status(404).json({ success: false, error: 'Recipe not found' });
    const ingredients = db.prepare(`SELECT * FROM recipe_ingredient WHERE recipe_id = ?`).all(id);
    res.json({ success: true, data: { ...recipe, ingredients } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/recipes ─────────────────────────────────────────
// Body: { name, notes?, ingredients: [{ ingredient, amount?, unit?, notes? }] }
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, notes, ingredients = [] } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Recipe name is required' });
  }

  try {
    const result = db.transaction(() => {
      const r = db.prepare(`
        INSERT INTO substrate_recipe (name, notes) VALUES (?, ?)
      `).run(name.trim(), notes ?? null);
      const recipeId = r.lastInsertRowid;

      const insertIngredient = db.prepare(`
        INSERT INTO recipe_ingredient (recipe_id, ingredient, amount, unit, notes)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const ing of ingredients) {
        insertIngredient.run(
          recipeId,
          ing.ingredient,
          ing.amount ?? null,
          ing.unit ?? null,
          ing.notes ?? null
        );
      }

      return recipeId;
    })();

    res.json({ success: true, data: { id: result } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/recipes/:id ──────────────────────────────────────
// Full replace (delete old ingredients, insert new)
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { name, notes, ingredients = [] } = req.body;

  try {
    db.transaction(() => {
      db.prepare(`UPDATE substrate_recipe SET name = ?, notes = ? WHERE id = ?`)
        .run(name.trim(), notes ?? null, id);
      db.prepare(`DELETE FROM recipe_ingredient WHERE recipe_id = ?`).run(id);

      const insertIngredient = db.prepare(`
        INSERT INTO recipe_ingredient (recipe_id, ingredient, amount, unit, notes)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const ing of ingredients) {
        insertIngredient.run(id, ing.ingredient, ing.amount ?? null, ing.unit ?? null, ing.notes ?? null);
      }
    })();

    res.json({ success: true, message: 'Recipe updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── DELETE /api/recipes/:id ───────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  try {
    db.prepare(`UPDATE substrate_recipe SET is_active = 0 WHERE id = ?`).run(id);
    res.json({ success: true, message: 'Recipe archived' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
