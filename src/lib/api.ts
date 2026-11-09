import { getApiToken } from './authClient'

// status is the HTTP status. serverMessage is the API's own { error } text, when it sent one.
export class ApiError extends Error {
  status: number
  serverMessage?: string

  constructor(status: number, serverMessage?: string) {
    super(`API request failed: ${status}`)
    this.status = status
    this.serverMessage = serverMessage
  }
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown } | null
    return typeof body?.error === 'string' ? body.error : undefined
  } catch {
    return undefined
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = await getApiToken()

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }

  return response.json() as Promise<T>
}
