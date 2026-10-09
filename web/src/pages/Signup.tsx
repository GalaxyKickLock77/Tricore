import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import AuthForm from '../components/AuthForm'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'

export default function Signup() {
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)

  if (notice) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 p-4 text-center">
        <MailCheck className="size-10 text-primary" />
        <p className="max-w-sm">{notice}</p>
        <Button asChild variant="outline"><Link to="/login">Go to sign in</Link></Button>
      </div>
    )
  }

  return (
    <AuthForm
      title="Create account"
      description="Join to start shopping"
      submitLabel="Sign up"
      showName
      footer={{ text: 'Already registered?', to: '/login', label: 'Sign in' }}
      onSubmit={async ({ email, password, fullName }) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) return error.message
        if (data.session) navigate('/')
        else setNotice('Check your email to confirm your account, then sign in.')
        return null
      }}
    />
  )
}
