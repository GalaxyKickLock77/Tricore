import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { BookOpenText, LifeBuoy, Loader2, Mail, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { callSupportAi } from '@/lib/ai'
import type { Ticket, TicketComment, TicketStatus } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import TicketThread from '@/components/TicketThread'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const FILTERS: { key: 'all' | TicketStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
]

const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-700 dark:text-red-400',
  high: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  normal: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  low: 'bg-slate-500/10 text-slate-500',
}

const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'article'

export default function AdminSupport() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [comments, setComments] = useState<TicketComment[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | TicketStatus>('open')
  const [busyAi, setBusyAi] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  const [kb, setKb] = useState<{ ticketId: string; title: string; content: string } | null>(null)
  const [savingKb, setSavingKb] = useState(false)

  const load = async () => {
    const [t, c] = await Promise.all([
      supabase.from('support_requests').select('*, profiles(full_name, email)').order('created_at', { ascending: false }),
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

  const summarize = async (id: string, quiet = false) => {
    setBusyAi(id)
    try {
      await callSupportAi('summarize', id)
      if (!quiet) toast.success('Summary added')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The AI could not help right now.')
      return false
    } finally {
      setBusyAi(null)
    }
    return true
  }

  const summarizeAll = async () => {
    const todo = tickets.filter((t) => !t.ai_summary && t.status !== 'resolved').slice(0, 8)
    if (todo.length === 0) return
    setBulk(true)
    for (const t of todo) {
      if (!(await summarize(t.id, true))) break
    }
    setBulk(false)
    toast.success('Done')
    load()
  }

  const draftKb = async (id: string) => {
    setBusyAi(id)
    try {
      const r = await callSupportAi('kb_draft', id)
      if (!r.should_add) toast.info(r.reason || 'Nothing reusable in this ticket for the knowledge base.')
      else setKb({ ticketId: id, title: r.title ?? '', content: r.content ?? '' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The AI could not help right now.')
    } finally {
      setBusyAi(null)
    }
  }

  const saveKb = async (e: FormEvent) => {
    e.preventDefault()
    if (!kb) return
    setSavingKb(true)
    const { error } = await supabase.from('kb_articles').insert({
      slug: `${slugify(kb.title)}-${Math.random().toString(36).slice(2, 6)}`,
      title: kb.title.trim(),
      content: kb.content.trim(),
      category: 'general',
    })
    setSavingKb(false)
    if (error) return void toast.error(error.message)
    toast.success('Added to the knowledge base. The chat assistant can use it now.')
    setKb(null)
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

  const shown = tickets
    .filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => (RANK[a.ai_priority ?? ''] ?? 4) - (RANK[b.ai_priority ?? ''] ?? 4) || +new Date(b.created_at) - +new Date(a.created_at))
  const unsummarized = tickets.filter((t) => !t.ai_summary && t.status !== 'resolved').length

  return (
    <Page
      title="Support tickets"
      description="Urgent tickets come first once summarised. The AI only drafts; you decide what is sent."
      actions={
        unsummarized > 0 ? (
          <Button size="lg" variant="outline" disabled={bulk} onClick={summarizeAll}>
            {bulk ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Summarise new ({Math.min(unsummarized, 8)})
          </Button>
        ) : undefined
      }
    >
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
                      {t.ai_priority && <Badge variant="secondary" className={cn('capitalize', PRIORITY_STYLE[t.ai_priority])}>{t.ai_priority}</Badge>}
                      {t.ai_category && <Badge variant="outline" className="capitalize">{t.ai_category}</Badge>}
                      <span className="font-mono text-xs text-muted-foreground">#{ref}</span>
                      <span className="font-medium">{t.contact}</span>
                      <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
                      <span className="text-xs font-medium text-primary">{t.profiles?.full_name ?? 'Unknown customer'} · {t.contact}</span>
                      {!t.user_id && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">visitor (not signed in)</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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

                  {t.ai_summary ? (
                    <p className="flex items-start gap-1.5 text-sm"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-violet-500" />{t.ai_summary}</p>
                  ) : (
                    <Button size="lg" variant="ghost" className="h-7 px-2 text-xs" disabled={busyAi === t.id} onClick={async () => { if (await summarize(t.id)) load() }}>
                      {busyAi === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Summarise with AI
                    </Button>
                  )}

                  <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{t.question}</p>
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

                  {t.status === 'resolved' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-500/10 p-2 text-sm">
                      <span>This ticket is resolved. You can still post an update (the customer gets it), or reopen it if work continues.</span>
                      <Button size="lg" variant="outline" onClick={() => setStatus(t.id, 'in_progress')}>Reopen</Button>
                    </div>
                  )}

                  <TicketThread ticketId={t.id} comments={byTicket.get(t.id) ?? []} isAdmin onPosted={load} />

                  {t.status === 'resolved' && (
                    <Button size="lg" variant="outline" disabled={busyAi === t.id} onClick={() => draftKb(t.id)}>
                      {busyAi === t.id ? <Loader2 className="size-4 animate-spin" /> : <BookOpenText className="size-4" />} Turn into a knowledge article
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={!!kb} onOpenChange={(o) => !o && setKb(null)}>
        <DialogContent>
          <form onSubmit={saveKb} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add to the knowledge base</DialogTitle>
              <DialogDescription>AI draft with personal details removed. Edit it, then save. The chat assistant will use it for similar questions.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5"><Label htmlFor="kb-t">Title</Label><Input id="kb-t" required maxLength={120} value={kb?.title ?? ''} onChange={(e) => kb && setKb({ ...kb, title: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="kb-c">Answer</Label><Textarea id="kb-c" required rows={6} maxLength={1200} value={kb?.content ?? ''} onChange={(e) => kb && setKb({ ...kb, content: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setKb(null)}>Cancel</Button>
              <Button type="submit" disabled={savingKb}>{savingKb && <Loader2 className="size-4 animate-spin" />} Save to knowledge base</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
