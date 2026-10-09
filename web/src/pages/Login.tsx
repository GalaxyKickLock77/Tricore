import { useNavigate } from 'react-router-dom'
import AuthForm from '../components/AuthForm'
import { supabase } from '../lib/supabase'

export default function Login() {
  const navigate = useNavigate()
  return (
    <AuthForm
      title="Welcome back"
      description="Sign in to your account"
      submitLabel="Sign in"
      footer={{ text: 'No account?', to: '/signup', label: 'Sign up' }}
      onSubmit={async ({ email, password }) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) return error.message
        navigate('/')
        return null
      }}
    />
  )
}
