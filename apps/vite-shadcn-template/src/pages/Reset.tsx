import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

export default function Reset() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await api.reset(token, password)
      navigate('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <form className="space-y-4" onSubmit={onSubmit}>
        <Input type="password" placeholder="New password (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="w-full" disabled={pending || !token} type="submit">
          {pending ? 'Saving...' : 'Save password'}
        </Button>
      </form>
      <Link className="text-sm underline" to="/login">Back to login</Link>
    </main>
  )
}
