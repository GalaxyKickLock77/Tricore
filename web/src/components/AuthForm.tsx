import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, Store, Truck, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  title: string
  description: string
  submitLabel: string
  showName?: boolean
  onSubmit: (v: { email: string; password: string; fullName: string }) => Promise<string | null>
  footer: { text: string; to: string; label: string }
}

const perks = [
  { icon: ShieldCheck, text: 'Secure sign-in and private order history' },
  { icon: Truck, text: 'Track every order from pending to shipped' },
  { icon: Store, text: 'Fresh products added by our team' },
]

export default function AuthForm({ title, description, submitLabel, showName, onSubmit, footer }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await onSubmit({ email, password, fullName })
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div className="absolute -right-24 -top-24 size-80 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <Store className="size-5" /> Tricore Store
        </div>
        <div className="relative space-y-6">
          <h2 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
            Shop smarter. Manage everything in one place.
          </h2>
          <ul className="space-y-3">
            {perks.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-primary-foreground/80">
                <Icon className="size-5" /> {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-primary-foreground/60">© {new Date().getFullYear()} Tricore</p>
      </div>

      <div className="flex items-center justify-center bg-muted/30 p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                {showName && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Full name</Label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input id="name" className="pl-8" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input id="email" type="email" required autoComplete="email" className="pl-8"
                      value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input id="password" type={show ? 'text' : 'password'} required minLength={8}
                      autoComplete={showName ? 'new-password' : 'current-password'} className="px-8"
                      value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" aria-label={show ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setShow((s) => !s)}>
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {showName && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
                </div>
                {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy ? 'Please wait…' : submitLabel}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {footer.text}{' '}
                  <Link className="font-medium text-primary underline-offset-4 hover:underline" to={footer.to}>{footer.label}</Link>
                </p>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
