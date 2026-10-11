import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, LifeBuoy, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { EmptyState, Page } from '@/components/Page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface Request {
  id: string
  contact: string
  question: string
  reason: string | null
  transcript: { role: string; content: string }[]
  status: 'open' | 'resolved'
  created_at: string
}

export default function AdminSupport() {
  const [items, setItems] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data, error } = await supabase
      .from('support_requests')
      .select('*')
      .order('status', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    setItems((data as Request[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const setStatus = async (id: string, status: Request['status']) => {
    const { error } = await supabase.from('support_requests').update({ status }).eq('id', id)
    if (error) toast.error(error.message)
    else toast.success(status === 'resolved' ? 'Marked as resolved' : 'Reopened')
    load()
  }

  const open = items.filter((i) => i.status === 'open').length

  return (
    <Page title="Support requests" description={`${open} open. Customers the assistant handed over to the team.`}>
      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : items.length === 0 ? (
        <EmptyState icon={<LifeBuoy />} title="No support requests yet" hint="Requests appear here when the assistant hands a customer to the team." />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id} className={r.status === 'resolved' ? 'opacity-70' : ''}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === 'open' ? 'default' : 'secondary'} className="capitalize">{r.status}</Badge>
                    <span className="font-medium">{r.contact}</span>
                    <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  {r.status === 'open' ? (
                    <Button size="lg" variant="outline" onClick={() => setStatus(r.id, 'resolved')}><CheckCircle2 className="size-4" />Mark resolved</Button>
                  ) : (
                    <Button size="lg" variant="ghost" onClick={() => setStatus(r.id, 'open')}><RotateCcw className="size-4" />Reopen</Button>
                  )}
                </div>
                <p className="text-sm">{r.question}</p>
                {r.reason && <p className="text-xs text-muted-foreground">Why handed over: {r.reason}</p>}
                {r.transcript.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Conversation ({r.transcript.length})</summary>
                    <ul className="mt-2 space-y-1 rounded-md bg-muted/50 p-2">
                      {r.transcript.map((t, i) => (
                        <li key={i}><b className="capitalize">{t.role}:</b> {t.content}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}
