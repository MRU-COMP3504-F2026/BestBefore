import type { NextFunction, Request, Response } from 'express'
import { jwtVerify } from 'jose'
import { DEV_USER, isAuthDisabled } from './devAuth.js'
import { getNeonAuthKeys } from './neonAuth.js'

export type AuthUser = {
  id: string
  email?: string
  name?: string
}

declare module 'express-serve-static-core' {
  interface Locals {
    user?: AuthUser
  }
}

// Verifies the Neon Auth JWT sent as `Authorization: Bearer <token>`.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthDisabled()) {
    res.locals.user = DEV_USER
    next()
    return
  }

  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const { origin, jwks } = getNeonAuthKeys()
    const { payload } = await jwtVerify(token, jwks, { issuer: origin, audience: origin })

    if (typeof payload.sub !== 'string') {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    res.locals.user = {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    }
    next()
  } catch (err) {
    // Why, never the token: an expired JWT, a wrong issuer/audience (another Neon branch's token),
    // or a key this auth URL doesn't publish.
    const { code, claim } = (err ?? {}) as { code?: unknown; claim?: unknown }
    console.warn(`Auth rejected: ${typeof code === 'string' ? code : 'unknown'}${typeof claim === 'string' ? ` (${claim})` : ''}`)
    res.status(401).json({ error: 'Unauthorized' })
  }
}
