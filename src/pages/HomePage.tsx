import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../stores/libraryStore'
import type { BankVO, LanguageVO } from '../types'

/** 词库选择页：语言 Tab → 词库组卡片 → 词库列表（双模式 + 进度条） */
export default function HomePage() {
  const { tree, loading, error, fetchTree } = useLibraryStore()
  const [activeLangId, setActiveLangId] = useState<number | null>(null)
  const navigate = useNavigate()

  if (loading && tree.length === 0) {
    return <div className="flex h-full items-center justify-center text-slate-400">加载中…</div>
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <p>{error}</p>
        <button onClick={fetchTree} className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark">
          重试
        </button>
      </div>
    )
  }

  const activeLang: LanguageVO | null =
    activeLangId == null ? tree[0] ?? null : tree.find((l) => l.id === activeLangId) ?? null

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h2 className="mb-1 text-2xl font-bold text-slate-800">选择词库开始练习</h2>
      <p className="mb-6 text-sm text-slate-500">边打字边记单词，错误必须重打，形成正确的肌肉记忆</p>

      {/* 语言 Tab */}
      <div className="mb-6 flex gap-2">
        {tree.map((lang) => (
          <button
            key={lang.id}
            onClick={() => setActiveLangId(lang.id)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition ${
              activeLang?.id === lang.id
                ? 'bg-brand text-white shadow'
                : 'bg-white text-slate-600 hover:bg-brand-bg'
            }`}
          >
            {lang.name}
          </button>
        ))}
      </div>

      {/* 词库组 → 词库 */}
      {activeLang?.groups.map((group) => (
        <section key={group.id} className="mb-8">
          <h3 className="mb-3 text-lg font-semibold text-slate-700">📚 {group.name}</h3>
          {group.description && <p className="mb-3 text-sm text-slate-400">{group.description}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.banks.map((bank) => (
              <BankCard key={bank.id} langCode={activeLang.code} bank={bank} onStart={navigate} />
            ))}
          </div>
          {group.banks.length === 0 && (
            <p className="text-sm text-slate-400">这个词库组还没有词库</p>
          )}
        </section>
      ))}

      {tree.length === 0 && <p className="text-center text-slate-400">暂无词库</p>}
    </div>
  )
}

function BankCard({
  langCode,
  bank,
  onStart,
}: {
  langCode: string
  bank: BankVO
  onStart: (path: string) => void
}) {
  const [mode, setMode] = useState<'word' | 'sentence'>('word')
  const hasWords = bank.wordCount > 0
  const hasSentences = bank.sentenceCount > 0
  const progress = bank.progress
  const pct = progress ? Math.round((progress.completedCount / progress.totalCount) * 100) : 0
  const completed = progress?.status === 'COMPLETED'

  // 当前模式没有数据时自动切换
  const effectiveMode = !hasWords ? 'sentence' : !hasSentences ? 'word' : mode

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-800">{bank.name}</h4>
          {bank.description && <p className="mt-0.5 text-xs text-slate-400">{bank.description}</p>}
        </div>
        {completed && (
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-600">✅ 已完成</span>
        )}
      </div>

      {/* 模式切换（词库有数据才可选） */}
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1">
        <ModeBtn active={effectiveMode === 'word'} disabled={!hasWords} onClick={() => setMode('word')}>
          单词模式{hasWords ? ` ${bank.wordCount}` : ''}
        </ModeBtn>
        <ModeBtn active={effectiveMode === 'sentence'} disabled={!hasSentences} onClick={() => setMode('sentence')}>
          句子模式{hasSentences ? ` ${bank.sentenceCount}` : ''}
        </ModeBtn>
      </div>

      {/* 进度条 */}
      {progress && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>学习进度</span>
            <span>
              {progress.completedCount}/{progress.totalCount} ({pct}%)
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full ${completed ? 'bg-green-400' : 'bg-brand'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <button
        onClick={() => onStart(`/practice/${bank.id}?mode=${effectiveMode}`)}
        className="w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        开始练习
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">练习语种：{langCode === 'ja' ? '日本語' : 'English'}</p>
    </div>
  )
}

function ModeBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  if (disabled) {
    return (
      <span className="flex-1 rounded-md px-3 py-1.5 text-center text-xs text-slate-300">{children}</span>
    )
  }
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-center text-xs transition ${
        active ? 'bg-white font-medium text-brand-dark shadow' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
