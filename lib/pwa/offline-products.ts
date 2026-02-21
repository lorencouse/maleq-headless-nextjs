/**
 * Offline Product Storage (IndexedDB)
 *
 * Stores product data for offline browsing. Products are saved automatically
 * when viewed and can be retrieved when the user is offline.
 *
 * Separate from the localStorage "recently viewed" widget — this stores
 * more products (up to 100) with richer data for full offline product pages.
 */

const DB_NAME = 'maleq-offline';
const DB_VERSION = 1;
const STORE_NAME = 'products';
const MAX_PRODUCTS = 100;

export interface OfflineProduct {
  slug: string; // primary key
  productId: string;
  name: string;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  shortDescription: string | null;
  image: { url: string; altText: string } | null;
  categories: string[];
  brand: string | null;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'slug' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a product for offline access. Called from TrackRecentlyViewed.
 */
export async function saveProductOffline(product: OfflineProduct): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put({ ...product, savedAt: Date.now() });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();

    // Trim old entries if over limit
    await trimOfflineProducts();
  } catch {
    // IndexedDB may be unavailable in some contexts — fail silently
  }
}

/**
 * Get a single offline product by slug.
 */
export async function getOfflineProduct(slug: string): Promise<OfflineProduct | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(slug);
      request.onsuccess = () => {
        db.close();
        resolve(request.result || null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return null;
  }
}

/**
 * Get all offline products, sorted by most recently saved.
 */
export async function getAllOfflineProducts(): Promise<OfflineProduct[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        db.close();
        const products: OfflineProduct[] = request.result;
        products.sort((a, b) => b.savedAt - a.savedAt);
        resolve(products);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return [];
  }
}

/**
 * Remove the oldest products when over the limit.
 */
async function trimOfflineProducts(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('savedAt');

    const countReq = store.count();
    const count = await new Promise<number>((resolve) => {
      countReq.onsuccess = () => resolve(countReq.result);
    });

    if (count <= MAX_PRODUCTS) {
      db.close();
      return;
    }

    // Delete oldest entries
    const toDelete = count - MAX_PRODUCTS;
    let deleted = 0;

    const cursorReq = index.openCursor(); // ascending = oldest first
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor && deleted < toDelete) {
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    };

    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });

    db.close();
  } catch {
    // Non-critical
  }
}
