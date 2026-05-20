ALTER TABLE po_line_items DROP CONSTRAINT IF EXISTS fk_po_line_items_product;
ALTER TABLE po_line_items DROP CONSTRAINT IF EXISTS po_line_items_product_id_fkey;
ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS description text NULL;
ALTER TABLE po_line_items DROP COLUMN IF EXISTS product_id;

DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS stock;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS products;
