// The products preloaded for the signed-in user, kept in local storage so a scan of one needs no
// request. Storage only: nothing here imports the API, so authClient can clear it on sign-out.
const STORAGE_KEY = 'bestbefore:product-preload'

// The user a preload was last started for, so it runs once per page load, not once per page.
let startedFor: string | null = null

// True the first time it is asked for this user since the page loaded or the list was cleared.
export function claimProductPreload(userId: string): boolean {
  if (startedFor === userId) return false
  startedFor = userId
  return true
}

// Whatever is stored, unchecked. Null when there is nothing or storage can't be read.
export function readProductPreload(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeProductPreload(value: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage is full or blocked. Scans ask the server instead.
  }
}

export function clearProductPreload(): void {
  startedFor = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {

  }
}