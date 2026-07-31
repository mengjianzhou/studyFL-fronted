import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { statsApi } from '../api/stats'
import type { BankStats, Statistics } from '../types'

export default function StatsPage() {
  const [stats, setStats] = useState<Statistics | null>(null)
  const [banks, setBanks] = useState<BankStats[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    statsApi
      .me(30)
      .then(setStats)
      .catch((e) => setError((e as Error).message))
    statsApi.banks().then(setBanks).catch(() => {})
  }, [])

  if (error) return <div className="flex h-full items-center justify-center text-slate-400">{error}</div>
  if (!stats) return <div className="flex h-full items-center justify-center text-slate-400">加载统计中…</div>

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h2 className="mb-1 text-2xl font-bold text-slate-800">学习统计</h2>
      <p className="mb-6 text-sm text-slate-500">近 30 天的练习数据</p>

      {/* 统计卡片 */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="练习次数" value={`${stats.totalPractices}`} icon="🎯" />
        <StatCard label="打字字符" value={formatNum(stats.totalKeystrokes)} icon="⌨️" />
        <StatCard label="平均正确率" value={`${Number(stats.avgAccuracy).toFixed(1)}%`} icon="✅" />
        <StatCard label="平均速度" value={`${Number(stats.avgWpm).toFixed(1)} WPM`} icon="⚡" />
      </div>

      {/* 近 30 天柱状图 */}
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-semibold text-slate-700">每日练习次数</h3>
        {stats.daily.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">还没有练习记录，去练一练吧！</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stats.daily} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [`${value} 次`, '练习']}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
              <Bar dataKey="count" fill="#818cf8" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 各词库表现 */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-semibold text-slate-700">词库表现</h3>
        {banks.filter((b) => b.practices > 0).length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">暂无词库练习数据</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="pb-2 font-medium">词库</th>
                <th className="pb-2 font-medium">练习次数</th>
                <th className="pb-2 font-medium">正确率</th>
                <th className="pb-2 font-medium">平均速度</th>
                <th className="pb-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {banks
                .filter((b) => b.practices > 0)
                .map((b) => (
                  <tr key={b.bankId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5">
                      <div className="font-medium text-slate-700">{b.bankName}</div>
                      <div className="text-xs text-slate-400">
                        {b.groupName} · {b.languageCode.toUpperCase()}
                      </div>
                    </td>
                    <td className="py-2.5 text-slate-600">{b.practices}</td>
                    <td className="py-2.5 text-slate-600">{Number(b.avgAccuracy).toFixed(1)}%</td>
                    <td className="py-2.5 text-slate-600">{Number(b.avgWpm).toFixed(1)} WPM</td>
                    <td className="py-2.5">
                      {b.progressStatus === 'COMPLETED' ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-600">已完成</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-600">练习中</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-center shadow-sm">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 text-xl font-bold text-brand-dark">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  )
}

function formatNum(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}
