import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { manageApi } from '../api/manage'
import { useLibraryStore } from '../stores/libraryStore'
import type { BankVO, LanguageVO } from '../types'

type ModalState = null | { kind: 'group'; lang: LanguageVO } | { kind: 'bank'; lang: LanguageVO; groupId: number; groupName: string }

/** 词库选择页：语言 Tab → 词库组卡片 → 词库列表（双模式 + 进度条）+ 添加管理 */
export default function HomePage() {
  const { tree, loading, error, fetchTree } = useLibraryStore()
  const [activeLangId, setActiveLangId] = useState<number | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [notice, setNotice] = useState('')
  const navigate = useNavigate()

  const refresh = async () => {
    try {
      await fetchTree()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  if (loading && tree.length === 0) {
    return <div className="flex h-full items-center justify-center text-slate-400">加载中…</div>
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <p>{error}</p>
        <button onClick={refresh} className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark">
          重试
        </button>
      </div>
    )
  }

  const activeLang: LanguageVO | null =
    activeLangId == null ? tree[0] ?? null : tree.find((l) => l.id === activeLangId) ?? null

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">选择词库开始练习</h2>
          <p className="mt-1 text-sm text-slate-500">边打字边记单词，错误必须重打，形成正确的肌肉记忆</p>
        </div>
        {activeLang && (
          <button
            onClick={() => setModal({ kind: 'group', lang: activeLang })}
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            + 新增词库组
          </button>
        )}
      </div>

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
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-700">📚 {group.name}</h3>
              {group.description && <p className="mt-0.5 text-sm text-slate-400">{group.description}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal({ kind: 'bank', lang: activeLang, groupId: group.id, groupName: group.name })}
                className="rounded-lg border border-brand-light px-3 py-1.5 text-xs font-medium text-brand-dark transition hover:bg-brand-bg"
              >
                + 新增词库
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm(`确认删除词库组「${group.name}」？其下所有词库和数据都会被删除！`)) return
                  try {
                    await manageApi.deleteGroup(group.id)
                    refresh()
                  } catch (e) {
                    setNotice((e as Error).message)
                  }
                }}
                className="rounded-lg border border-red-100 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-50"
              >
                删除
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.banks.map((bank) => (
              <BankCard key={bank.id} langCode={activeLang.code} bank={bank} onStart={navigate} onDeleted={refresh} onNotice={setNotice} />
            ))}
          </div>
          {group.banks.length === 0 && (
            <p className="text-sm text-slate-400">这个词库组还没有词库，点右上角添加</p>
          )}
        </section>
      ))}

      {tree.length === 0 && <p className="text-center text-slate-400">暂无词库，点右上角创建</p>}

      {modal && (
        <CreateModal
          modal={modal}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await refresh()
          }}
          onError={setNotice}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-800 px-5 py-2 text-sm text-white shadow-lg">
          {notice}
          <button className="ml-3 text-slate-300 hover:text-white" onClick={() => setNotice('')}>✕</button>
        </div>
      )}
    </div>
  )
}

function BankCard({
  langCode,
  bank,
  onStart,
  onDeleted,
  onNotice,
}: {
  langCode: string
  bank: BankVO
  onStart: (path: string) => void
  onDeleted: () => void
  onNotice: (msg: string) => void
}) {
  const [mode, setMode] = useState<'word' | 'sentence'>('word')
  const hasWords = bank.wordCount > 0
  const hasSentences = bank.sentenceCount > 0
  const progress = bank.progress
  const pct = progress ? Math.round((progress.completedCount / progress.totalCount) * 100) : 0
  const completed = progress?.status === 'COMPLETED'

  // 当前模式没有数据时自动切换
  const effectiveMode = !hasWords ? 'sentence' : !hasSentences ? 'word' : mode

  const handleDelete = async () => {
    if (!window.confirm(`确认删除词库「${bank.name}」？其中的单词/句子/学习记录都会被删除！`)) return
    try {
      await manageApi.deleteBank(bank.id)
      onDeleted()
    } catch (e) {
      onNotice((e as Error).message)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-800">{bank.name}</h4>
          {bank.description && <p className="mt-0.5 text-xs text-slate-400">{bank.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {completed && (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-600">✅ 已完成</span>
          )}
          <button
            onClick={handleDelete}
            className="rounded p-1 text-xs text-slate-300 transition hover:text-red-400"
            title="删除词库"
          >
            🗑
          </button>
        </div>
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

      <div className="flex gap-2">
        <button
          onClick={() => onStart(`/practice/${bank.id}?mode=${effectiveMode}`)}
          className="flex-1 rounded-lg bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          开始练习
        </button>
        <Link
          to={`/manage/${bank.id}`}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 transition hover:border-brand-light hover:text-brand-dark"
          title="管理单词/句子数据"
        >
          ⚙
        </Link>
      </div>
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

/** 新增词库组 / 新增词库 弹窗 */
function CreateModal({
  modal,
  onClose,
  onSaved,
  onError,
}: {
  modal: Extract<ModalState, NonNullable<ModalState>>
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const isGroup = modal.kind === 'group'

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (isGroup) {
        await manageApi.createGroup({ languageId: modal.lang.id, name: name.trim(), description: description.trim() || undefined })
      } else {
        await manageApi.createBank({ groupId: modal.groupId, name: name.trim(), description: description.trim() || undefined })
      }
      onSaved()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-slate-800">
          {isGroup ? `新增词库组（${modal.lang.name}）` : `新增词库 → ${modal.groupName}`}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {isGroup ? '词库组名称' : '词库名称'}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isGroup ? '如：小学三年级的英语课本' : '如：第一课'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">描述（可选）</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isGroup ? '如：三年级上册教材' : '如：自我介绍与问候'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {saving ? '保存中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
