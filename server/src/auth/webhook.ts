import type { Request, Response } from 'express'
import { flattenedVerify } from 'jose'
import { getNeonAuthKeys } from './neonAuth.js'
import { consumeSignupSlot } from './signupRateLimit.js'

const MAX_AGE_MS = 5 * 60 * 1000

type NeonAuthEvent = {
  event_type: string
  event_data?: { ip_address?: string }
}

// Neon Auth signs webhooks with a detached JWS (EdDSA). The signed payload is
// base64url(`${timestamp}.${base64url(rawBody)}`).
async function verifyNeonWebhook(rawBody: Buffer, req: Request): Promise<NeonAuthEvent> {
  const signature = req.header('x-neon-signature')
  const kid = req.header('x-neon-signature-kid')
  const timestamp = req.header('x-neon-timestamp')
  if (!signature || !kid || !timestamp) throw new Error('Missing Neon webhook headers')

  const [protectedHeader, detached, sig] = signature.split('.')
  if (detached !== '' || !protectedHeader || !sig) throw new Error('Expected detached JWS')

  if (Math.abs(Date.now() - Number(timestamp)) > MAX_AGE_MS) throw new Error('Stale webhook')

  const bodyB64 = rawBody.toString('base64url')
  const payload = Buffer.from(`${timestamp}.${bodyB64}`).toString('base64url')

  const { jwks } = getNeonAuthKeys()
  await flattenedVerify({ protected: protectedHeader, payload, signature: sig }, (header) =>
    jwks({ ...header, kid: header.kid ?? kid }),
  )

  return JSON.parse(rawBody.toString('utf8')) as NeonAuthEvent
}

// Mounted with express.raw() so the signature is checked against the exact bytes sent.
export async function neonAuthWebhook(req: Request, res: Response) {
  let event: NeonAuthEvent
  try {
    event = await verifyNeonWebhook(req.body as Buffer, req)
  } catch {
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  if (event.event_type !== 'user.before_create') {
    res.json({ allowed: true })
    return
  }

  const ip = event.event_data?.ip_address
  // Without an IP there's nothing to rate limit on; let the sign-up through.
  if (!ip || (await consumeSignupSlot(ip))) {
    res.json({ allowed: true })
    return
  }

  res.json({
    allowed: false,
    error_message: 'Too many accounts created from this network. Please try again tomorrow.',
    error_code: 'SIGNUP_RATE_LIMITED',
  })
}
