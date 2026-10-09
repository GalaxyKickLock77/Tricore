import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { LogOut, Moon, Package, ReceiptText, ShoppingBag, Store, Sun, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth'
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
  const initial = (profile?.full_name || email || '?').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Store className="size-4" />
            </span>
            <span className="hidden sm:inline">Tricore Store</span>
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/" end className={navClass}><ShoppingBag className="size-4" />Products</NavLink>
            <NavLink to="/orders" className={navClass}><ReceiptText className="size-4" />My orders</NavLink>
            {isAdmin && <NavLink to="/admin/products" className={navClass}><Package className="size-4" />Manage products</NavLink>}
            {isAdmin && <NavLink to="/admin/orders" className={navClass}><Users className="size-4" />All orders</NavLink>}
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
                    navigate('/login')
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
          <NavLink to="/" end className={navClass}><ShoppingBag className="size-4" />Products</NavLink>
          <NavLink to="/orders" className={navClass}><ReceiptText className="size-4" />My orders</NavLink>
          {isAdmin && <NavLink to="/admin/products" className={navClass}><Package className="size-4" />Manage</NavLink>}
          {isAdmin && <NavLink to="/admin/orders" className={navClass}><Users className="size-4" />All orders</NavLink>}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  )
}
