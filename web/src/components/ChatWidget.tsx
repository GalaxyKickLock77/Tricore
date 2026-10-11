import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, CheckCircle2, Headset, LifeBuoy, Loader2, Mail, MessageCircle, Send, ShoppingBag, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { contact } from '@/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  sources?: { id: string; title: string }[]
}

interface OrderProposal {
  product_id: string
  name: string
  unit_price: number
  quantity: number
}

interface BotReply {
  action: 'answer' | 'offer_team' | 'handoff' | 'confirm_order'
  order?: OrderProposal
  answer: string
  sources: { id: string; title: string }[]
  handoffReason?: string
  memory?: string[]
}

const GREETING: Msg = {
  role: 'assistant',
  content: 'Hi! I\'m the Tricore assistant. Ask me about our products, how ordering works, or your account.',
}
const SUGGESTIONS = ['What do you sell?', 'How do I place an order?', 'Where can I see my order status?']
const HIDDEN_ON = ['/login', '/signup']

/** The question the team should see: the latest user message that is not just a yes/no. */
function lastTopic(msgs: Msg[], fallback: string): string {
  const real = [...msgs].reverse().find((m) => m.role === 'user' && m.content.trim().length > 12)
  return (real?.content ?? fallback).slice(0, 500)
}

export default function ChatWidget() {
  const { pathname } = useLocation()
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [handoff, setHandoff] = useState<{ question: string; reason: string } | null>(null)
  const [proposal, setProposal] = useState<OrderProposal | null>(null)
  const [offer, setOffer] = useState<{ question: string; reason: string } | null>(null)
  const [sent, setSent] = useState<{ ref: string; contact: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const memoryRef = useRef<string[]>([])
  const meta = session?.user.user_metadata as { full_name?: string; name?: string } | undefined
  const firstName = (meta?.full_name ?? meta?.name ?? '').trim().split(/\s+/)[0] || undefined

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, handoff, offer, proposal, sent, open])

  if (HIDDEN_ON.includes(pathname)) return null

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || loading) return
    const next: Msg[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setOffer(null)
    setProposal(null)
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          // skip the local greeting; send only recent turns
          messages: next.slice(1).slice(-8).map(({ role, content }) => ({ role, content })),
          name: firstName,
          memory: memoryRef.current,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const reply = (await res.json()) as BotReply
      if (Array.isArray(reply.memory)) memoryRef.current = reply.memory
      setMessages((m) => [...m, { role: 'assistant', content: reply.answer, sources: reply.sources }])
      if (reply.action === 'handoff') setHandoff({ question: lastTopic(next, question), reason: reply.handoffReason ?? '' })
      if (reply.action === 'confirm_order' && reply.order) setProposal(reply.order)
      if (reply.action === 'offer_team') setOffer({ question: lastTopic(next, question), reason: reply.handoffReason ?? '' })
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: "Sorry, I'm having trouble answering right now. Would you like me to connect you with my team?" },
      ])
      setOffer({ question, reason: 'assistant unavailable' })
    } finally {
      setLoading(false)
    }
  }

  const acceptOffer = () => {
    if (!offer) return
    setMessages((m) => [
      ...m,
      { role: 'user', content: 'Yes, please connect me.' },
      { role: 'assistant', content: 'Great, let\'s get you to my team. You can open a support ticket right here, or email them directly. Whichever you prefer.' },
    ])
    setHandoff(offer)
    setOffer(null)
  }

  const declineOffer = () => {
    setMessages((m) => [
      ...m,
      { role: 'user', content: 'No thanks.' },
      { role: 'assistant', content: 'No problem at all! If you change your mind, just say the word. Anything else I can help with?' },
    ])
    setOffer(null)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void ask(input)
  }

  const askHuman = () => {
    setOffer(null)
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

              {proposal && !loading && (
                <OrderConfirm
                  key={`${proposal.product_id}-${proposal.quantity}`}
                  proposal={proposal}
                  signedIn={!!session}
                  onDone={(text) => {
                    setProposal(null)
                    setMessages((m) => [...m, { role: 'assistant', content: text }])
                  }}
                  onCancel={() => {
                    setProposal(null)
                    setMessages((m) => [...m, { role: 'assistant', content: 'No problem, I have not placed anything. Anything else I can help with?' }])
                  }}
                />
              )}

              {offer && !loading && (
                <div className="flex flex-wrap gap-2">
                  <Button size="lg" onClick={acceptOffer}><Headset className="size-4" />Yes, connect me</Button>
                  <Button size="lg" variant="outline" onClick={declineOffer}>No thanks</Button>
                </div>
              )}

              {handoff && !sent && (
                <ContactOptions
                  key={handoff.question}
                  initialQuestion={handoff.question}
                  reason={handoff.reason}
                  defaultContact={session?.user.email ?? ''}
                  transcript={messages.slice(-12).map(({ role, content }) => ({ role, content }))}
                  onDone={(ref, contactValue) => {
                    setSent({ ref, contact: contactValue })
                    setHandoff(null)
                  }}
                  onCancel={() => setHandoff(null)}
                />
              )}
              {sent && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <p>
                    Your support ticket <b>#{sent.ref}</b> is open. Our team will reply to <b>{sent.contact}</b>.
                  </p>
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
                  <Headset className="size-3.5" /> Contact the team
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

function OrderConfirm({ proposal, signedIn, onDone, onCancel }: {
  proposal: OrderProposal
  signedIn: boolean
  onDone: (text: string) => void
  onCancel: () => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = proposal.unit_price * proposal.quantity
  const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  // The order is placed by the customer's own signed-in session, never by the assistant.
  const confirm = async () => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('place_order', { p_product_id: proposal.product_id, p_quantity: proposal.quantity })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone(`Done! I've placed your order for ${proposal.quantity} × ${proposal.name}. It shows as pending in My orders, and the Tricore team will contact you to confirm the details and arrange payment.`)
  }

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium"><ShoppingBag className="size-4 text-primary" /> Confirm your order</p>
      <div className="flex justify-between gap-2">
        <span>{proposal.quantity} × {proposal.name}</span>
        <span className="font-medium">{money(total)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{money(proposal.unit_price)} each. Payment is arranged with our team after the order.</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {signedIn ? (
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" disabled={busy} onClick={confirm}>
            {busy && <Loader2 className="size-4 animate-spin" />} Confirm order
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs">Please sign in with Google to place this order, then ask me again.</p>
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => navigate('/login')}>Sign in</Button>
            <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
      {signedIn && (
        <Link to="/orders" className="block text-xs text-muted-foreground underline-offset-4 hover:underline">View my orders</Link>
      )}
    </div>
  )
}

/** The only two ways to reach the team: open a support ticket, or send an email. */
function ContactOptions({ initialQuestion, reason, defaultContact, transcript, onDone, onCancel }: {
  initialQuestion: string
  reason: string
  defaultContact: string
  transcript: { role: string; content: string }[]
  onDone: (ref: string, contact: string) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<'choose' | 'ticket'>('choose')
  const [email, setEmail] = useState(defaultContact)
  const [question, setQuestion] = useState(initialQuestion)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mailto = contact.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent('Tricore support request')}&body=${encodeURIComponent(
        `${initialQuestion || 'Hello, I need help with...'}\n\n--- Chat summary ---\n${transcript
          .slice(-6)
          .map((t) => `${t.role === 'user' ? 'Me' : 'Assistant'}: ${t.content}`)
          .join('\n')}`.slice(0, 1500),
      )}`
    : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('create_support_request', {
      p_contact: email,
      p_question: question,
      p_reason: reason || null,
      p_transcript: transcript,
    })
    setBusy(false)
    if (error) setError(error.message)
    else onDone(String(data ?? '').slice(0, 8).toUpperCase(), email.trim())
  }

  if (mode === 'choose') {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-3 text-sm">
        <p className="flex items-center gap-1.5 font-medium"><Headset className="size-4 text-primary" /> Reach our team</p>
        <Button size="lg" className="w-full justify-start" onClick={() => setMode('ticket')}>
          <LifeBuoy className="size-4" /> Open a support ticket
        </Button>
        {mailto && (
          <Button asChild size="lg" variant="outline" className="w-full justify-start">
            <a href={mailto}><Mail className="size-4" /> Email us</a>
          </Button>
        )}
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Not now</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium"><LifeBuoy className="size-4 text-primary" /> Open a support ticket</p>
      <label className="block text-xs text-muted-foreground" htmlFor="tk-email">Your email</label>
      <Input id="tk-email" type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="block text-xs text-muted-foreground" htmlFor="tk-q">What do you need help with?</label>
      <Textarea id="tk-q" required maxLength={2000} rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={busy} className="flex-1">
          {busy && <Loader2 className="size-4 animate-spin" />} Open ticket
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => setMode('choose')}>Back</Button>
      </div>
    </form>
  )
}
