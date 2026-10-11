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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    setUpi(settings.upi_id)
    setName(settings.upi_name)
    setNote(settings.payment_note)
  }, [loading, settings])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    for (const [key, value] of [['upi_id', upi], ['upi_name', name], ['payment_note', note]] as const) {
      const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value })
      if (error) {
        setBusy(false)
        return void toast.error(error.message)
      }
    }
    setBusy(false)
    toast.success('Payment settings saved')
  }

  return (
    <Page title="Payment settings" description="Customers pay with GPay / any UPI app to this UPI ID. Money goes straight to your bank account.">
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
            <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save</Button>
          </form>
        </CardContent>
      </Card>
    </Page>
  )
}
