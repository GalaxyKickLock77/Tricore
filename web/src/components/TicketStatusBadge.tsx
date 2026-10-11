import { Badge } from '@/components/ui/badge'
import type { TicketStatus } from '@/lib/types'

const style: Record<TicketStatus, string> = {
  open: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  in_progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
}
const label: Record<TicketStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant="secondary" className={style[status]}>{label[status]}</Badge>
}
