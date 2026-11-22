import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStoredInventory,
  setStoredInventory,
  cacheRecentScan,
  getStoredRecentScans,
  clearStorageCache,
  type CachedItem,
} from '../lib/storagePreload';

describe('Browser Storage Preload Utilities', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('saves and retrieves inventory items from localStorage', () => {
    const mockItems: CachedItem[] = [
      { id: '1', name: 'Milk', category: 'Dairy', expiryDate: '2026-11-20', quantity: 1 },
      { id: '2', name: 'Apples', category: 'Produce', expiryDate: '2026-11-25', quantity: 5 },
    ];

    setStoredInventory(mockItems);
    const loaded = getStoredInventory();

    expect(loaded).toEqual(mockItems);
    expect(loaded?.length).toBe(2);
  });

  it('caches unique recent scans in sessionStorage (max 10)', () => {
    cacheRecentScan({ barcode: '12345', name: 'Oat Milk' });
    cacheRecentScan({ barcode: '67890', name: 'Cheddar Cheese' });
    // Scan '12345' again — should move to front without duplicating
    cacheRecentScan({ barcode: '12345', name: 'Oat Milk' });

    const scans = getStoredRecentScans();
    expect(scans.length).toBe(2);
    expect(scans[0].barcode).toBe('12345');
    expect(scans[1].barcode).toBe('67890');
  });

  it('clears both localStorage and sessionStorage caches on reset', () => {
    setStoredInventory([{ id: '1', name: 'Bread' }]);
    cacheRecentScan({ barcode: '11111', name: 'Bread' });

    clearStorageCache();

    expect(getStoredInventory()).toBeNull();
    expect(getStoredRecentScans()).toEqual([]);
  });
});
