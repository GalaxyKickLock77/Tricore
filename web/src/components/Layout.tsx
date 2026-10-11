import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import { LogOut, LifeBuoy, Moon, Settings, Package, ReceiptText, ShoppingBag, Store, Sun, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  )

export default function Layout() {
  const { profile, session, signOut } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const email = session?.user.email ?? ''
  const [toAct, setToAct] = useState(0)

  // Admin: how many orders need action (payment to verify, or paid and ready to ship) + live alerts.
  const refreshCount = useCallback(async () => {
    const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['payment_submitted', 'paid'])
    setToAct(count ?? 0)
  }, [])
  useEffect(() => {
    if (!isAdmin) return
    refreshCount()
    const ch = supabase
      .channel('admin-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        toast.info('New order placed. Waiting for the customer to pay.')
        refreshCount()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        if ((payload.new as { status?: string }).status === 'payment_submitted') toast.warning('A customer submitted a payment. Verify it in your bank.')
        refreshCount()
      })
      .subscribe()
    const timer = setInterval(refreshCount, 60_000)
    return () => {
      clearInterval(timer)
      supabase.removeChannel(ch)
    }
  }, [isAdmin, refreshCount])
  const initial = (profile?.full_name || email || '?').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Store className="size-4" />
            </span>
            <span className="hidden sm:inline">Tricore IT Solutions</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/shop" className={navClass}><ShoppingBag className="size-4" />Products</NavLink>
            <NavLink to="/orders" className={navClass}><ReceiptText className="size-4" />My orders</NavLink>
            {!isAdmin && <NavLink to="/tickets" className={navClass}><LifeBuoy className="size-4" />Support</NavLink>}
            {isAdmin && <NavLink to="/admin/products" className={navClass}><Package className="size-4" />Manage products</NavLink>}
            {isAdmin && (
              <NavLink to="/admin/orders" className={navClass}>
                <Users className="size-4" />Orders
                {toAct > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" aria-label={`${toAct} orders need action`}>{toAct}</span>}
              </NavLink>
            )}
            {isAdmin && <NavLink to="/admin/support" className={navClass}><LifeBuoy className="size-4" />Support</NavLink>}
            {isAdmin && <NavLink to="/admin/settings" className={navClass}><Settings className="size-4" />Payment</NavLink>}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost" size="icon" aria-label="Toggle theme"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="size-4 dark:hidden" />
              <Moon className="hidden size-4 dark:block" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Account menu" className="rounded-full">
                  <Avatar className="size-8"><AvatarFallback>{initial}</AvatarFallback></Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="space-y-1">
                  <p className="truncate text-sm font-medium">{profile?.full_name || email}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{email}</p>
                  {profile && <Badge variant="secondary" className="capitalize">{profile.role}</Badge>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    await signOut()
                    navigate('/')
                  }}
                >
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden" aria-label="Main mobile">
          <NavLink to="/shop" className={navClass}><ShoppingBag className="size-4" />Products</NavLink>
          <NavLink to="/orders" className={navClass}><ReceiptText className="size-4" />My orders</NavLink>
            {!isAdmin && <NavLink to="/tickets" className={navClass}><LifeBuoy className="size-4" />Support</NavLink>}
          {isAdmin && <NavLink to="/admin/products" className={navClass}><Package className="size-4" />Manage</NavLink>}
          {isAdmin && (
              <NavLink to="/admin/orders" className={navClass}>
                <Users className="size-4" />Orders
                {toAct > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" aria-label={`${toAct} orders need action`}>{toAct}</span>}
              </NavLink>
            )}
            {isAdmin && <NavLink to="/admin/support" className={navClass}><LifeBuoy className="size-4" />Support</NavLink>}
            {isAdmin && <NavLink to="/admin/settings" className={navClass}><Settings className="size-4" />Payment</NavLink>}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  )
}
