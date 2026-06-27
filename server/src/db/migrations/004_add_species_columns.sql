ALTER TABLE species ADD COLUMN default_recipe_id INTEGER REFERENCES substrate_recipe(id);
ALTER TABLE species ADD COLUMN protocol_markdown TEXT;
