const INVENTORY_CACHE_KEY = 'bestbefore_inventory_cache';
const RECENT_SCANS_KEY = 'bestbefore_recent_scans';
const CACHE_TIMESTAMP_KEY = 'bestbefore_inventory_timestamp';

export interface CachedItem {
  id: string;
  name: string;
  barcode?: string;
  category?: string;
  expiryDate?: string;
  quantity?: number;
}

export interface RecentScan {
  barcode: string;
  name?: string;
  category?: string;
  expiryDate?: string;
}

// Check if window/localStorage is available (prevents SSR/build errors)
const isBrowser = typeof window !== 'undefined';

/**
 * Get preloaded inventory from localStorage
 */
export const getStoredInventory = (): CachedItem[] | null => {
  if (!isBrowser || !window.localStorage) return null;
  try {
    const data = localStorage.getItem(INVENTORY_CACHE_KEY);
    return data ? (JSON.parse(data) as CachedItem[]) : null;
  } catch (error) {
    console.error('Error reading inventory cache:', error);
    return null;
  }
};

/**
 * Save fresh inventory to localStorage
 */
export const setStoredInventory = (items: CachedItem[]): void => {
  if (!isBrowser || !window.localStorage) return;
  try {
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, new Date().toISOString());
  } catch (error) {
    console.warn('LocalStorage quota exceeded or restricted:', error);
  }
};

/**
 * Cache recent barcode scans in sessionStorage (clears when browser tab closes)
 */
export const cacheRecentScan = (scan: RecentScan): void => {
  if (!isBrowser || !window.sessionStorage) return;
  try {
    const existing = sessionStorage.getItem(RECENT_SCANS_KEY);
    const scans: RecentScan[] = existing ? (JSON.parse(existing) as RecentScan[]) : [];
    
    // Keep last 10 unique scans
    const filtered = scans.filter((s) => s.barcode !== scan.barcode);
    const updated = [scan, ...filtered].slice(0, 10);
    
    sessionStorage.setItem(RECENT_SCANS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to cache scan in sessionStorage:', error);
  }
};

/**
 * Retrieve cached recent scans from sessionStorage
 */
export const getStoredRecentScans = (): RecentScan[] => {
  if (!isBrowser || !window.sessionStorage) return [];
  try {
    const data = sessionStorage.getItem(RECENT_SCANS_KEY);
    return data ? (JSON.parse(data) as RecentScan[]) : [];
  } catch (error) {
    console.error('Error reading recent scans cache:', error);
    return [];
  }
};

/**
 * Clear all preloaded caches (useful on user sign-out)
 */
export const clearStorageCache = (): void => {
  if (!isBrowser) return;
  try {
    if (window.localStorage) {
      localStorage.removeItem(INVENTORY_CACHE_KEY);
      localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    }
    if (window.sessionStorage) {
      sessionStorage.removeItem(RECENT_SCANS_KEY);
    }
  } catch (error) {
    console.warn('Failed to clear storage cache:', error);
  }
};
