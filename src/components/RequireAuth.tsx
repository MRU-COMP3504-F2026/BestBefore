import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthSession } from '../lib/authClient'
import { preloadProducts } from '../lib/foodApi'

type RequireAuthProps = {
  children: ReactNode
}

// Redirects signed-out users to /login, remembering where they were headed.
export default function RequireAuth({ children }: RequireAuthProps) {
  const { data: session, isPending } = useAuthSession()
  const location = useLocation()
  const userId = session?.user.id

  // Once signed in, the user's frequent products go to local storage for the scanner.
  useEffect(() => {
    if (userId) void preloadProducts(userId)
  }, [userId])

  if (isPending) return null

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}