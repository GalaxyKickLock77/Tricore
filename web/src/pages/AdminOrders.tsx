import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { BadgeIndianRupee, CheckCircle2, Clock, Loader2, MapPin, PackageCheck, ReceiptText, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { money, orderRef, shortDate } from '@/lib/format'
import type { Order, OrderEvent, OrderStatus } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import OrderTimeline from '@/components/OrderTimeline'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

type Filter = 'action' | 'all' | OrderStatus
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'action', label: 'Needs action' },
  { key: 'paid', label: 'Ready to ship' },
  { key: 'awaiting_payment', label: 'Awaiting payment' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]

type Dlg =
  | { kind: 'ship'; order: Order }
  | { kind: 'cancel'; order: Order }
  | null

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [events, setEvents] = useState<OrderEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('action')
  const [dlg, setDlg] = useState<Dlg>(null)
  const [busy, setBusy] = useState(false)
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')

  const load = async () => {
    const [o, e] = await Promise.all([
      supabase.from('orders').select('*, products(name), profiles(email)').order('created_at', { ascending: false }),
      supabase.from('order_events').select('*').order('created_at', { ascending: true }),
    ])
    if (o.error) toast.error(o.error.message)
    setOrders((o.data as unknown as Order[]) ?? [])
    setEvents((e.data as OrderEvent[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    // cancel unpaid orders that are past the limit (fallback when the scheduled job is not available)
    supabase.rpc('expire_unpaid_orders').then(() => load())
    load()
    // refresh when orders change (new order, payment submitted…)
    const ch = supabase.channel('admin-orders-page').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load()).subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  const byOrder = useMemo(() => {
    const map = new Map<string, OrderEvent[]>()
    for (const ev of events) map.set(ev.order_id, [...(map.get(ev.order_id) ?? []), ev])
    return map
  }, [events])

  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length
  const stats = [
    { label: 'Awaiting payment', value: String(count('awaiting_payment')), icon: Clock },
    { label: 'Ready to ship', value: String(count('paid')), icon: PackageCheck },
    { label: 'Shipped', value: String(count('shipped')), icon: Truck },
    { label: 'Money received', value: money(orders.filter((o) => ['paid', 'shipped', 'delivered'].includes(o.status)).reduce((s, o) => s + Number(o.total), 0)), icon: BadgeIndianRupee },
  ]

  const actionOrders = orders.filter((o) => o.status === 'awaiting_payment' || o.status === 'paid' || o.status === 'shipped')
  const shown = orders.filter((o) => filter === 'all' || (filter === 'action' ? o.status === 'awaiting_payment' || o.status === 'paid' || o.status === 'shipped' : o.status === filter))

  const syncTicket = async (orderId: string, message: string | undefined, status?: 'open' | 'in_progress' | 'resolved') => {
    const ref = orderRef(orderId)
    const { data: ticket } = await supabase
      .from('support_requests')
      .select('id, status')
      .ilike('question', `%Order ref: #${ref}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!ticket?.id) return
    if (message) {
      await supabase.rpc('add_ticket_comment', { p_ticket: ticket.id, p_body: message, p_internal: false })
    }
    if (status && status !== ticket.status) {
      await supabase.from('support_requests').update({ status }).eq('id', ticket.id)
    }
  }

  const run = async (fn: string, args: Record<string, unknown>, ok: string, sync?: { message?: string; status?: 'open' | 'in_progress' | 'resolved' }) => {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return void toast.error(error.message)
    toast.success(ok)
    setDlg(null)
    setReason('')
    setCourier('')
    setTracking('')
    setUrl('')
    if (sync) {
      try { await syncTicket(String(args.p_order), sync.message, sync.status) } catch { toast.error('Order updated, but the support ticket could not be updated.') }
    }
    load()
  }

  const submitDialog = (e: FormEvent) => {
    e.preventDefault()
    if (!dlg) return
    if (dlg.kind === 'ship') void run('admin_ship_order', { p_order: dlg.order.id, p_courier: courier, p_tracking: tracking, p_url: url || null }, 'Order marked as shipped', { status: 'in_progress' })
    if (dlg.kind === 'cancel') void run('admin_cancel_order', { p_order: dlg.order.id, p_reason: reason }, 'Order cancelled and stock restored', { message: `Order cancelled: ${reason}`, status: 'resolved' })
  }

  return (
    <Page title="Orders" description="Confirm payments after contacting the customer, ship paid orders and keep customers updated.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <div><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {actionOrders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-600" />
            <span className="font-medium">{actionOrders.length} order(s) need your action</span>
            <span className="text-muted-foreground">({count('awaiting_payment')} awaiting payment, {count('paid')} ready to ship, {count('shipped')} to mark delivered)</span>
          </div>
          <Button size="lg" variant="outline" onClick={() => setFilter('action')}>Show them</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} size="lg" variant={filter === f.key ? 'default' : 'outline'} onClick={() => setFilter(f.key)}>{f.label}</Button>
        ))}
        <Button size="lg" variant="outline" asChild><a href="/admin/support">Support tickets</a></Button>
      </div>

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : shown.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="Nothing here" hint={filter === 'action' ? 'No orders need action right now.' : 'New orders will appear automatically.'} />
      ) : (
        <div className="space-y-4">
          {shown.map((o) => (
            <Card key={o.id}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{o.products?.name} × {o.quantity} · {money(o.total)}</p>
                    <p className="text-xs text-muted-foreground">#{orderRef(o.id)} · {shortDate(o.created_at)} · {o.profiles?.email}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                {o.ship_line1 && (
                  <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0" />
                    <span>{o.ship_name} · {o.ship_phone}<br />{o.ship_line1}{o.ship_line2 ? `, ${o.ship_line2}` : ''}, {o.ship_city}, {o.ship_state} {o.ship_pincode}</span>
                  </p>
                )}

                {o.payment_reference && (
                  <p className="text-sm">UPI transaction ID from customer: <b className="font-mono">{o.payment_reference}</b>. Check your bank statement for {money(o.total)} with this reference.</p>
                )}
                {o.tracking_number && <p className="text-sm">Courier: {o.courier} · tracking <b>{o.tracking_number}</b></p>}

                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">History</summary>
                  <div className="mt-2"><OrderTimeline status={o.status} events={byOrder.get(o.id) ?? []} /></div>
                </details>

                <div className="flex flex-wrap gap-2">
                  {o.status === 'awaiting_payment' && (
                    <Button size="lg" variant="outline" onClick={() => run('admin_confirm_payment', { p_order: o.id }, 'Payment confirmed', { status: 'in_progress' })}>Mark as paid (after contact)</Button>
                  )}
                  {o.status === 'paid' && (
                    <Button size="lg" onClick={() => setDlg({ kind: 'ship', order: o })}><Truck className="size-4" />Ship order</Button>
                  )}
                  {o.status === 'shipped' && (
                    <Button size="lg" onClick={() => run('admin_mark_delivered', { p_order: o.id }, 'Marked as delivered', { status: 'resolved' })}><CheckCircle2 className="size-4" />Mark delivered</Button>
                  )}
                  {['awaiting_payment', 'paid'].includes(o.status) && (
                    <Button size="lg" variant="ghost" className="text-destructive" onClick={() => setDlg({ kind: 'cancel', order: o })}>Cancel order</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!dlg} onOpenChange={(open) => !open && setDlg(null)}>
        <DialogContent>
          <form onSubmit={submitDialog} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{dlg?.kind === 'ship' ? 'Ship this order' : 'Cancel this order'}</DialogTitle>
              <DialogDescription>
                {dlg?.kind === 'ship' && 'The customer sees the courier and tracking details on My orders.'}
                {dlg?.kind === 'cancel' && 'The stock is returned. If the customer already paid, refund them yourself.'}
              </DialogDescription>
            </DialogHeader>
            {dlg?.kind === 'ship' ? (
              <>
                <div className="space-y-1.5"><Label htmlFor="courier">Courier</Label><Input id="courier" required maxLength={60} placeholder="For example DTDC, Delhivery, India Post" value={courier} onChange={(e) => setCourier(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="trk">Tracking number</Label><Input id="trk" required maxLength={80} value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="trkurl">Tracking link (optional)</Label><Input id="trkurl" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (shown to the customer)</Label>
                <Input id="reason" required minLength={3} maxLength={300} placeholder="For example: customer asked to cancel" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDlg(null)}>Back</Button>
              <Button type="submit" disabled={busy} variant={dlg?.kind === 'cancel' ? 'destructive' : 'default'}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {dlg?.kind === 'ship' ? 'Mark as shipped' : 'Cancel order'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
