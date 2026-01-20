-- Material Migration & Normalization Script
-- Run this after installing the wpgraphql-materials.php mu-plugin
--
-- Usage: mysql -u [user] -p [database] < migrate-materials.sql
--
-- This script:
-- 1. Creates material taxonomy terms from _wt_material meta
-- 2. Normalizes duplicate/variant material names
-- 3. Removes non-material entries
-- 4. Links products to their material terms

-- ============================================
-- STEP 1: Create initial terms from meta data
-- ============================================

-- Create temporary table with all unique materials (splitting by comma)
DROP TEMPORARY TABLE IF EXISTS temp_materials;
CREATE TEMPORARY TABLE temp_materials (
    material VARCHAR(255),
    slug VARCHAR(255)
);

INSERT INTO temp_materials (material, slug)
SELECT DISTINCT
    TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(pm.meta_value, ',', n.n), ',', -1)) as material,
    LOWER(REPLACE(REPLACE(REPLACE(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(pm.meta_value, ',', n.n), ',', -1)), ' ', '-'), '/', '-'), '--', '-')) as slug
FROM wp_postmeta pm
CROSS JOIN (
    SELECT 1 as n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
    UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10
) n
WHERE pm.meta_key = '_wt_material'
AND pm.meta_value != ''
AND CHAR_LENGTH(pm.meta_value) - CHAR_LENGTH(REPLACE(pm.meta_value, ',', '')) >= n.n - 1
HAVING material != '' AND material IS NOT NULL;

-- Insert terms that don't already exist
INSERT INTO wp_terms (name, slug)
SELECT tm.material, tm.slug
FROM temp_materials tm
LEFT JOIN wp_terms t ON t.slug = tm.slug
WHERE t.term_id IS NULL
GROUP BY tm.material, tm.slug;

-- Insert term_taxonomy entries for the new terms
INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
SELECT t.term_id, 'product_material', '', 0, 0
FROM wp_terms t
INNER JOIN temp_materials tm ON t.slug = tm.slug
LEFT JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id AND tt.taxonomy = 'product_material'
WHERE tt.term_taxonomy_id IS NULL
GROUP BY t.term_id;

-- Create term relationships (link products to materials)
INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id)
SELECT DISTINCT pm.post_id, tt.term_taxonomy_id
FROM wp_postmeta pm
CROSS JOIN (
    SELECT 1 as n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
    UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10
) n
INNER JOIN wp_posts p ON pm.post_id = p.ID
INNER JOIN wp_terms t ON t.slug = LOWER(REPLACE(REPLACE(REPLACE(
    TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(pm.meta_value, ',', n.n), ',', -1)),
    ' ', '-'), '/', '-'), '--', '-'))
INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id AND tt.taxonomy = 'product_material'
WHERE pm.meta_key = '_wt_material'
AND pm.meta_value != ''
AND p.post_type = 'product'
AND CHAR_LENGTH(pm.meta_value) - CHAR_LENGTH(REPLACE(pm.meta_value, ',', '')) >= n.n - 1;

-- ============================================
-- STEP 2: Fix variation relationships
-- ============================================

-- Move relationships from variations to parent products
INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id)
SELECT DISTINCT p.post_parent, tr.term_taxonomy_id
FROM wp_term_relationships tr
JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
JOIN wp_posts p ON tr.object_id = p.ID
WHERE tt.taxonomy = 'product_material'
AND p.post_type = 'product_variation'
AND p.post_parent > 0;

-- Remove relationships pointing to variations
DELETE tr FROM wp_term_relationships tr
JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
JOIN wp_posts p ON tr.object_id = p.ID
WHERE tt.taxonomy = 'product_material'
AND p.post_type = 'product_variation';

-- ============================================
-- STEP 3: Normalize material names
-- ============================================

DROP TEMPORARY TABLE IF EXISTS material_merge_map;
CREATE TEMPORARY TABLE material_merge_map (
    old_name VARCHAR(255),
    new_name VARCHAR(255)
);

-- ABS Plastic variants
INSERT INTO material_merge_map VALUES
('Abs', 'ABS Plastic'), ('ABS / Latex', 'ABS Plastic'), ('ABS / PU', 'ABS Plastic'),
('ABS / Silver Plating', 'ABS Plastic'), ('ABS Plastic / Rubber Cote', 'ABS Plastic'),
('ABS Plastic Silver Plating', 'ABS Plastic'), ('ABS Plastic with Silver Plating', 'ABS Plastic'),
('ABS Silver Plating', 'ABS Plastic'), ('ABS with Silver Plating', 'ABS Plastic'), ('AS', 'ABS Plastic'),
('Abs Plastic', 'ABS Plastic');

-- Aluminum variants
INSERT INTO material_merge_map VALUES
('Alumimum', 'Aluminum'), ('Aluminium', 'Aluminum'), ('Aluminum Alloy', 'Aluminum'), ('Alloy', 'Aluminum');

-- TPE variants
INSERT INTO material_merge_map VALUES
('Tpe', 'TPE'), ('Thermoplastic Elastomer', 'TPE'), ('Thermoplastic Elastomer TPE', 'TPE'),
('Thermoplastic Elastomers', 'TPE'), ('Thermoplastic Elastomers Tpe', 'TPE'),
('Fanta Flesh TPE', 'TPE'), ('Fanta Flesh', 'TPE');

-- TPR variants
INSERT INTO material_merge_map VALUES
('Tpr', 'TPR'), ('Thermoplastic Rubber', 'TPR'), ('Thermoplastic Rubber Tpr', 'TPR'),
('Thermoplastic Rubber TPR ABS Plastic', 'TPR'), ('Thermoplastic RubberTPR', 'TPR'),
('Thermoplastic Elastomers TPR', 'TPR'), ('FlexTPR', 'TPR'), ('Sensa Feel Tpr', 'TPR'),
('Senso TPR', 'TPR'), ('Pure Skin TPR', 'TPR'), ('Pure Skin Thermoplastic Rubber TPR', 'TPR'),
('Pure Skin', 'TPR'), ('TPR Blend', 'TPR');

-- Silicone variants
INSERT INTO material_merge_map VALUES
('Silicone Blend', 'Silicone'), ('Silicone Silk', 'Silicone'), ('PFBLEND Silicone', 'Silicone'),
('Sil-A-Gel', 'Silicone'), ('SilaSkin', 'Silicone'), ('Si', 'Silicone');

-- PVC variants
INSERT INTO material_merge_map VALUES
('Pvc', 'PVC'), ('PVC Plastic', 'PVC'), ('Better-Than-Real PVC', 'PVC');

-- Polyurethane variants
INSERT INTO material_merge_map VALUES
('Polyurethane Pu', 'Polyurethane'), ('Polyurethane PU Rubber Cote', 'Polyurethane'),
('Polyurethane sprayed over ABS', 'Polyurethane'), ('Pu', 'Polyurethane'),
('PU Coating', 'Polyurethane'), ('PU cote', 'Polyurethane'), ('TPU', 'Polyurethane');

-- Faux Leather variants
INSERT INTO material_merge_map VALUES
('PU Faux Leather', 'Faux Leather'), ('PU Leather', 'Faux Leather'),
('Vegan Leather', 'Faux Leather'), ('Leatherette', 'Faux Leather');

-- Polypropylene variants
INSERT INTO material_merge_map VALUES
('PP', 'Polypropylene'), ('Polypropylene PP', 'Polypropylene'), ('Polyproplyene', 'Polypropylene'),
('Polyproylene PP', 'Polypropylene'), ('PP / Gold Plating', 'Polypropylene'),
('PP Fiber', 'Polypropylene'), ('PP. Metal', 'Polypropylene');

-- Polyester variants
INSERT INTO material_merge_map VALUES
('Poyester', 'Polyester'), ('Polyester Blend', 'Polyester'), ('Polyester Velvet', 'Polyester'),
('95%polyester 5%spandex', 'Polyester');

-- Polycarbonate variants
INSERT INTO material_merge_map VALUES
('Polycarbonate Pc', 'Polycarbonate'), ('PC', 'Polycarbonate');

-- Glass variants
INSERT INTO material_merge_map VALUES
('glass', 'Glass'), ('Borosilicate Glass', 'Glass'), ('Glass Fiber', 'Glass'), ('Ffiberglass', 'Fiberglass');

-- Steel variants
INSERT INTO material_merge_map VALUES
('Stainless Steel', 'Steel'), ('Anodized Steel', 'Steel'), ('Electro Plated Steel', 'Steel');

-- Feather variants
INSERT INTO material_merge_map VALUES
('feather', 'Feathers'), ('ostrich feather', 'Feathers'), ('Turkey Feathers', 'Feathers');

-- Crystal variants
INSERT INTO material_merge_map VALUES ('Crystal', 'Crystals');

-- Elastomer variants
INSERT INTO material_merge_map VALUES
('elastomers', 'Elastomer'), ('Elastan', 'Elastomer'), ('Elastane', 'Elastomer'),
('Elastine', 'Elastomer'), ('SEBS', 'Elastomer');

-- Wax variants
INSERT INTO material_merge_map VALUES
('Microcrystalline wax', 'Wax'), ('Paraffin Wax', 'Wax'), ('Parafin Wax', 'Wax'),
('Soy Wax', 'Wax'), ('Synthetic Wax', 'Wax');

-- Nickel-free variants
INSERT INTO material_merge_map VALUES
('Nickel', 'Nickel Free Metal'), ('Nickel free', 'Nickel Free Metal'),
('Nickel free Alloy', 'Nickel Free Metal'), ('Nickel free Alloy Metal', 'Nickel Free Metal');

-- Nylon variants
INSERT INTO material_merge_map VALUES
('62% Nylon', 'Nylon'), ('Fishnet Nylon', 'Nylon'), ('nylon webbing', 'Nylon'), ('Nylon/Spandex', 'Nylon');

-- Spandex variants
INSERT INTO material_merge_map VALUES
('Spandex (fabric) 13% Polyester', 'Spandex'), ('Spandex Blend', 'Spandex');

-- Fur variants
INSERT INTO material_merge_map VALUES
('Fur', 'Faux Fur'), ('Imitation Fur', 'Faux Fur');

-- Faux Gems
INSERT INTO material_merge_map VALUES ('Faux Gem', 'Faux Gems');

-- Edibles variants
INSERT INTO material_merge_map VALUES
('Edible Body Paint', 'Edibles'), ('edible body paints', 'Edibles'),
('Body Paints', 'Edibles'), ('Chocolate Body Paints', 'Edibles');

-- Candy variants
INSERT INTO material_merge_map VALUES
('Adult Candy', 'Candy'), ('Chocolate Candy', 'Candy'), ('Hard Candy', 'Candy'),
('Marshmallow Candies', 'Candy'), ('Milk Chocolate', 'Candy'), ('Fruit Gummy', 'Gummy');

-- Lubricant variants
INSERT INTO material_merge_map VALUES
('Aloe Lubricant', 'Lubricant'), ('Organic Lubricant', 'Lubricant'),
('Personal Lubricant', 'Lubricant'), ('Organic - Lubes', 'Lubricant'),
('Hybrid Lube', 'Lubricant'), ('Water Based Lubricant', 'Lubricant'),
('Silicone Based Lubricant', 'Lubricant');

-- Misc cleanups
INSERT INTO material_merge_map VALUES
('alkaline batteries', 'Alkaline'), ('anti-bacterial cleaner', 'Antibacterial'),
('Vinyln', 'Vinyl'), ('cardboard', 'Cardboard'), ('dvd', 'DVD'), ('game', 'Game'),
('l', 'Lycra'), ('promotional sign', 'Sign'), ('Plastic Sign', 'Sign'), ('Retail Display', 'Sign'),
('Real Skin', 'Bioskin'), ('Ultraskyn', 'Bioskin'), ('Vixskin', 'Bioskin'),
('Water-Based', 'Water');

-- Non-material entries to remove
INSERT INTO material_merge_map VALUES
('Catalog', NULL), ('Adult Games', NULL), ('Cuffs', NULL), ('Luv Cuffs', NULL),
('Sexual Enhancers', NULL), ('Sensual Enhancement', NULL), ('Shave Cream', NULL),
('Coochy Shave Cream', NULL), ('See ingredients in description', NULL), ('Testers', NULL),
('Get Lucky', NULL), ('Earthly Body - Edible Oil Gift Set', NULL),
('Furry Holiday Bagathers', NULL), ('Intramed', NULL), ('Kirite', NULL),
('Kraft Cheese', NULL), ('Bath Bomb', NULL), ('Bath Salts', NULL), ('Cleaner', NULL),
('Confetti', NULL), ('Massage Oil', NULL), ('Scented Diffusers', NULL),
('Synthetic Urine', NULL), ('Metallic Dice', NULL), ('Lidocaine', NULL), ('CBD', NULL),
('Herbs', NULL), ('Mixed Berry Flavor', NULL), ('Mint', NULL), ('Honey', NULL),
('Cocoa Butter', NULL), ('Royal Jelly', NULL), ('Shea Butter', NULL), ('Vitamin E', NULL),
('Aloe Vera', NULL), ('Aloe Vera  - Organic', NULL), ('Natural', NULL),
('paperback book', NULL), ('Card Stock Paper', NULL), ('Paper', NULL), ('Sign', NULL),
('Tape', NULL), ('Paper Plates', NULL), ('Mylar', NULL), ('Tulle', NULL),
('Sheer Mesh', NULL), ('Crochet', NULL), ('Cotton blend', NULL), ('Hemp', NULL),
('Wheat', NULL), ('Non-Stick Tape', NULL), ('Body Powder', NULL), ('Denim', NULL),
('Jersey', NULL), ('Cloth', NULL), ('Liquid', NULL), ('lamb skin', NULL), ('Wires', NULL),
('Fabric Glove', NULL), ('Glue', NULL), ('Rayon', NULL), ('Faux Hair', NULL),
('Faux Tail', NULL), ('Fleece', NULL), ('Ribbon', NULL), ('Ropes', NULL),
('Rhinestones', NULL), ('HookLoop', NULL), ('Mineral Oil', NULL), ('GPPS', NULL),
('Gold Plated', NULL), ('Manganese Alloy', NULL), ('hydrogenated Styrene', NULL),
('Ovc', NULL), ('Gel', NULL);

-- Create canonical terms if they don't exist
INSERT IGNORE INTO wp_terms (name, slug)
SELECT DISTINCT mm.new_name, LOWER(REPLACE(REPLACE(mm.new_name, ' ', '-'), '/', '-'))
FROM material_merge_map mm
WHERE mm.new_name IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM wp_terms t2
    JOIN wp_term_taxonomy tt2 ON t2.term_id = tt2.term_id
    WHERE t2.name = mm.new_name AND tt2.taxonomy = 'product_material'
);

-- Create term_taxonomy for new canonical terms
INSERT IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
SELECT t.term_id, 'product_material', '', 0, 0
FROM wp_terms t
LEFT JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id AND tt.taxonomy = 'product_material'
WHERE tt.term_taxonomy_id IS NULL
AND t.name IN (SELECT DISTINCT new_name FROM material_merge_map WHERE new_name IS NOT NULL);

-- Move relationships from old terms to new canonical terms
INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id)
SELECT tr.object_id, tt_new.term_taxonomy_id
FROM wp_term_relationships tr
JOIN wp_term_taxonomy tt_old ON tr.term_taxonomy_id = tt_old.term_taxonomy_id
JOIN wp_terms t_old ON tt_old.term_id = t_old.term_id
JOIN material_merge_map mm ON t_old.name = mm.old_name
JOIN wp_terms t_new ON t_new.name = mm.new_name
JOIN wp_term_taxonomy tt_new ON t_new.term_id = tt_new.term_id AND tt_new.taxonomy = 'product_material'
WHERE tt_old.taxonomy = 'product_material'
AND mm.new_name IS NOT NULL;

-- Delete relationships for terms being removed or merged
DELETE tr FROM wp_term_relationships tr
JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
JOIN wp_terms t ON tt.term_id = t.term_id
WHERE tt.taxonomy = 'product_material'
AND t.name IN (SELECT old_name FROM material_merge_map);

-- Delete term_taxonomy entries for old terms
DELETE tt FROM wp_term_taxonomy tt
JOIN wp_terms t ON tt.term_id = t.term_id
WHERE tt.taxonomy = 'product_material'
AND t.name IN (SELECT old_name FROM material_merge_map);

-- ============================================
-- STEP 4: Cleanup and recalculate counts
-- ============================================

-- Clean up orphaned terms
DELETE t FROM wp_terms t
LEFT JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.term_id IS NULL;

-- Recalculate counts (only published products)
UPDATE wp_term_taxonomy tt
SET count = (
    SELECT COUNT(DISTINCT tr.object_id)
    FROM wp_term_relationships tr
    JOIN wp_posts p ON tr.object_id = p.ID
    WHERE tr.term_taxonomy_id = tt.term_taxonomy_id
    AND p.post_type = 'product'
    AND p.post_status = 'publish'
)
WHERE tt.taxonomy = 'product_material';

-- Remove terms with zero count
DELETE tt FROM wp_term_taxonomy tt
WHERE tt.taxonomy = 'product_material' AND tt.count = 0;

-- Final cleanup of orphaned terms
DELETE t FROM wp_terms t
LEFT JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.term_id IS NULL;

-- ============================================
-- VERIFICATION
-- ============================================

SELECT 'Migration complete!' as status;
SELECT COUNT(*) as 'Total material terms' FROM wp_term_taxonomy WHERE taxonomy = 'product_material';
SELECT COUNT(*) as 'Total product-material links' FROM wp_term_relationships tr
JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
WHERE tt.taxonomy = 'product_material';

-- Show top 10 materials
SELECT t.name, tt.count
FROM wp_terms t
JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'product_material'
ORDER BY tt.count DESC
LIMIT 10;
