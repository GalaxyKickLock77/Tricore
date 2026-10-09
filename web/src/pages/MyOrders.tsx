import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ReceiptText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Order } from '@/lib/types'
import { money, shortDate } from '@/lib/format'
import { EmptyState, Page } from '@/components/Page'
import { StatusBadge } from '@/components/StatusBadge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function MyOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('orders')
      .select('*, products(name)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setOrders((data as unknown as Order[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <Page title="My orders" description="Your purchase history and order status.">
      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : orders.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="No orders yet" hint="Orders you place will show up here." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.products?.name ?? 'Product'}</TableCell>
                  <TableCell className="text-right">{o.quantity}</TableCell>
                  <TableCell className="text-right">{money(o.unit_price * o.quantity)}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{shortDate(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Page>
  )
}
