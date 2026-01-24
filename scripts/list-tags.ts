// List all tags from WordPress REST API

const WP_BASE = 'http://maleq-local.local';

async function listTags() {
  let allTags: any[] = [];
  let page = 1;
  const perPage = 100;
  
  // Fetch all tags (paginated)
  while (true) {
    const url = `${WP_BASE}/wp-json/wp/v2/tags?per_page=${perPage}&page=${page}`;
    console.log(`Fetching: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Error: ${response.status} ${response.statusText}`);
      break;
    }
    
    const tags = await response.json();
    if (tags.length === 0) break;
    
    allTags = [...allTags, ...tags];
    page++;
    
    if (page > 10) break; // Safety limit
  }
  
  console.log(`\nFound ${allTags.length} tags:\n`);
  
  // Sort alphabetically for easier review
  const sorted = [...allTags].sort((a, b) => 
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
  
  sorted.forEach(tag => {
    console.log(`"${tag.name}" (${tag.count} posts) - id: ${tag.id}, slug: ${tag.slug}`);
  });
  
  // Find potential duplicates (similar names)
  console.log('\n\n=== POTENTIAL DUPLICATES (same when normalized) ===\n');
  const normalized = new Map();
  
  sorted.forEach(tag => {
    const key = tag.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (!normalized.has(key)) {
      normalized.set(key, []);
    }
    normalized.get(key).push(tag);
  });
  
  normalized.forEach((tags, key) => {
    if (tags.length > 1) {
      console.log(`Duplicates for "${key}":`);
      tags.forEach(t => console.log(`  - "${t.name}" (${t.count} posts) [id: ${t.id}]`));
      console.log('');
    }
  });
  
  // Find casing inconsistencies
  console.log('\n=== CASING INCONSISTENCIES ===\n');
  const lowerMap = new Map();
  sorted.forEach(tag => {
    const lower = tag.name.toLowerCase().trim();
    if (!lowerMap.has(lower)) {
      lowerMap.set(lower, []);
    }
    lowerMap.get(lower).push(tag);
  });
  
  lowerMap.forEach((tags, key) => {
    if (tags.length > 1) {
      console.log(`Casing variants for "${key}":`);
      tags.forEach(t => console.log(`  - "${t.name}" (${t.count} posts) [id: ${t.id}]`));
      console.log('');
    }
  });
}

listTags().catch(console.error);
