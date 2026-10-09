import { Badge } from '@/components/ui/badge'
import type { OrderStatus } from '@/lib/types'

const style: Record<OrderStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  paid: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  shipped: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-400',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant="secondary" className={`capitalize ${style[status]}`}>{status}</Badge>
}
