import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Clock, DollarSign, ReceiptText, ShoppingBag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Order, OrderStatus } from '@/lib/types'
import { money, shortDate } from '@/lib/format'
import { EmptyState, Page } from '@/components/Page'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const statuses: OrderStatus[] = ['pending', 'paid', 'shipped', 'cancelled']

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, products(name), profiles(email)')
      .order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    setOrders((data as unknown as Order[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const setStatus = async (id: string, status: OrderStatus) => {
    const { error } = await supabase.from('orders').update({ status }).eq('id', id)
    if (error) toast.error(error.message)
    else toast.success(`Order marked ${status}`)
    load()
  }

  const stats = useMemo(() => {
    const live = orders.filter((o) => o.status !== 'cancelled')
    return [
      { label: 'Total orders', value: String(orders.length), icon: ShoppingBag },
      { label: 'Pending', value: String(orders.filter((o) => o.status === 'pending').length), icon: Clock },
      { label: 'Revenue', value: money(live.reduce((s, o) => s + o.unit_price * o.quantity, 0)), icon: DollarSign },
    ]
  }, [orders])

  return (
    <Page title="All orders" description="Review customer orders and update their status.">
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : orders.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="No orders yet" />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-40">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.products?.name}</TableCell>
                  <TableCell className="text-muted-foreground">{o.profiles?.email}</TableCell>
                  <TableCell className="text-right">{o.quantity}</TableCell>
                  <TableCell className="text-right">{money(o.unit_price * o.quantity)}</TableCell>
                  <TableCell className="text-muted-foreground">{shortDate(o.created_at)}</TableCell>
                  <TableCell>
                    <Select value={o.status} onValueChange={(v) => setStatus(o.id, v as OrderStatus)}>
                      <SelectTrigger aria-label="Order status" className="w-36 capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Page>
  )
}
