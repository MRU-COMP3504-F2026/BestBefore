import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import ItemCard from "../components/ItemCard";
import PageHeader from "../components/PageHeader";
import { formatDate } from "../lib/dates";
import { categoryIcon } from "../lib/categoryIcon";
import { useItemImageSrc } from "../lib/useItemImage";
import {
  expiryTone,
  useDeleteInventoryItems,
  useInventory,
  type InventoryItem,
} from "../lib/inventoryApi";
import "../styles/ItemsPage.css";
import "../styles/InventoryList.css";

// One selectable card. A component of its own because useItemImageSrc is a hook.
function SelectableItemCard({
  item,
  selected,
  onToggle,
}: {
  item: InventoryItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <ItemCard
      name={item.name}
      expires={formatDate(item.bestBefore)}
      icon={categoryIcon(item.category)}
      tone={expiryTone(item.bestBefore)}
      imageSrc={useItemImageSrc(item)}
      selectable
      selected={selected}
      onClick={onToggle}
    />
  );
}

export default function RemoveItemsPage() {
  useEffect(() => {
    document.title = "BestBefore | Remove Items";
  }, []);

  const navigate = useNavigate();
  const { data: items = [], isPending, isError } = useInventory();
  const removal = useDeleteInventoryItems();
  // Selection is kept by item id, so it survives the list refetching.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const selectExpired = () =>
    setSelected(
      new Set(
        items
          .filter((i) => expiryTone(i.bestBefore) === "red")
          .map((i) => i.id),
      ),
    );

  const onRemove = () => {
    if (
      !window.confirm(`Remove ${selected.size} item(s)? This can't be undone.`)
    )
      return;
    removal.mutate([...selected], { onSuccess: () => navigate("/items") });
  };

  return (
    <div className="items">
      <PageHeader title="Remove Items" backTo="/items" />

      {isPending && <p role="status">Loading…</p>}
      {isError && (
        <p role="alert">Couldn't load your items. Please try again.</p>
      )}
      {!isPending && !isError && items.length === 0 && (
        <p>No items to remove.</p>
      )}

      {items.length > 0 && (
        <>
          <div className="scan-controls-row">
            <Button variant="secondary" onClick={selectAll}>
              {allSelected ? "Clear selection" : "Select all"}
            </Button>
            <Button variant="secondary" onClick={selectExpired}>
              Select expired
            </Button>
          </div>

          <ul className="items-list">
            {items.map((item) => (
              <li key={item.id} className="inventory-list-item">
                <SelectableItemCard
                  item={item}
                  selected={selected.has(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              </li>
            ))}
          </ul>

          {removal.isError && (
            <p role="alert">Couldn't remove the items. Please try again.</p>
          )}

          <Button
            onClick={onRemove}
            disabled={selected.size === 0 || removal.isPending}
          >
            {removal.isPending
              ? "Removing…"
              : `Remove selected (${selected.size})`}
          </Button>
        </>
      )}
    </div>
  );
}
