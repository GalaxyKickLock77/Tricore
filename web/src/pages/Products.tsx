import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Loader2, Package, Search, ShoppingCart } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Product } from '@/lib/types'
import { money } from '@/lib/format'
import { Page, EmptyState } from '@/components/Page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

export default function Products() {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [buying, setBuying] = useState<string | null>(null)

  const load = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    setItems((data as Product[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const buy = async (p: Product) => {
    setBuying(p.id)
    const { error } = await supabase.rpc('place_order', { p_product_id: p.id, p_quantity: 1 })
    if (error) toast.error(error.message)
    else toast.success(`Order placed for ${p.name}`)
    setBuying(null)
    load()
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((p) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q)) : items
  }, [items, query])

  return (
    <Page
      title="Products"
      description="Browse what's available and order in one click."
      actions={
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search products" placeholder="Search products…" className="pl-8"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      }
    >
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<Package />} title={query ? 'No matching products' : 'No products yet'}
          hint={query ? 'Try a different search.' : 'Check back soon.'} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.25 }}
              whileHover={{ y: -4 }}
            >
              <Card className="h-full overflow-hidden pt-0">
                <div className="relative aspect-[4/3] bg-gradient-to-br from-primary/10 to-muted">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground/50">
                      <Package className="size-12" />
                    </div>
                  )}
                  {p.stock < 1 ? (
                    <Badge variant="destructive" className="absolute right-2 top-2">Out of stock</Badge>
                  ) : p.stock <= 5 ? (
                    <Badge className="absolute right-2 top-2 bg-amber-500 text-white">Only {p.stock} left</Badge>
                  ) : null}
                </div>
                <CardContent className="flex-1 space-y-1">
                  <h2 className="font-medium">{p.name}</h2>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                </CardContent>
                <CardFooter className="justify-between">
                  <span className="text-lg font-semibold">{money(p.price)}</span>
                  <Button size="lg" disabled={p.stock < 1 || buying === p.id} onClick={() => buy(p)}>
                    {buying === p.id ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}
                    Buy
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </Page>
  )
}
