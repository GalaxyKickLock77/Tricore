import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ExternalLink, MapPin, ReceiptText, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { money, orderRef, shortDate } from '@/lib/format'
import type { Order, OrderEvent, Ticket, TicketComment } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import OrderTimeline from '@/components/OrderTimeline'
import TicketThread from '@/components/TicketThread'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function MyOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [events, setEvents] = useState<OrderEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [comments, setComments] = useState<TicketComment[]>([])

  const load = async () => {
    const [o, e, t, c] = await Promise.all([
      supabase.from('orders').select('*, products(name, image_url)').order('created_at', { ascending: false }),
      supabase.from('order_events').select('*').order('created_at', { ascending: true }),
      supabase.from('support_requests').select('*, profiles(full_name, email)').order('created_at', { ascending: false }),
      supabase.from('ticket_comments').select('*').order('created_at', { ascending: true }),

    ])
    if (o.error) toast.error(o.error.message)
    setOrders((o.data as unknown as Order[]) ?? [])
    setTickets((t.data as unknown as Ticket[]) ?? [])
    setComments((c.data as unknown as TicketComment[]) ?? [])

    setEvents((e.data as OrderEvent[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
    const ch = supabase
      .channel('my-orders-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_events' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_comments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const byOrder = useMemo(() => {
    const map = new Map<string, OrderEvent[]>()
    for (const ev of events) map.set(ev.order_id, [...(map.get(ev.order_id) ?? []), ev])
    return map
  }, [events])

  const ticketByOrder = useMemo(() => {
    const map = new Map<string, Ticket>()
    for (const o of orders) {
      const ref = orderRef(o.id)
      const t = tickets.find((x) => x.question.includes(`Order ref: #${ref}`))
      if (t) map.set(o.id, t)
    }
    return map
  }, [orders, tickets])

  const commentsByTicket = useMemo(() => {
    const map = new Map<string, TicketComment[]>()
    for (const c of comments) map.set(c.ticket_id, [...(map.get(c.ticket_id) ?? []), c])
    return map
  }, [comments])

  const cancel = async (id: string) => {
    if (!confirm('Cancel this order?')) return
    const { error } = await supabase.rpc('cancel_my_order', { p_order: id })
    if (error) { toast.error(error.message); return }
    // resolve the linked support ticket too
    try { await supabase.rpc('resolve_ticket_for_order', { p_order: id }) } catch { /* ignore */ }
    toast.success('Order cancelled')
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

                <OrderTimeline status={o.status} events={byOrder.get(o.id) ?? []} showEvents={!ticketByOrder.has(o.id)} />

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
                {ticketByOrder.get(o.id) && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">Support ticket #{ticketByOrder.get(o.id)!.id.slice(0, 8).toUpperCase()} — messages from you and the Tricore team</p>
                    <TicketThread ticketId={ticketByOrder.get(o.id)!.id} comments={commentsByTicket.get(ticketByOrder.get(o.id)!.id) ?? []} isAdmin={false} onPosted={load} />
                  </div>
                )}


                {o.ship_line1 && (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" />
                    {o.ship_name}, {o.ship_line1}{o.ship_line2 ? `, ${o.ship_line2}` : ''}, {o.ship_city}, {o.ship_state} {o.ship_pincode} · {o.ship_phone}
                  </p>
                )}

                {o.status === 'awaiting_payment' && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Our team will contact you through your support ticket to confirm payment and delivery. You can also message them on the Support page.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="lg" variant="outline" asChild><Link to="/tickets">Open support tickets</Link></Button>
                      <Button size="lg" variant="outline" onClick={() => cancel(o.id)}>Cancel order</Button>
                    </div>
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
