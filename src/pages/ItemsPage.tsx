import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import InventoryList from '../components/InventoryList'
import PageHeader from '../components/PageHeader'
import { PlusIcon } from '../components/icons'
import { useInventory } from '../lib/inventoryApi'
import '../styles/ItemsPage.css'

function getExpiryState(bestBefore: string): 'Expired' | 'Expiring-Soon' | 'Fresh' {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiryDate = new Date(bestBefore);
  expiryDate.setHours(0, 0, 0, 0);
  if (expiryDate < today) return 'Expired';
  const diffTime = expiryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return 'Expiring-Soon';
  return 'Fresh';
}

export default function ItemsPage() {
  const navigate = useNavigate()
  const { data, isPending, isError } = useInventory()

  const [activeFilter, setActiveFilter] = useState<'All' | 'Expired' | 'Expiring-Soon'>('All')
  const [sortOption, setSortOption] = useState<'expiry-asc' | 'expiry-desc' | 'alpha' | 'newest' | 'oldest'>('expiry-asc')
  
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    document.title = 'BestBefore | My Inventory'
  }, [])

  // filter
  let processedData = data || [];
  if (data) {
    processedData = data.filter((item) => {
      if (activeFilter === 'All') return true;
      return getExpiryState(item.bestBefore) === activeFilter;
    });

    // sort
    processedData.sort((a, b) => {
      switch (sortOption) {
        case 'expiry-asc':
          return new Date(a.bestBefore).getTime() - new Date(b.bestBefore).getTime();
        case 'expiry-desc':
          return new Date(b.bestBefore).getTime() - new Date(a.bestBefore).getTime();
        case 'alpha':
          return a.name.localeCompare(b.name);
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        default:
          return 0;
      }
    });
  }

  // Helper to show the right text on the dropdown button
  const getDropdownLabel = () => {
    if (activeFilter !== 'All') return activeFilter === 'Expiring-Soon' ? 'Expiring Soon' : activeFilter;
    switch (sortOption) {
      case 'expiry-asc': return 'Expiry (Soonest)';
      case 'expiry-desc': return 'Expiry (Latest)';
      case 'alpha': return 'Name (A-Z)';
      case 'newest': return 'Recently Added';
      case 'oldest': return 'Oldest Added';
      default: return 'Sort & Filter';
    }
  }

  return (
    <div className="items">
      <PageHeader title="My Items" />

      <Button icon={<PlusIcon />} onClick={() => navigate('/scan')}>
        Add Item
      </Button>

      <div className="custom-dropdown-container" ref={dropdownRef}>
        <span className="filter-label">View:</span>
        <button className="dropdown-toggle" onClick={() => setIsOpen(!isOpen)}>
          {getDropdownLabel()}
          <span className={`chevron ${isOpen ? 'open' : ''}`}>▼</span>
        </button>

        {isOpen && (
          <ul className="dropdown-menu">
            <li className="dropdown-header">Filter</li>
            <li className={activeFilter === 'All' ? 'active' : ''} onClick={() => { setActiveFilter('All'); setIsOpen(false); }}>All Items</li>
            <li className={activeFilter === 'Expired' ? 'active' : ''} onClick={() => { setActiveFilter('Expired'); setIsOpen(false); }}>Expired</li>
            <li className={activeFilter === 'Expiring-Soon' ? 'active' : ''} onClick={() => { setActiveFilter('Expiring-Soon'); setIsOpen(false); }}>Expiring Soon</li>
            
            <li className="dropdown-divider"></li>
            
            <li className="dropdown-header">Sort By</li>
            <li className={sortOption === 'expiry-asc' && activeFilter === 'All' ? 'active' : ''} onClick={() => { setSortOption('expiry-asc'); setActiveFilter('All'); setIsOpen(false); }}>Expiry (Soonest)</li>
            <li className={sortOption === 'expiry-desc' && activeFilter === 'All' ? 'active' : ''} onClick={() => { setSortOption('expiry-desc'); setActiveFilter('All'); setIsOpen(false); }}>Expiry (Latest)</li>
            <li className={sortOption === 'alpha' && activeFilter === 'All' ? 'active' : ''} onClick={() => { setSortOption('alpha'); setActiveFilter('All'); setIsOpen(false); }}>Name (A-Z)</li>
            <li className={sortOption === 'newest' && activeFilter === 'All' ? 'active' : ''} onClick={() => { setSortOption('newest'); setActiveFilter('All'); setIsOpen(false); }}>Recently Added</li>
            <li className={sortOption === 'oldest' && activeFilter === 'All' ? 'active' : ''} onClick={() => { setSortOption('oldest'); setActiveFilter('All'); setIsOpen(false); }}>Oldest Added</li>
          </ul>
        )}
      </div>

      {!isPending && !isError && processedData.length === 0 && (
        <p className="inventory-status">No items match this view.</p>
      )}

      {!isPending && !isError && processedData.length > 0 && (
        <InventoryList 
          className="items-list" 
          removeExpired 
          data={processedData} 
          activeFilter={`${activeFilter}-${sortOption}`} // Resets animation when sort changes
        />
      )}
    </div>
  )
}