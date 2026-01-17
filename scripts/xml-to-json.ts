import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Read the filtered XML file
const xmlPath = join(__dirname, "../data/products-filtered.xml");
const xml = readFileSync(xmlPath, "utf-8");

// Load product types for type lookup
const productTypesPath = join(__dirname, "../data/product-types.json");
const productTypes = JSON.parse(readFileSync(productTypesPath, "utf-8"));
const typesByCode = new Map(
  productTypes.types.map((t: any) => [t.code, t])
);

// Helper to extract text content from XML element
function extractText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return "";
  // Clean CDATA wrapper if present
  let text = match[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
  return text.trim();
}

// Helper to extract attribute from tag
function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : "";
}

// Helper to extract all images
function extractImages(xml: string, sku: string): any[] {
  const imagesMatch = xml.match(/<images>([\s\S]*?)<\/images>/);
  if (!imagesMatch) return [];

  const imageRegex = /<image>([^<]+)<\/image>/g;
  const images: any[] = [];
  let match;
  let id = 1;

  while ((match = imageRegex.exec(imagesMatch[1])) !== null) {
    const path = match[1].trim();
    const filename = path.split("/").pop() || "";
    const baseUrl = `http://images.williams-trading.com/product_images${path}`;
    const dir = path.substring(0, path.lastIndexOf("/"));

    images.push({
      id: String(id++),
      product_id: "",  // Will be set later if needed
      filename,
      image_url: baseUrl,
      image_thumb_url: `http://images.williams-trading.com/product_images${dir}/thumb/${filename}`,
      image_medium_url: `http://images.williams-trading.com/product_images${dir}/medium/${filename}`,
      image_large_url: `http://images.williams-trading.com/product_images${dir}/large/${filename}`,
      file_type: "image/jpeg",
      alt_text: "",
      description: "",
      explicit: "0",
      primary: id === 2 ? "1" : "0",  // First image is primary
      created_on: null,
      updated_on: null
    });
  }

  return images;
}

// Helper to extract categories
function extractCategories(xml: string): any[] {
  const categoriesMatch = xml.match(/<categories>([\s\S]*?)<\/categories>/);
  if (!categoriesMatch) return [];

  const categoryRegex = /<category\s+code="([^"]*)"\s+video="([^"]*)"\s+parent="([^"]*)"[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/category>/g;
  const categories: any[] = [];
  let match;

  while ((match = categoryRegex.exec(categoriesMatch[1])) !== null) {
    categories.push({
      id: match[1],
      code: match[1],
      name: match[4].trim(),
      video: match[2],
      parent_id: match[3] || null
    });
  }

  return categories;
}

// Extract manufacturer info
function extractManufacturer(xml: string): any {
  const mfrMatch = xml.match(/<manufacturer\s+code="([^"]*)"\s+video="([^"]*)"[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/manufacturer>/);
  if (!mfrMatch) return null;

  return {
    id: "",
    code: mfrMatch[1],
    name: mfrMatch[3].trim(),
    active: "1",
    video: mfrMatch[2]
  };
}

// Extract type info
function extractType(xml: string): any {
  const typeMatch = xml.match(/<type\s+code="([^"]*)"\s+video="([^"]*)"[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/type>/);
  if (!typeMatch) return null;

  const code = typeMatch[1];
  const typeData = typesByCode.get(code);

  if (typeData) {
    return typeData;
  }

  return {
    id: "",
    code: code,
    name: typeMatch[3].trim(),
    description: null,
    max_discount_rate: "0",
    video: typeMatch[2],
    active: "1"
  };
}

// Parse a single product
function parseProduct(productXml: string): any {
  const sku = extractText(productXml, "sku");
  const typeData = extractType(productXml);

  return {
    id: "",  // Not in XML
    sku,
    name: extractText(productXml, "name"),
    description: extractText(productXml, "description"),
    keywords: extractText(productXml, "keywords"),
    price: extractText(productXml, "price"),
    active: extractAttr(productXml, "product", "active"),
    manufacturer_id: "",  // Not directly in XML
    barcode: extractText(productXml, "barcode"),
    stock_quantity: extractText(productXml, "stock_quantity"),
    reorder_quantity: extractText(productXml, "reorder_quantity"),
    video: "0",
    on_sale: extractAttr(productXml, "product", "on_sale"),
    height: extractText(productXml, "height"),
    length: extractText(productXml, "length"),
    width: "0",
    diameter: extractText(productXml, "diameter"),
    weight: extractText(productXml, "weight"),
    color: extractText(productXml, "color"),
    material: extractText(productXml, "material"),
    release_date: extractText(productXml, "release_date"),
    created_on: null,
    updated_on: null,
    discountable: extractAttr(productXml, "product", "discountable"),
    max_discount_rate: "0",
    type_id: typeData?.id || "",
    saleable: "1",
    product_length: "0",
    insertable_length: "0",
    realistic: "0",
    balls: "0",
    suction_cup: "0",
    harness: "0",
    vibrating: "0",
    thick: "0",
    double_ended: "0",
    circumference: "0",
    brand: "",
    video_embed: "",
    map_price: "0",
    amazon_restricted: "0",
    approval_required: "0",
    images: extractImages(productXml, sku),
    categories: extractCategories(productXml),
    manufacturer: extractManufacturer(productXml),
    type: typeData
  };
}

// Extract all products
const productRegex = /<product[^>]*>[\s\S]*?<\/product>/g;
const products = xml.match(productRegex) || [];

console.log(`Parsing ${products.length} products...`);

const jsonProducts = products.map((p, i) => {
  if ((i + 1) % 1000 === 0) {
    console.log(`  Processed ${i + 1} products...`);
  }
  return parseProduct(p);
});

const output = {
  fields: null,
  products: jsonProducts
};

// Write output
const outputPath = join(__dirname, "../data/products-filtered.json");
writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

console.log(`\nConverted ${jsonProducts.length} products to JSON`);
console.log(`Output written to: ${outputPath}`);
