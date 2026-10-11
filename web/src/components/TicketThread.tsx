import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { TicketComment } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Comment thread plus reply box. Used by customers (My tickets) and by admins (Support tickets). */
export default function TicketThread({ ticketId, comments, isAdmin, onPosted }: {
  ticketId: string
  comments: TicketComment[]
  isAdmin: boolean
  onPosted: () => void
}) {
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)

  const post = async (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('add_ticket_comment', { p_ticket: ticketId, p_body: body, p_internal: isAdmin && internal })
    setBusy(false)
    if (error) return void toast.error(error.message)
    setBody('')
    setInternal(false)
    toast.success(isAdmin && internal ? 'Internal note added' : 'Update posted')
    onPosted()
  }

  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
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
          rows={2}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isAdmin ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal note (the customer cannot see it)
            </label>
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
