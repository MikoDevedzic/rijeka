-- ============================================================
-- Rijeka — Insert book nodes under each desk
-- Run in Supabase SQL Editor
-- ============================================================

-- First, let's see what desk IDs we have
-- (run this SELECT first to confirm desk IDs before inserting)

SELECT id, name, node_type FROM org_nodes WHERE node_type = 'desk' ORDER BY name;

-- ============================================================
-- Insert books under each desk
-- Uses subqueries to find parent desk ID dynamically
-- ============================================================

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'G10 RATES', 'book', id, true, 1
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'EM RATES', 'book', id, true, 2
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'INFLATION', 'book', id, true, 3
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'XVA RATES', 'book', id, true, 4
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- FX TRADING books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'G10 FX', 'book', id, true, 1
FROM org_nodes WHERE name = 'FX TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'EM FX', 'book', id, true, 2
FROM org_nodes WHERE name = 'FX TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'FX OPTIONS', 'book', id, true, 3
FROM org_nodes WHERE name = 'FX TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- CREDIT TRADING books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'INVESTMENT GRADE', 'book', id, true, 1
FROM org_nodes WHERE name = 'CREDIT TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'HIGH YIELD', 'book', id, true, 2
FROM org_nodes WHERE name = 'CREDIT TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'CDS & INDICES', 'book', id, true, 3
FROM org_nodes WHERE name = 'CREDIT TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- COMMODITIES TRADING books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'ENERGY', 'book', id, true, 1
FROM org_nodes WHERE name = 'COMMODITIES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'METALS', 'book', id, true, 2
FROM org_nodes WHERE name = 'COMMODITIES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'EMISSIONS', 'book', id, true, 3
FROM org_nodes WHERE name = 'COMMODITIES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- EQUITY DERIVATIVES books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'SINGLE STOCK', 'book', id, true, 1
FROM org_nodes WHERE name = 'EQUITY DERIVATIVES' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'INDEX & VOLATILITY', 'book', id, true, 2
FROM org_nodes WHERE name = 'EQUITY DERIVATIVES' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'DIVIDEND SWAPS', 'book', id, true, 3
FROM org_nodes WHERE name = 'EQUITY DERIVATIVES' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- XVA DESK books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'CVA/DVA', 'book', id, true, 1
FROM org_nodes WHERE name = 'XVA DESK' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'FVA & COLVA', 'book', id, true, 2
FROM org_nodes WHERE name = 'XVA DESK' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'MVA', 'book', id, true, 3
FROM org_nodes WHERE name = 'XVA DESK' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- Verify
SELECT
  d.name as desk,
  b.name as book,
  b.sort_order
FROM org_nodes b
JOIN org_nodes d ON b.parent_id = d.id
WHERE b.node_type = 'book'
ORDER BY d.name, b.sort_order;
