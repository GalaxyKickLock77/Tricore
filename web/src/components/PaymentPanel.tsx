import { useState, type FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Copy, Loader2, Smartphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { buildUpiLink } from '@/lib/payments'
import { money, orderRef } from '@/lib/format'
import type { StoreSettings } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Pay with GPay / any UPI app, then tell us the transaction id so the team can verify it in the bank. */
export default function PaymentPanel({ orderId, total, settings, onSubmitted }: {
  orderId: string
  total: number
  settings: StoreSettings
  onSubmitted: () => void
}) {
  const [utr, setUtr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { profile } = useAuth()

  if (!settings.upi_id) {
    return (
      <p className="rounded-lg bg-amber-500/10 p-3 text-sm">
        Online payment details are not set up yet. Your order is saved; our team will contact you with the payment details.
        {profile?.role === 'admin' && (
          <> <b>Admin:</b> add your UPI ID on the <Link to="/admin/settings" className="underline">Payment settings</Link> page and GPay payment will appear here.</>
        )}
      </p>
    )
  }

  const link = buildUpiLink({ upiId: settings.upi_id, name: settings.upi_name || 'Tricore', amount: total, note: `Tricore order ${orderRef(orderId)}` })
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error('Could not copy')
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('submit_payment', { p_order: orderId, p_reference: utr })
    setBusy(false)
    if (error) return setError(error.message)
    toast.success('Thanks! We are verifying your payment.')
    onSubmitted()
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="mx-auto rounded-xl border bg-white p-3">
          <QRCodeSVG value={link} size={150} />
          <p className="mt-1 text-center text-[11px] text-neutral-500">Scan with GPay</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Amount to pay</p>
          <p className="flex items-center gap-2 text-2xl font-semibold">
            {money(total)}
            <button type="button" aria-label="Copy amount" className="text-muted-foreground hover:text-foreground" onClick={() => copy(total.toFixed(2), 'Amount')}><Copy className="size-4" /></button>
          </p>
          <p className="flex flex-wrap items-center gap-2">
            Pay to UPI ID: <b className="break-all">{settings.upi_id}</b>
            <button type="button" aria-label="Copy UPI ID" className="text-muted-foreground hover:text-foreground" onClick={() => copy(settings.upi_id, 'UPI ID')}><Copy className="size-4" /></button>
          </p>
          <p className="text-muted-foreground">Payee: {settings.upi_name}</p>
          <Button asChild size="lg" className="mt-1 w-full sm:w-auto">
            <a href={link}><Smartphone className="size-4" /> Pay with GPay / UPI app</a>
          </Button>
          <p className="text-xs text-muted-foreground">On a phone the button opens your UPI app with the amount filled in. On a computer, scan the QR code with GPay.</p>
        </div>
      </div>
      {settings.payment_note && <p className="rounded-lg bg-muted/60 p-2 text-xs">{settings.payment_note}</p>}

      <form onSubmit={submit} className="space-y-2 rounded-xl border p-3">
        <Label htmlFor={`utr-${orderId}`}>After paying, enter the UPI transaction ID (UTR)</Label>
        <Input id={`utr-${orderId}`} required minLength={6} maxLength={40} placeholder="For example 412345678901" value={utr} onChange={(e) => setUtr(e.target.value)} />
        <p className="text-xs text-muted-foreground">You can find it in GPay under the payment details ("UPI transaction ID").</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={busy || utr.trim().length < 6}>
          {busy && <Loader2 className="size-4 animate-spin" />} I have paid
        </Button>
      </form>
    </div>
  )
}
