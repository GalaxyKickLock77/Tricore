import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { StoreSettings } from './types'

const empty: StoreSettings = { upi_id: '', upi_name: 'Tricore IT Solutions', payment_note: '', support_email: '', unpaid_expiry_hours: '24' }

/** Payment settings (UPI id etc.) that the admin maintains. Readable by signed-in users only. */
export function useStoreSettings() {
  const [settings, setSettings] = useState<StoreSettings>(empty)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase
      .from('store_settings')
      .select('key,value')
      .then(({ data }) => {
        const next = { ...empty }
        for (const row of (data ?? []) as { key: keyof StoreSettings; value: string }[]) next[row.key] = row.value
        setSettings(next)
        setLoading(false)
      })
  }, [])
  return { settings, loading, setSettings }
}
