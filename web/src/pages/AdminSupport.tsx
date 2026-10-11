import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LifeBuoy, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Ticket, TicketComment, TicketStatus } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import TicketThread from '@/components/TicketThread'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const FILTERS: { key: 'all' | TicketStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
]

export default function AdminSupport() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [comments, setComments] = useState<TicketComment[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | TicketStatus>('open')

  const load = async () => {
    const [t, c] = await Promise.all([
      supabase.from('support_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('ticket_comments').select('*').order('created_at', { ascending: true }),
    ])
    if (t.error) toast.error(t.error.message)
    if (c.error) toast.error(c.error.message)
    setTickets((t.data as Ticket[]) ?? [])
    setComments((c.data as TicketComment[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const setStatus = async (id: string, status: TicketStatus) => {
    const { error } = await supabase.from('support_requests').update({ status }).eq('id', id)
    if (error) toast.error(error.message)
    else toast.success('Status updated')
    load()
  }

  const byTicket = useMemo(() => {
    const map = new Map<string, TicketComment[]>()
    for (const c of comments) map.set(c.ticket_id, [...(map.get(c.ticket_id) ?? []), c])
    return map
  }, [comments])

  const counts = useMemo(() => {
    const n = { all: tickets.length, open: 0, in_progress: 0, resolved: 0 }
    for (const t of tickets) n[t.status]++
    return n
  }, [tickets])

  const shown = tickets.filter((t) => filter === 'all' || t.status === filter)

  return (
    <Page title="Support tickets" description="Reply to customers, leave internal notes and track each ticket to resolution.">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} size="lg" variant={filter === f.key ? 'default' : 'outline'} onClick={() => setFilter(f.key)}>
            {f.label} ({counts[f.key]})
          </Button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : shown.length === 0 ? (
        <EmptyState icon={<LifeBuoy />} title="No tickets here" hint="Tickets appear when a customer opens one from the chat." />
      ) : (
        <div className="space-y-4">
          {shown.map((t) => {
            const ref = t.id.slice(0, 8).toUpperCase()
            const mail = `mailto:${t.contact}?subject=${encodeURIComponent(`Re: your Tricore support ticket #${ref}`)}`
            return (
              <Card key={t.id}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <TicketStatusBadge status={t.status} />
                      <span className="font-mono text-xs text-muted-foreground">#{ref}</span>
                      <span className="font-medium">{t.contact}</span>
                      <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
                      {!t.user_id && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">visitor (not signed in)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild size="lg" variant="outline"><a href={mail}><Mail className="size-4" />Email customer</a></Button>
                      <Select value={t.status} onValueChange={(v) => setStatus(t.id, v as TicketStatus)}>
                        <SelectTrigger aria-label="Ticket status" className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <p className="rounded-lg bg-muted/60 p-3 text-sm">{t.question}</p>
                  {t.reason && <p className="text-xs text-muted-foreground">Why it came to the team: {t.reason}</p>}
                  {t.transcript.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">Chat before the ticket ({t.transcript.length})</summary>
                      <ul className="mt-2 space-y-1 rounded-md bg-muted/50 p-2">
                        {t.transcript.map((m, i) => (
                          <li key={i}><b className="capitalize">{m.role}:</b> {m.content}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <TicketThread ticketId={t.id} comments={byTicket.get(t.id) ?? []} isAdmin onPosted={load} />
                  {!t.user_id && (
                    <p className="text-xs text-muted-foreground">
                      This visitor was not signed in, so they cannot see updates in the app. Use Email customer to reach them.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </Page>
  )
}
