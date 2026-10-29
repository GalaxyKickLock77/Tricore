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

export default function AdminSettings() {
  const { settings, loading } = useStoreSettings()
  const [email, setEmail] = useState('')
  const [hours, setHours] = useState('24')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    setEmail(settings.support_email)
    setHours(settings.unpaid_expiry_hours)
  }, [loading, settings])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    for (const [key, value] of [['support_email', email], ['unpaid_expiry_hours', hours]] as const) {
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
    <Page title="Payment and notification settings" description="Payment is arranged with each customer on their order's support ticket.">
      <Card className="max-w-xl">
        <CardContent>
          <form onSubmit={save} className="space-y-4">
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
