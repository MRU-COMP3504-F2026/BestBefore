import { isIP } from 'node:net'
import { MAX_ITEM_PHOTO_BYTES } from '../db/schema.js'
import { findItem } from '../food/items.js'

// What an add-form save may carry as its picture. Exactly one kind, or neither.
export type ItemImageInput = { imageUrl?: string | null; photo?: string | null }

// The picture columns an inventory row is saved with. Empty when it has none.
export type ItemImageColumns =
  | Record<string, never>
  | { imageSource: 'product'; imageUrl: string }
  | { imageSource: 'photo'; photo: Buffer; photoType: 'image/jpeg' }

export class ItemImageError extends Error {}

// Long enough for any real product photo link, short enough to keep junk out of the row.
export const MAX_IMAGE_URL_LENGTH = 2048

// Base64 inflates by 4/3, plus the data URL prefix.
export const MAX_PHOTO_DATA_URL_LENGTH = Math.ceil(MAX_ITEM_PHOTO_BYTES / 3) * 4 + 64

const PHOTO_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/

// A product image link worth keeping, as https, or null. Only ever stored and shown by the user's
// browser, never fetched here, so the checks are about what the browser would load: a public web
// host, no credentials, no local or private address.
export function safeImageUrl(raw: string): string | null {
  if (raw.length > MAX_IMAGE_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) return null
  // Browsers block or upgrade http images on an https page anyway. A host without https fails
  // to load and the card falls back to its icon.
  url.protocol = 'https:'
  return url.toString()
}

// The AI Vision still the add form sent, as bytes, or an error. Only a JPEG within the size cap.
export function decodePhoto(dataUrl: string): Buffer {
  if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) throw new ItemImageError('That photo is too large to save.')
  const match = PHOTO_DATA_URL.exec(dataUrl)
  if (!match) throw new ItemImageError("That photo couldn't be saved.")
  const bytes = Buffer.from(match[1], 'base64')
  // JPEG start-of-image marker, so the type we serve it as is the type it is.
  if (bytes.length > MAX_ITEM_PHOTO_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new ItemImageError("That photo couldn't be saved.")
  }
  return bytes
}

// The picture to save with an item. A photo is the user's own still and is kept as sent. A product
// image is only kept when it is the image the shared lookup record has for this barcode, so the
// client can't attach an arbitrary link; anything else saves the item without one. Throws only for
// a malformed photo.
export async function itemImageColumns(
  barcode: string | null,
  { imageUrl, photo }: ItemImageInput,
): Promise<ItemImageColumns> {
  if (photo) return { imageSource: 'photo', photo: decodePhoto(photo), photoType: 'image/jpeg' }
  if (!imageUrl || !barcode) return {}

  const saved = await findItem(barcode)
  // Read loosely: a shared row isn't always a product database record.
  const recorded = (saved?.payload as { imageUrl?: unknown } | undefined)?.imageUrl
  if (typeof recorded !== 'string' || recorded !== imageUrl) return {}
  const url = safeImageUrl(recorded)
  return url ? { imageSource: 'product', imageUrl: url } : {}
}
