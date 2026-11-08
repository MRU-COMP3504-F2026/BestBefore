import { useEffect, useState } from 'react'
import { fetchItemPhoto, type InventoryItem } from './inventoryApi'

type ItemImage = Pick<InventoryItem, 'id' | 'imageSource' | 'imageUrl'>

// Where an item's picture loads from, or null to show its icon. A product image is its link. A
// photo is fetched with the token and shown from an object URL, released again on unmount. A photo
// that can't be fetched stays null.
export function useItemImageSrc(item: ItemImage): string | null {
  const photoId = item.imageSource === 'photo' ? item.id : null
  const [photo, setPhoto] = useState<{ id: number; url: string } | null>(null)

  useEffect(() => {
    if (photoId === null) return
    const abort = new AbortController()
    let url: string | null = null
    fetchItemPhoto(photoId, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return
        url = URL.createObjectURL(blob)
        setPhoto({ id: photoId, url })
      })
      .catch(() => {
        // The card keeps its icon.
      })
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId])

  if (item.imageSource === 'product') return item.imageUrl
  return photo && photo.id === photoId ? photo.url : null
}
