import { Badge } from '@/components/ui/badge'
import type { OrderStatus } from '@/lib/types'

const style: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  payment_submitted: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  paid: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  shipped: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  delivered: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-400',
}

export const statusLabel: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  payment_submitted: 'Verifying payment',
  paid: 'Payment received',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant="secondary" className={style[status]}>{statusLabel[status]}</Badge>
}
