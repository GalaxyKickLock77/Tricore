import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LifeBuoy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ticket, TicketComment } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import TicketThread from '@/components/TicketThread'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function MyTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [comments, setComments] = useState<TicketComment[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [t, c] = await Promise.all([
      supabase.from('support_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('ticket_comments').select('*').order('created_at', { ascending: true }),
    ])
    if (t.error) toast.error(t.error.message)
    setTickets((t.data as Ticket[]) ?? [])
    setComments((c.data as TicketComment[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const byTicket = useMemo(() => {
    const map = new Map<string, TicketComment[]>()
    for (const c of comments) map.set(c.ticket_id, [...(map.get(c.ticket_id) ?? []), c])
    return map
  }, [comments])

  return (
    <Page title="My tickets" description="Your conversations with the Tricore team. Replies from the team show up here.">
      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : tickets.length === 0 ? (
        <EmptyState icon={<LifeBuoy />} title="No tickets yet" hint="Open one from the chat button whenever you need our team." />
      ) : (
        <div className="space-y-4">
          {tickets.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <TicketStatusBadge status={t.status} />
                  <span className="font-mono text-xs text-muted-foreground">#{t.id.slice(0, 8).toUpperCase()}</span>
                  <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
                </div>
                <p className="rounded-lg bg-muted/60 p-3 text-sm">{t.question}</p>
                <TicketThread ticketId={t.id} comments={byTicket.get(t.id) ?? []} isAdmin={false} onPosted={load} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}
