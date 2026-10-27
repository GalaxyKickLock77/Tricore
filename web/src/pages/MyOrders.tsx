import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CreditCard, ExternalLink, Loader2, MapPin, ReceiptText, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { money, orderRef, shortDate } from '@/lib/format'
import type { Order, OrderEvent } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import OrderTimeline from '@/components/OrderTimeline'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function MyOrders() {
  const { session } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [events, setEvents] = useState<OrderEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState<string | null>(null)

  const load = async () => {
    const [o, e] = await Promise.all([
      supabase.from('orders').select('*, products(name, image_url)').order('created_at', { ascending: false }),
      supabase.from('order_events').select('*').order('created_at', { ascending: true }),
    ])
    if (o.error) toast.error(o.error.message)
    setOrders((o.data as unknown as Order[]) ?? [])
    setEvents((e.data as OrderEvent[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const byOrder = useMemo(() => {
    const map = new Map<string, OrderEvent[]>()
    for (const ev of events) map.set(ev.order_id, [...(map.get(ev.order_id) ?? []), ev])
    return map
  }, [events])

  const payNow = async (id: string) => {
    if (!session?.access_token) { toast.error('Please sign in to pay.'); return }
    setPaying(id)
    try {
      const r = await fetch('/api/xpay-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ order_id: id }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data?.payment_url) throw new Error(data?.error || 'Could not start payment')
      window.location.href = data.payment_url
    } catch (e: any) {
      toast.error(e?.message || 'Could not start payment')
    } finally {
      setPaying(null)
    }
  }

  const cancel = async (id: string) => {
    if (!confirm('Cancel this order?')) return
    const { error } = await supabase.rpc('cancel_my_order', { p_order: id })
    if (error) toast.error(error.message)
    else toast.success('Order cancelled')
    load()
  }
  return (
    <Page title="My orders" description="Follow each order from payment to delivery.">

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : orders.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="No orders yet" hint="Orders you place will show up here." />
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{o.products?.name ?? 'Product'} × {o.quantity}</p>
                    <p className="text-xs text-muted-foreground">Order #{orderRef(o.id)} · {shortDate(o.created_at)} · {money(o.total)}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                <OrderTimeline status={o.status} events={byOrder.get(o.id) ?? []} />

                {o.payment_note && o.status === 'awaiting_payment' && (
                  <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-400">We could not verify your payment: {o.payment_note}</p>
                )}

                {(o.status === 'shipped' || o.status === 'delivered') && o.tracking_number && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-500/10 p-3 text-sm">
                    <Truck className="size-4" />
                    <span>{o.courier} · tracking <b>{o.tracking_number}</b></span>
                    {o.tracking_url && (
                      <Button asChild size="lg" variant="outline"><a href={o.tracking_url} target="_blank" rel="noopener noreferrer">Track shipment <ExternalLink className="size-3.5" /></a></Button>
                    )}
                  </div>
                )}

                {o.ship_line1 && (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" />
                    {o.ship_name}, {o.ship_line1}{o.ship_line2 ? `, ${o.ship_line2}` : ''}, {o.ship_city}, {o.ship_state} {o.ship_pincode} · {o.ship_phone}
                  </p>
                )}

                {o.status === 'awaiting_payment' && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="lg" disabled={paying === o.id} onClick={() => payNow(o.id)}>
                      {paying === o.id && <Loader2 className="size-4 animate-spin" />}
                      <CreditCard className="size-4" /> Pay {money(o.total)} now
                    </Button>
                    <Button size="lg" variant="outline" onClick={() => cancel(o.id)}>Cancel order</Button>
                  </div>
                )}
                {o.status === 'payment_submitted' && (
                  <p className="text-sm text-muted-foreground">We received your payment reference <b>{o.payment_reference}</b> and are checking it in the bank. We will confirm shortly.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Need help with an order? <Link to="/tickets" className="underline">Open a support ticket</Link>.</p>
    </Page>
  )
}
