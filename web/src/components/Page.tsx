import type { ReactNode } from 'react'
import { motion } from 'motion/react'

export function Page({ title, description, actions, children }: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </motion.section>
  )
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center text-muted-foreground">
      <div className="[&_svg]:size-8">{icon}</div>
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="text-sm">{hint}</p>}
    </div>
  )
}
