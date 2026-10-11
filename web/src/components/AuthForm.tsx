import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Loader2, ShieldCheck, Store, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'

interface Props {
  title: string
  description: string
  buttonLabel: string
  footer: { text: string; to: string; label: string }
}

const perks = [
  { icon: ShieldCheck, text: 'Secure sign-in with your Google account' },
  { icon: Truck, text: 'Track every order from pending to shipped' },
  { icon: Store, text: 'Fresh products added by our team' },
]

export default function AuthForm({ title, description, buttonLabel, footer }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const google = async () => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    // On success the browser navigates to Google, so only errors return here.
    if (error) {
      setError(error.message)
      setBusy(false)
    }
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
            <CardContent className="space-y-4">
              <Button type="button" size="lg" variant="outline" className="h-10 w-full" disabled={busy} onClick={google}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
                    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
                    <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.8V6.5H1.4a12 12 0 0 0 0 11l4-3.1z" />
                    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
                  </svg>
                )}
                {buttonLabel}
              </Button>
              {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
              <p className="text-center text-sm text-muted-foreground">
                {footer.text}{' '}
                <Link className="font-medium text-primary underline-offset-4 hover:underline" to={footer.to}>{footer.label}</Link>
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
