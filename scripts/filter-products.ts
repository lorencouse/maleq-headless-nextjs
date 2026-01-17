import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Load allowed product types
const productTypesPath = join(__dirname, "../data/product-types.json");
const productTypes = JSON.parse(readFileSync(productTypesPath, "utf-8"));
const allowedTypeCodes = new Set(
  productTypes.types.map((t: { code: string }) => t.code)
);

console.log("Allowed type codes:", [...allowedTypeCodes]);

// Read the XML file
const xmlPath = join(__dirname, "../data/products.xml");
const xml = readFileSync(xmlPath, "utf-8");

// Extract all products using regex
const productRegex = /<product[^>]*>[\s\S]*?<\/product>/g;
const products = xml.match(productRegex) || [];

console.log(`Total products found: ${products.length}`);

// Filter products by type code
const filteredProducts: string[] = [];
const excludedByType: Record<string, number> = {};

for (const product of products) {
  // Extract type code from product
  const typeMatch = product.match(/<type\s+code="([^"]+)"/);
  const typeCode = typeMatch ? typeMatch[1] : null;

  if (typeCode && allowedTypeCodes.has(typeCode)) {
    filteredProducts.push(product);
  } else {
    // Track excluded types for reporting
    const key = typeCode || "NO_TYPE";
    excludedByType[key] = (excludedByType[key] || 0) + 1;
  }
}

console.log(`\nFiltered products: ${filteredProducts.length}`);
console.log(`Excluded products: ${products.length - filteredProducts.length}`);
console.log("\nExcluded by type:");
Object.entries(excludedByType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

// Build new XML
const outputXml = `<?xml version="1.0" encoding="UTF-8"?>
<products>
${filteredProducts.join("\n")}
</products>
`;

// Write filtered XML
const outputPath = join(__dirname, "../data/products-filtered.xml");
writeFileSync(outputPath, outputXml, "utf-8");

console.log(`\nFiltered XML written to: ${outputPath}`);
