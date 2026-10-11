import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, CheckCircle2, Headset, Loader2, MessageCircle, Send, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  sources?: { id: string; title: string }[]
}

interface BotReply {
  action: 'answer' | 'handoff'
  answer: string
  sources: { id: string; title: string }[]
  handoffReason?: string
}

const GREETING: Msg = {
  role: 'assistant',
  content: 'Hi! I\'m the Tricore assistant. Ask me about our products, how ordering works, or your account.',
}
const SUGGESTIONS = ['What do you sell?', 'How do I place an order?', 'Where can I see my order status?']
const HIDDEN_ON = ['/login', '/signup']

export default function ChatWidget() {
  const { pathname } = useLocation()
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [handoff, setHandoff] = useState<{ question: string; reason: string } | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, handoff, sent, open])

  if (HIDDEN_ON.includes(pathname)) return null

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || loading) return
    const next: Msg[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // skip the local greeting; send only recent turns
          messages: next.slice(1).slice(-6).map(({ role, content }) => ({ role, content })),
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const reply = (await res.json()) as BotReply
      setMessages((m) => [...m, { role: 'assistant', content: reply.answer, sources: reply.sources }])
      if (reply.action === 'handoff') setHandoff({ question, reason: reply.handoffReason ?? '' })
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: "Sorry, I can't answer right now. I can connect you with the Tricore team instead." },
      ])
      setHandoff({ question, reason: 'assistant unavailable' })
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void ask(input)
  }

  const askHuman = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    setMessages((m) => [...m, { role: 'assistant', content: 'Sure, let me connect you with the Tricore team.' }])
    setHandoff({ question: lastUser, reason: 'customer asked for a human' })
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Tricore assistant"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-3 bottom-20 z-50 flex h-[32rem] max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:w-96"
          >
            <div className="flex items-center gap-2 bg-primary px-4 py-3 text-primary-foreground">
              <span className="grid size-8 place-items-center rounded-full bg-white/15"><Bot className="size-4" /></span>
              <div className="flex-1 leading-tight">
                <p className="text-sm font-semibold">Tricore Assistant</p>
                <p className="text-xs text-primary-foreground/70">Answers from Tricore information only</p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Close chat" className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {!!m.sources?.length && (
                      <p className="mt-1.5 text-xs text-muted-foreground">Based on: {m.sources.map((s) => s.title).join(', ')}</p>
                    )}
                  </div>
                </div>
              ))}

              {messages.length === 1 && (
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => void ask(s)}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{s}</button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Thinking…
                </div>
              )}

              {handoff && !sent && (
                <HandoffForm
                  key={handoff.question}
                  initialQuestion={handoff.question}
                  reason={handoff.reason}
                  defaultContact={session?.user.email ?? ''}
                  transcript={messages.slice(-12).map(({ role, content }) => ({ role, content }))}
                  onDone={(contact) => {
                    setSent(contact)
                    setHandoff(null)
                  }}
                  onCancel={() => setHandoff(null)}
                />
              )}
              {sent && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <p>Thanks! Our team has your request and will contact you at <b>{sent}</b>.</p>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t p-3">
              <form onSubmit={onSubmit} className="flex gap-2">
                <Input aria-label="Message" placeholder="Type your question…" maxLength={500} value={input}
                  onChange={(e) => setInput(e.target.value)} disabled={loading} />
                <Button type="submit" size="icon-lg" aria-label="Send" disabled={loading || !input.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
              {!handoff && !sent && (
                <button type="button" onClick={askHuman}
                  className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Headset className="size-3.5" /> Talk to the Tricore team
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        size="icon-lg"
        aria-label={open ? 'Close chat' : 'Open chat'}
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-50 size-13 rounded-full shadow-lg"
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
      </Button>
    </>
  )
}

function HandoffForm({ initialQuestion, reason, defaultContact, transcript, onDone, onCancel }: {
  initialQuestion: string
  reason: string
  defaultContact: string
  transcript: { role: string; content: string }[]
  onDone: (contact: string) => void
  onCancel: () => void
}) {
  const [contact, setContact] = useState(defaultContact)
  const [question, setQuestion] = useState(initialQuestion)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('create_support_request', {
      p_contact: contact,
      p_question: question,
      p_reason: reason || null,
      p_transcript: transcript,
    })
    setBusy(false)
    if (error) setError(error.message)
    else onDone(contact.trim())
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium"><Headset className="size-4 text-primary" /> Send this to our team</p>
      <label className="block text-xs text-muted-foreground" htmlFor="hf-contact">Your email or phone</label>
      <Input id="hf-contact" required minLength={3} maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
      <label className="block text-xs text-muted-foreground" htmlFor="hf-q">What do you need help with?</label>
      <Textarea id="hf-q" required maxLength={2000} rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={busy} className="flex-1">
          {busy && <Loader2 className="size-4 animate-spin" />} Send to team
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
