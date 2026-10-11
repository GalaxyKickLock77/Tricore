import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Send, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { callSupportAi } from '@/lib/ai'
import type { TicketComment } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Comment thread plus reply box. Used by customers (Support) and by admins (Support tickets). */
export default function TicketThread({ ticketId, comments, isAdmin, onPosted }: {
  ticketId: string
  comments: TicketComment[]
  isAdmin: boolean
  onPosted: () => void
}) {
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [notes, setNotes] = useState<{ items: string[]; confidence?: string } | null>(null)

  const post = async (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('add_ticket_comment', { p_ticket: ticketId, p_body: body, p_internal: isAdmin && internal })
    setBusy(false)
    if (error) return void toast.error(error.message)
    setBody('')
    setInternal(false)
    setNotes(null)
    toast.success(isAdmin && internal ? 'Internal note added' : 'Update posted')
    onPosted()
  }

  // Admin only: the AI writes a draft into the box. Nothing is sent until the admin presses Post.
  const suggest = async () => {
    setDrafting(true)
    try {
      const r = await callSupportAi('suggest_reply', ticketId)
      setBody(r.reply ?? '')
      setInternal(false)
      setNotes({ items: r.agent_notes ?? [], confidence: r.confidence })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The AI could not help right now.')
    } finally {
      setDrafting(false)
    }
  }

  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
            if (c.author_role === 'system') {
              return (
                <li key={c.id} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>{c.body} · {when(c.created_at)}</span>
                  <span className="h-px flex-1 bg-border" />
                </li>
              )
            }
            const mine = isAdmin ? c.author_role === 'admin' : c.author_role === 'customer'
            return (
              <li key={c.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                    c.is_internal ? 'border border-dashed border-amber-500/60 bg-amber-500/10' : mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  <p className={cn('mb-0.5 flex items-center gap-1 text-xs', mine && !c.is_internal ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                    {c.is_internal && <Lock className="size-3" />}
                    {c.is_internal ? 'Internal note' : c.author_role === 'admin' ? 'Tricore team' : 'Customer'} · {when(c.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={post} className="space-y-2">
        <Textarea
          aria-label={isAdmin ? 'Write an update' : 'Write a reply'}
          placeholder={isAdmin ? 'Write an update for the customer…' : 'Write a reply…'}
          rows={isAdmin && body.length > 160 ? 6 : 2}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {notes && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-xs">
            <p className="font-medium">AI draft. Please read and edit before posting{notes.confidence ? ` (confidence: ${notes.confidence})` : ''}.</p>
            {notes.items.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {notes.items.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="lg" variant="outline" disabled={drafting} onClick={suggest}>
                {drafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Suggest reply
              </Button>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                Internal note (the customer cannot see it)
              </label>
            </div>
          ) : (
            <span />
          )}
          <Button type="submit" size="lg" disabled={busy || !body.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {isAdmin ? (internal ? 'Add note' : 'Post update') : 'Send reply'}
          </Button>
        </div>
      </form>
    </div>
  )
}
