import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, MapPin, Package, ShoppingBag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { money, orderRef } from '@/lib/format'
import type { Address, Order, Product } from '@/lib/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const empty: Address = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' }

export default function Checkout() {
  const [params] = useSearchParams()
  const { session } = useAuth()
  const productId = params.get('product') ?? ''
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [qty, setQty] = useState(Math.min(Math.max(Number.parseInt(params.get('qty') ?? '1', 10) || 1, 1), 50))
  const [addr, setAddr] = useState<Address>(empty)
  const [placing, setPlacing] = useState(false)
  const [order, setOrder] = useState<Order | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [p, last] = await Promise.all([
        supabase.from('products').select('*').eq('id', productId).eq('is_active', true).maybeSingle(),
        // reuse the address from the customer's previous order
        supabase.from('orders').select('ship_name,ship_phone,ship_line1,ship_line2,ship_city,ship_state,ship_pincode').not('ship_line1', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (!alive) return
      setProduct((p.data as Product) ?? null)
      const l = last.data as Record<string, string | null> | null
      if (l) {
        setAddr({
          name: l.ship_name ?? '', phone: l.ship_phone ?? '', line1: l.ship_line1 ?? '', line2: l.ship_line2 ?? '',
          city: l.ship_city ?? '', state: l.ship_state ?? '', pincode: l.ship_pincode ?? '',
        })
      }
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [productId])

  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setAddr((a) => ({ ...a, [k]: e.target.value }))

  const place = async (e: FormEvent) => {
    e.preventDefault()
    if (!product) return
    setPlacing(true)
    const { data, error } = await supabase.rpc('place_order', { p_product_id: product.id, p_quantity: qty, p_address: addr })
    if (error) {
      setPlacing(false)
      return void toast.error(error.message)
    }
    const { data: row } = await supabase.from('orders').select('*').eq('id', data as string).single()
    const o = row as Order
    setOrder(o)

    // Raise a support ticket so the team can contact the customer about this order.
    const contact = session?.user?.email || addr.phone
    const question = [
      `Order request`,
      `Product: ${product.name}`,
      `Quantity: ${qty}`,
      `Total: ${money(Number(o.total))}`,
      `Order ref: #${orderRef(o.id)}`,
      ``,
      `Delivery address:`,
      `${addr.name}, ${addr.phone}`,
      `${addr.line1}${addr.line2 ? ', ' + addr.line2 : ''}`,
      `${addr.city}, ${addr.state} ${addr.pincode}`,
      ``,
      `Please contact me to confirm the order and arrange payment/delivery.`,
    ].join('\n').slice(0, 2000)
    const { data: tid, error: terr } = await supabase.rpc('create_support_request', {
      p_contact: contact,
      p_question: question,
      p_reason: 'Order placed - team to contact customer',
      p_transcript: [],
    })
    if (terr) {
      toast.error('Order placed, but could not open a support ticket: ' + terr.message)
    } else {
      setTicketId(tid as string)
      toast.success('Order placed. A support ticket has been opened for you.')
    }
    setPlacing(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) return <Skeleton className="h-64 rounded-xl" />

  if (!product) {
    return (
      <Page title="Checkout" description="This product is not available.">
        <Button asChild><Link to="/shop">Back to the shop</Link></Button>
      </Page>
    )
  }
  const soldOut = product.stock < 1
  const total = Number(product.price) * qty
  const step = !order ? 1 : 2

  return (
    <Page title="Checkout" description="Delivery address. Our team will contact you through a support ticket to confirm and arrange payment and delivery.">
      <ol className="flex gap-2 text-sm" aria-label="Checkout steps">
        {['Delivery address', 'Order placed'].map((s, i) => (
          <li key={s} className={`flex-1 rounded-lg border px-3 py-2 text-center ${step === i + 1 ? 'border-primary bg-primary/10 font-medium' : step > i + 1 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {step === 1 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="size-4" /> Where should we deliver?</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={place} className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="a-name">Full name</Label><Input id="a-name" required minLength={2} maxLength={80} autoComplete="name" value={addr.name} onChange={set('name')} /></div>
                  <div className="space-y-1.5"><Label htmlFor="a-phone">Phone number</Label><Input id="a-phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" value={addr.phone} onChange={set('phone')} /></div>
                  <div className="space-y-1.5"><Label htmlFor="a-pin">PIN code</Label><Input id="a-pin" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="postal-code" placeholder="6 digits" value={addr.pincode} onChange={set('pincode')} /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="a-l1">Address (house no, street)</Label><Input id="a-l1" required minLength={5} maxLength={200} autoComplete="address-line1" value={addr.line1} onChange={set('line1')} /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="a-l2">Landmark / area (optional)</Label><Input id="a-l2" maxLength={200} autoComplete="address-line2" value={addr.line2} onChange={set('line2')} /></div>
                  <div className="space-y-1.5"><Label htmlFor="a-city">City</Label><Input id="a-city" required maxLength={80} autoComplete="address-level2" value={addr.city} onChange={set('city')} /></div>
                  <div className="space-y-1.5"><Label htmlFor="a-state">State</Label><Input id="a-state" required maxLength={80} autoComplete="address-level1" value={addr.state} onChange={set('state')} /></div>
                  <div className="sm:col-span-2">
                    <Button type="submit" size="lg" className="w-full" disabled={placing || soldOut}>
                      {placing ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                      {soldOut ? 'Out of stock' : 'Place order and open support ticket'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {step === 2 && order && (
            <Card>
              <CardHeader><CardTitle className="text-base">Order placed #{orderRef(order.id)}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Your order is placed and the item is reserved for you. Our team will contact you to confirm payment and delivery.</p>
                {ticketId && (
                  <div className="rounded-lg bg-emerald-500/10 p-3 text-sm">
                    <p className="font-medium">Support ticket opened: #{String(ticketId).slice(0, 8).toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">Track and reply to the team on your Support page. We will also contact you at {session?.user?.email || addr.phone}.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button asChild size="lg" variant="outline"><Link to="/tickets">View my tickets</Link></Button>
                      <Button asChild size="lg" variant="outline"><Link to="/orders">View my orders</Link></Button>
                    </div>
                  </div>
                )}
                {!ticketId && (
                  <p className="text-sm text-amber-600">We could not open a support ticket automatically. Please open one from the Support page and mention order #{orderRef(order.id)}.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Package className="size-4" /> Order summary</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-3">
              {product.image_url ? <img src={product.image_url} alt="" className="size-14 rounded object-cover" /> : <div className="grid size-14 place-items-center rounded bg-muted"><Package className="size-6 text-muted-foreground" /></div>}
              <div>
                <p className="font-medium">{product.name}</p>
                <p className="text-muted-foreground">{money(product.price)} each</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="qty">Quantity</Label>
              <Input id="qty" type="number" min={1} max={Math.max(1, Math.min(product.stock, 50))} className="w-20" value={qty} disabled={!!order}
                onChange={(e) => setQty(Math.min(Math.max(Number.parseInt(e.target.value, 10) || 1, 1), Math.max(1, Math.min(product.stock, 50))))} />
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span>{money(order ? Number(order.total) : total)}</span></div>
            <p className="text-xs text-muted-foreground">Our team will contact you via support ticket to confirm payment and delivery.</p>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
