import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (!session) {
    // remember where the visitor wanted to go (for example checkout) and return there after signing in
    sessionStorage.setItem('tricore_next', location.pathname + location.search)
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return <Navigate to="/shop" replace />
  return <Outlet />
}
