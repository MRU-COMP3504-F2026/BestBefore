// src/lib/useStorage.ts
import { useState, useEffect, useCallback } from 'react';
import {
  getStoredInventory,
  setStoredInventory,
  cacheRecentScan,
  getStoredRecentScans,
  clearStorageCache,
  type CachedItem,
  type RecentScan,
} from './storagePreload';

export const useStorage = () => {
  // 1. Preload inventory immediately from localStorage on mount
  const [cachedItems, setCachedItems] = useState<CachedItem[]>(() => {
    return getStoredInventory() ?? [];
  });

  // 2. Preload recent scans from sessionStorage on mount
  const [recentScans, setRecentScans] = useState<RecentScan[]>(() => {
    return getStoredRecentScans();
  });

  const [isPreloaded] = useState<boolean>(() => {
    return getStoredInventory() !== null;
  });

  // Sync inventory updates to both React state and localStorage
  const saveInventoryCache = useCallback((items: CachedItem[]) => {
    setCachedItems(items);
    setStoredInventory(items);
  }, []);

  // Add a scan to sessionStorage and update local state
  const addRecentScan = useCallback((scan: RecentScan) => {
    cacheRecentScan(scan);
    setRecentScans(getStoredRecentScans());
  }, []);

  // Clear all caches (e.g., on logout)
  const resetCache = useCallback(() => {
    clearStorageCache();
    setCachedItems([]);
    setRecentScans([]);
  }, []);

  // Keep state in sync if localStorage changes in another tab
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'bestbefore_inventory_cache') {
        setCachedItems(getStoredInventory() ?? []);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return {
    cachedItems,
    recentScans,
    isPreloaded,
    saveInventoryCache,
    addRecentScan,
    resetCache,
  };
};
