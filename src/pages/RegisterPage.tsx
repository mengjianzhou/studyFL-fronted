import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/authStore'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.register({ username, password, nickname: nickname || undefined })
      setAuth(res.token, res.user)
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-bg via-white to-brand-bg">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-brand-dark">⌨️ LearnFL</h1>
          <p className="mt-2 text-sm text-slate-500">创建账号，开始你的单词之旅</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              placeholder="2-50 个字符"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              placeholder="至少 6 位"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">昵称（可选）</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              placeholder="默认使用用户名"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand py-2.5 font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading ? '注册中…' : '注 册'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          已有账号？{' '}
          <Link to="/login" className="font-medium text-brand-dark hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  )
}
