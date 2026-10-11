import { Navigate } from 'react-router-dom'
import AuthForm from '../components/AuthForm'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { session, loading } = useAuth()
  if (!loading && session) return <Navigate to="/" replace />
  return (
    <AuthForm
      title="Welcome back"
      description="Sign in with your Google account"
      buttonLabel="Sign in with Google"
      footer={{ text: 'New here?', to: '/signup', label: 'Sign up' }}
    />
  )
}
