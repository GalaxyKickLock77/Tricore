import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { BookOpenText, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { EmptyState, Page } from '@/components/Page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

interface Article { id: string; slug: string; title: string; content: string; category: string; is_published: boolean }

const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'article'

/** What the chat assistant knows. Edit it here instead of in the database. */
export default function AdminKnowledge() {
  const [items, setItems] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Partial<Article> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('kb_articles').select('id,slug,title,content,category,is_published').order('category').order('title')
    if (error) toast.error(error.message)
    setItems((data as Article[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!edit) return
    setSaving(true)
    const payload = { title: (edit.title ?? '').trim(), content: (edit.content ?? '').trim() }
    const { error } = edit.id
      ? await supabase.from('kb_articles').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', edit.id)
      : await supabase.from('kb_articles').insert({ ...payload, slug: `${slugify(payload.title)}-${Math.random().toString(36).slice(2, 6)}`, category: 'general' })
    setSaving(false)
    if (error) return void toast.error(error.message)
    toast.success('Saved')
    setEdit(null)
    load()
  }

  const toggle = async (a: Article) => {
    const { error } = await supabase.from('kb_articles').update({ is_published: !a.is_published }).eq('id', a.id)
    if (error) toast.error(error.message)
    load()
  }

  const remove = async (a: Article) => {
    if (a.category === 'core') return void toast.error('Core articles cannot be deleted here. Unpublish or edit them instead.')
    if (!confirm(`Delete "${a.title}"?`)) return
    const { error } = await supabase.from('kb_articles').delete().eq('id', a.id)
    if (error) toast.error(error.message)
    load()
  }

  return (
    <Page
      title="Knowledge base"
      description="The chat assistant answers only from these articles and the live product list."
      actions={<Button size="lg" onClick={() => setEdit({ title: '', content: '' })}><Plus className="size-4" />New article</Button>}
    >
      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : items.length === 0 ? (
        <EmptyState icon={<BookOpenText />} title="No articles yet" />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Card key={a.id} className={a.is_published ? '' : 'opacity-60'}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    {a.category === 'core' && <Badge variant="secondary">Always used</Badge>}
                    {!a.is_published && <Badge variant="outline">Hidden</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${a.title}`} onClick={() => setEdit(a)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={a.is_published ? `Hide ${a.title}` : `Show ${a.title}`} onClick={() => toggle(a)}>{a.is_published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${a.title}`} onClick={() => remove(a)}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{a.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{edit?.id ? 'Edit article' : 'New article'}</DialogTitle>
              <DialogDescription>Write facts only. The assistant repeats what is written here.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5"><Label htmlFor="a-title">Title</Label><Input id="a-title" required maxLength={120} value={edit?.title ?? ''} onChange={(e) => edit && setEdit({ ...edit, title: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="a-body">Content</Label><Textarea id="a-body" required rows={8} maxLength={1500} value={edit?.content ?? ''} onChange={(e) => edit && setEdit({ ...edit, content: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
