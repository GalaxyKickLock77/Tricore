import { Check, CircleDot, CreditCard, PackageCheck, ShieldCheck, Truck, XCircle } from 'lucide-react'
import type { OrderEvent, OrderStatus } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const STEPS = [
  { key: 'placed', label: 'Order placed', icon: PackageCheck },
  { key: 'verifying', label: 'Payment submitted', icon: CreditCard },
  { key: 'paid', label: 'Payment confirmed', icon: ShieldCheck },
  { key: 'shipped', label: 'Shipped', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: Check },
] as const

const INDEX: Record<Exclude<OrderStatus, 'cancelled'>, number> = {
  awaiting_payment: 0,
  payment_submitted: 1,
  paid: 2,
  shipped: 3,
  delivered: 4,
}

/** Where the order is right now (stepper) plus the full history underneath. */
export default function OrderTimeline({ status, events, showEvents = true }: { status: OrderStatus; events: OrderEvent[]; showEvents?: boolean }) {
  const cancelled = status === 'cancelled'
  const current = cancelled ? -1 : INDEX[status]

  return (
    <div className="space-y-3">
      {cancelled ? (
        <p className="flex items-center gap-2 rounded-lg bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-400">
          <XCircle className="size-4" /> This order was cancelled.
        </p>
      ) : (
        <ol className="grid grid-cols-5 gap-1 text-center" aria-label="Order progress">
          {STEPS.map((s, i) => {
            const done = i < current || status === 'delivered'
            const now = i === current && status !== 'delivered'
            const Icon = done ? Check : now ? CircleDot : s.icon
            return (
              <li key={s.key} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    'grid size-8 place-items-center rounded-full border',
                    done && 'border-emerald-500 bg-emerald-500 text-white',
                    now && 'border-primary bg-primary text-primary-foreground',
                    !done && !now && 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className={cn('text-[11px] leading-tight', (done || now) ? 'font-medium' : 'text-muted-foreground')}>{s.label}</span>
              </li>
            )
          })}
        </ol>
      )}

      {showEvents && events.length > 0 && (
        <ul className="space-y-1.5 border-l pl-4 text-sm">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" />
              <p>{e.note}</p>
              <p className="text-xs text-muted-foreground">{dateTime(e.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
