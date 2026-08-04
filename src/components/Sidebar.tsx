import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useLibraryStore } from '../stores/libraryStore'
import type { BankVO, LanguageVO } from '../types'

/** 左侧词库树：语言 → 词库组（可折叠）→ 词库 */
export default function Sidebar() {
  const { tree, fetchTree } = useLibraryStore()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  const toggleGroup = (groupId: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4">
        <h1 className="text-lg font-bold text-brand-dark">
          <span className="mr-1">⌨️</span> LearnFL
        </h1>
        <p className="mt-0.5 text-xs text-slate-400">打字背单词</p>
      </div>

      <nav className="flex-1 overflow-auto px-2 py-3">
        {tree.map((lang) => (
          <div key={lang.id} className="mb-4">
            <div className="flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand"></span>
              {lang.name} ({lang.code})
            </div>
            {lang.groups.map((group) => {
              const collapsed = collapsedGroups.has(group.id)
              return (
                <div key={group.id} className="mb-1">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-brand-bg"
                  >
                    <span className="truncate">{group.name}</span>
                    <span className="text-xs text-slate-400">{collapsed ? '▸' : '▾'}</span>
                  </button>
                  {!collapsed && (
                    <div className="ml-2 mt-1 space-y-0.5 border-l border-slate-100 pl-2">
                      {group.banks.map((bank) => (
                        <BankLink key={bank.id} lang={lang} bank={bank} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {tree.length === 0 && (
          <p className="px-3 py-4 text-sm text-slate-400">加载词库中…</p>
        )}
      </nav>

      <div className="border-t border-slate-200 px-4 py-3">
        <NavLink
          to="/memory-rules"
          className={({ isActive }) =>
            `mb-1 block rounded-lg px-3 py-2 text-sm transition ${
              isActive ? 'bg-brand-bg font-medium text-brand-dark' : 'text-slate-600 hover:bg-slate-50'
            }`
          }
        >
          记忆规则
        </NavLink>
        <NavLink
          to="/stats"
          className={({ isActive }) =>
            `block rounded-lg px-3 py-2 text-sm transition ${
              isActive ? 'bg-brand-bg font-medium text-brand-dark' : 'text-slate-600 hover:bg-slate-50'
            }`
          }
        >
          📊 学习统计
        </NavLink>
      </div>
    </aside>
  )
}

function BankLink({ lang, bank }: { lang: LanguageVO; bank: BankVO }) {
  const hasWords = bank.wordCount > 0
  const hasSentences = bank.sentenceCount > 0
  const pct = bank.progress ? Math.round((bank.progress.completedCount / bank.progress.totalCount) * 100) : 0

  return (
    <NavLink
      to={`/practice/${bank.id}?mode=word`}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-sm transition ${
          isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'
        }`
      }
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate">{bank.name}</span>
        {hasWords && <span className="text-xs opacity-60">词</span>}
        {hasSentences && <span className="text-xs opacity-60">句</span>}
      </div>
      {bank.progress && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${bank.progress.status === 'COMPLETED' ? 'bg-green-400' : 'bg-brand'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <span className="sr-only">{lang.name}</span>
    </NavLink>
  )
}
