import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Product } from '@/lib/types'
import { money } from '@/lib/format'
import { EmptyState, Page } from '@/components/Page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const empty = { name: '', description: '', price: '0', stock: '0', image_url: '' }

export default function AdminProducts() {
  const [items, setItems] = useState<Product[]>([])
  const [soldByProduct, setSoldByProduct] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Product | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  const load = async () => {
    const [{ data, error }, { data: orders }] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('orders').select('product_id, quantity, status'),
    ])
    if (error) toast.error(error.message)
    setItems((data as Product[]) ?? [])
    const sold: Record<string, number> = {}
    for (const o of (orders as { product_id: string; quantity: number; status: string }[]) ?? []) {
      if (o.status === 'cancelled') continue
      sold[o.product_id] = (sold[o.product_id] ?? 0) + (o.quantity ?? 0)
    }
    setSoldByProduct(sold)
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const openNew = () => {
    setEditing(null)
    setForm(empty)
    setOpen(true)
  }
  const openEdit = (p: Product) => {
    setEditing(p.id)
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      stock: String(p.stock),
      image_url: p.image_url ?? '',
    })
    setOpen(true)
  }

  const uploadImage = async (file: File) => {
    setUploadingImage(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from('product-images').getPublicUrl(path)
      setForm((f) => ({ ...f, image_url: data.publicUrl }))
      toast.success('Image uploaded')
    } catch (e: any) {
      toast.error(e?.message || 'Image upload failed')
    } finally {
      setUploadingImage(false)
    }
  }
  const save = async (e: FormEvent) => {

    e.preventDefault()
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Number(form.price),
      stock: Number(form.stock),
      image_url: form.image_url.trim() || null,
    }
    const { error } = editing
      ? await supabase.from('products').update(payload).eq('id', editing)
      : await supabase.from('products').insert(payload)
    setSaving(false)
    if (error) return void toast.error(error.message)
    toast.success(editing ? 'Product updated' : 'Product added')
    setOpen(false)
    load()
  }

  const toggle = async (p: Product) => {
    const { error } = await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) toast.error(error.message)
    else toast.success(p.is_active ? 'Product hidden from store' : 'Product visible in store')
    load()
  }

  const remove = async () => {
    if (!toDelete) return
    const { error } = await supabase.from('products').delete().eq('id', toDelete.id)
    if (error) {
      toast.error(error.message.includes('foreign key') ? 'This product has orders. Hide it instead of deleting.' : error.message)
    } else {
      toast.success('Product deleted')
    }
    setToDelete(null)
    load()
  }

  return (
    <Page
      title="Manage products"
      description="Add, edit, hide, or remove products in the store."
      actions={<Button size="lg" onClick={openNew}><Plus className="size-4" />Add product</Button>}
    >
      {!loading && items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total products</p>
            <p className="text-2xl font-semibold">{items.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Sold out</p>
            <p className="text-2xl font-semibold text-destructive">{items.filter((p) => p.stock <= 0).length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Yet to sell (stock)</p>
            <p className="text-2xl font-semibold">{items.reduce((s, p) => s + (p.stock > 0 ? p.stock : 0), 0)}</p>
            <p className="text-xs text-muted-foreground">{items.filter((p) => p.stock > 0).length} products in stock</p>
          </Card>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Package />} title="No products yet" hint="Add your first product to get started." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Left</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right">{money(p.price)}</TableCell>
                    <TableCell className="text-right">{(soldByProduct[p.id] ?? 0) + p.stock}</TableCell>
                    <TableCell className="text-right">{soldByProduct[p.id] ?? 0}</TableCell>
                    <TableCell className="text-right">{p.stock}</TableCell>

                  <TableCell>
                    <Badge variant={p.is_active ? 'secondary' : 'outline'}>{p.is_active ? 'Visible' : 'Hidden'}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={p.is_active ? `Hide ${p.name}` : `Show ${p.name}`} onClick={() => toggle(p)}>
                        {p.is_active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)}><Trash2 className="size-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit product' : 'Add product'}</DialogTitle>
              <DialogDescription>Customers see active products in the store.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-price">Price (INR)</Label>
                <Input id="p-price" type="number" min="0" step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-stock">Stock</Label>
                <Input id="p-stock" type="number" min="0" step="1" required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-image">Image (optional)</Label>
              <div className="flex items-center gap-3">
                {form.image_url && <img src={form.image_url} alt="" className="size-16 rounded object-cover" />}
                <div className="flex-1 space-y-2">
                  <Input id="p-image" type="url" placeholder="https://… or upload below" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
                  <Input type="file" accept="image/*" disabled={uploadingImage} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f) }} />
                  {uploadingImage && <p className="text-xs text-muted-foreground">Uploading…</p>}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {editing ? 'Save changes' : 'Add product'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
            <DialogDescription>
              "{toDelete?.name}" will be permanently removed. Products with existing orders can't be deleted; hide them instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
