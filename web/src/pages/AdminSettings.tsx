import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useStoreSettings } from '@/lib/useSettings'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function AdminSettings() {
  const { settings, loading } = useStoreSettings()
  const [upi, setUpi] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [hours, setHours] = useState('24')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    setUpi(settings.upi_id)
    setName(settings.upi_name)
    setNote(settings.payment_note)
    setEmail(settings.support_email)
    setHours(settings.unpaid_expiry_hours)
  }, [loading, settings])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    for (const [key, value] of [['upi_id', upi], ['upi_name', name], ['payment_note', note], ['support_email', email], ['unpaid_expiry_hours', hours]] as const) {
      const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value })
      if (error) {
        setBusy(false)
        return void toast.error(error.message)
      }
    }
    setBusy(false)
    toast.success('Settings saved')
  }

  return (
    <Page title="Payment and notification settings" description="Customers pay with GPay / any UPI app to your UPI ID. Money goes straight to your bank account.">
      <Card className="max-w-xl">
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="upi">Your UPI ID</Label>
              <Input id="upi" placeholder="yourname@okhdfcbank" value={upi} onChange={(e) => setUpi(e.target.value)} />
              <p className="text-xs text-muted-foreground">Find it in GPay under your profile. Leave empty to turn online payment off.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payee">Payee name shown to customers</Label>
              <Input id="payee" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Extra payment note (optional)</Label>
              <Textarea id="note" rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semail">Support email (where you get alerts)</Label>
              <Input id="semail" type="email" placeholder="support@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">You are emailed about new orders, payments to verify and tickets. Customers see this address on the chat's "Email us" button. Email sending also needs the setup described in the README.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hours">Cancel unpaid orders after (hours)</Label>
              <Input id="hours" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} />
              <p className="text-xs text-muted-foreground">Orders still waiting for payment after this time are cancelled automatically and the stock is returned.</p>
            </div>
            <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save</Button>
          </form>
        </CardContent>
      </Card>
    </Page>
  )
}
