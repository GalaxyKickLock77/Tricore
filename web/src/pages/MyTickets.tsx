import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, LifeBuoy, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Ticket, TicketComment } from '@/lib/types'
import { EmptyState, Page } from '@/components/Page'
import TicketThread from '@/components/TicketThread'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

export default function MyTickets() {
  const { session } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [comments, setComments] = useState<TicketComment[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(session?.user.email ?? '')
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  const load = async () => {
    const [t, c] = await Promise.all([
      supabase.from('support_requests').select('*, profiles(full_name, email)').order('created_at', { ascending: false }),
      supabase.from('ticket_comments').select('*').order('created_at', { ascending: true }),
    ])
    if (t.error) toast.error(t.error.message)
    const tk = (t.data as Ticket[]) ?? []
    const cm = (c.data as TicketComment[]) ?? []
    setTickets(tk)
    setComments(cm)
    setLoading(false)

    // tickets with team replies / status changes the customer has not seen: show "New" now, mark as seen shortly after
    const unseen = tk.filter((x) => cm.some((y) => y.ticket_id === x.id && y.author_role !== 'customer' && !y.is_internal && (!x.customer_last_seen || y.created_at > x.customer_last_seen)))
    setFresh(new Set(unseen.map((x) => x.id)))
    if (unseen.length) {
      setTimeout(async () => {
        await Promise.all(unseen.map((x) => supabase.rpc('mark_ticket_seen', { p_ticket: x.id })))
        window.dispatchEvent(new Event('tickets-seen'))
      }, 2500)
    }
  }
  useEffect(() => {
    load()
    const ch = supabase
      .channel('my-tickets-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_comments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const byTicket = useMemo(() => {
    const map = new Map<string, TicketComment[]>()
    for (const c of comments) map.set(c.ticket_id, [...(map.get(c.ticket_id) ?? []), c])
    return map
  }, [comments])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const question = (subject.trim() ? `${subject.trim()}\n\n${details.trim()}` : details.trim()).slice(0, 2000)
    const { data, error } = await supabase.rpc('create_support_request', {
      p_contact: email,
      p_question: question,
      p_reason: 'opened from the Support page',
      p_transcript: [],
    })
    setSaving(false)
    if (error) return void toast.error(error.message)
    toast.success(`Ticket #${String(data ?? '').slice(0, 8).toUpperCase()} opened`)
    setOpen(false)
    setSubject('')
    setDetails('')
    load()
  }

  return (
    <Page
      title="Support"
      description="Open a ticket for anything you need from the Tricore team. Their replies show up here."
      actions={<Button size="lg" onClick={() => setOpen(true)}><Plus className="size-4" />New ticket</Button>}
    >
      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : tickets.length === 0 ? (
        <EmptyState icon={<LifeBuoy />} title="No tickets yet" hint='Click "New ticket" to contact our team.' />
      ) : (
        <div className="space-y-4">
          {tickets.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <TicketStatusBadge status={t.status} />
                  {fresh.has(t.id) && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white">New reply</span>}
                  <span className="font-mono text-xs text-muted-foreground">#{t.id.slice(0, 8).toUpperCase()}</span>
                  <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{t.question}</p>
                <TicketThread ticketId={t.id} comments={byTicket.get(t.id) ?? []} isAdmin={false} onPosted={load} allowReply={t.status !== 'resolved'} />
                {t.status === 'resolved' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-500/10 p-2 text-sm">
                    <span>This ticket is resolved. If you need further help, open a new ticket.</span>
                    <Button size="lg" onClick={() => setOpen(true)}>Open new ticket</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={create} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Open a support ticket</DialogTitle>
              <DialogDescription>Tell us what you need. We will reply here, in this Support page.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="tk-email">Your email</Label>
              <Input id="tk-email" type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tk-subject">Subject (optional)</Label>
              <Input id="tk-subject" maxLength={120} placeholder="For example: Question about my order" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tk-details">How can we help?</Label>
              <Textarea id="tk-details" required rows={5} maxLength={1800} value={details} onChange={(e) => setDetails(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !details.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" />} Open ticket
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
