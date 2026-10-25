import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { authClient } from '../lib/authClient'

type RequireAuthProps = {
  children: ReactNode
}

// Redirects signed-out users to /login, remembering where they were headed.
export default function RequireAuth({ children }: RequireAuthProps) {
  const { data: session, isPending } = authClient.useSession()
  const location = useLocation()

  if (isPending) return null

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
