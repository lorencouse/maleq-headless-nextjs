#!/bin/bash

# WP-CLI Script to Import Category Hierarchy to WooCommerce
# Run this on your WordPress server with: bash import-categories-wp-cli.sh

# This script reads the category-hierarchy.json file and creates WooCommerce product categories
# It processes categories level by level to ensure parent-child relationships are correct

echo "🚀 Starting WooCommerce category import..."
echo ""

# Check if wp-cli is installed
if ! command -v wp &> /dev/null; then
    echo "❌ Error: WP-CLI is not installed. Please install it first."
    echo "Visit: https://wp-cli.org/#installing"
    exit 1
fi

# Check if we're in a WordPress directory
if ! wp core is-installed 2>/dev/null; then
    echo "❌ Error: Not in a WordPress directory or WordPress is not installed."
    echo "Please run this script from your WordPress root directory."
    exit 1
fi

# Read category hierarchy JSON
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JSON_FILE="$SCRIPT_DIR/../data/category-hierarchy.json"

if [ ! -f "$JSON_FILE" ]; then
    echo "❌ Error: category-hierarchy.json not found at $JSON_FILE"
    exit 1
fi

echo "📂 Found category hierarchy file"
echo ""

# Create a temporary PHP script to parse JSON and create categories
cat > /tmp/import-woo-categories.php << 'PHPEOF'
<?php
// Load WordPress
require_once('wp-load.php');

// Read JSON file
$json_file = $argv[1] ?? '';
if (!file_exists($json_file)) {
    die("Error: JSON file not found: $json_file\n");
}

$data = json_decode(file_get_contents($json_file), true);
if (!$data) {
    die("Error: Could not parse JSON file\n");
}

$stats = [
    'created' => 0,
    'updated' => 0,
    'failed' => 0,
    'total' => 0
];

// Store mapping of code => term_id
$code_to_id = [];

// Get max level
$max_level = max(array_keys($data['levels']));

echo "📊 Processing " . count($data['levels']) . " levels of categories\n\n";

// Process level by level
for ($level = 0; $level <= $max_level; $level++) {
    $categories = $data['levels'][$level] ?? [];
    echo "Level $level: " . count($categories) . " categories\n";

    foreach ($categories as $category) {
        $stats['total']++;
        $code = $category['code'];
        $name = $category['name'];
        $parent_code = $category['parent'];

        // Generate slug from code
        $slug = 'cat-' . $code;

        // Determine parent ID
        $parent_id = 0;
        if ($parent_code !== '0' && isset($code_to_id[$parent_code])) {
            $parent_id = $code_to_id[$parent_code];
        }

        // Check if category already exists
        $existing = term_exists($slug, 'product_cat');

        if ($existing) {
            // Update existing category
            $term_id = is_array($existing) ? $existing['term_id'] : $existing;
            wp_update_term($term_id, 'product_cat', [
                'name' => $name,
                'parent' => $parent_id
            ]);
            $code_to_id[$code] = $term_id;
            $stats['updated']++;
            echo "  ✏️  Updated: [$code] $name\n";
        } else {
            // Create new category
            $result = wp_insert_term($name, 'product_cat', [
                'slug' => $slug,
                'parent' => $parent_id
            ]);

            if (is_wp_error($result)) {
                echo "  ❌ Failed: [$code] $name - " . $result->get_error_message() . "\n";
                $stats['failed']++;
            } else {
                $code_to_id[$code] = $result['term_id'];
                $stats['created']++;
                echo "  ➕ Created: [$code] $name\n";
            }
        }
    }

    echo "\n";
}

// Final stats
echo "✅ Import Complete!\n";
echo "   Total: {$stats['total']} | Created: {$stats['created']} | Updated: {$stats['updated']} | Failed: {$stats['failed']}\n";
PHPEOF

# Run the PHP script
echo "🔄 Importing categories using WP-CLI..."
php /tmp/import-woo-categories.php "$JSON_FILE"

# Clean up
rm /tmp/import-woo-categories.php

echo ""
echo "✨ Done! Check your WooCommerce → Products → Categories in WordPress admin."
