import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { contentApi } from '../api/content'
import { manageApi } from '../api/manage'
import { useLibraryStore } from '../stores/libraryStore'
import type { SentenceVO, WordVO } from '../types'

type Tab = 'word' | 'sentence'

/** 词库数据管理页：单词/句子 增删改 */
export default function ManageBankPage() {
  const { bankId } = useParams()
  const id = Number(bankId)
  const tree = useLibraryStore((s) => s.tree)
  const bank = tree.flatMap((l) => l.groups.flatMap((g) => g.banks)).find((b) => b.id === id)

  const [tab, setTab] = useState<Tab>('word')
  const [words, setWords] = useState<WordVO[]>([])
  const [sentences, setSentences] = useState<SentenceVO[]>([])
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState<null | { mode: 'create' } | { mode: 'edit'; id: number }>(null)

  const reload = useCallback(() => {
    contentApi.words(id).then((r) => setWords(r.records)).catch((e) => setNotice((e as Error).message))
    contentApi.sentences(id).then((r) => setSentences(r.records)).catch(() => {})
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  const handleDelete = async (kind: Tab, itemId: number, name: string) => {
    if (!window.confirm(`确认删除「${name}」？`)) return
    try {
      if (kind === 'word') await manageApi.deleteWord(itemId)
      else await manageApi.deleteSentence(itemId)
      reload()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">数据管理</h2>
          <p className="mt-1 text-sm text-slate-500">
            {bank?.name ?? '词库'} · 单词 {bank?.wordCount ?? 0} 个 · 句子 {bank?.sentenceCount ?? 0} 条
          </p>
        </div>
        <Link to="/" className="text-sm text-slate-400 transition hover:text-brand-dark">
          ← 返回词库
        </Link>
      </div>

      {/* Tab 切换 + 新增按钮 */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <TabBtn active={tab === 'word'} onClick={() => setTab('word')}>单词</TabBtn>
          <TabBtn active={tab === 'sentence'} onClick={() => setTab('sentence')}>句子</TabBtn>
        </div>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          + 新增{tab === 'word' ? '单词' : '句子'}
        </button>
      </div>

      {/* 单词列表 */}
      {tab === 'word' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {words.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">还没有单词，点右上角添加</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-400">
                  <th className="px-4 py-2.5 font-medium">单词</th>
                  <th className="px-4 py-2.5 font-medium">音标</th>
                  <th className="px-4 py-2.5 font-medium">释义</th>
                  <th className="px-4 py-2.5 font-medium">词性</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {words.map((w) => (
                  <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{w.word}</td>
                    <td className="px-4 py-2.5 text-slate-500">{w.phonetic || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{w.meaning || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-400">{w.wordType || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setModal({ mode: 'edit', id: w.id })}
                        className="mr-3 text-xs text-brand-dark hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete('word', w.id, w.word)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 句子列表 */}
      {tab === 'sentence' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {sentences.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">还没有句子，点右上角添加</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-400">
                  <th className="px-4 py-2.5 font-medium">英文</th>
                  <th className="px-4 py-2.5 font-medium">中文</th>
                  <th className="px-4 py-2.5 font-medium">日文</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {sentences.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="max-w-52 truncate px-4 py-2.5 text-slate-800">{s.english || '—'}</td>
                    <td className="max-w-40 truncate px-4 py-2.5 text-slate-600">{s.chinese || '—'}</td>
                    <td className="max-w-40 truncate px-4 py-2.5 text-slate-600">{s.japanese || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setModal({ mode: 'edit', id: s.id })}
                        className="mr-3 text-xs text-brand-dark hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete('sentence', s.id, s.english ?? s.japanese ?? '')}
                        className="text-xs text-red-400 hover:underline"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal && (
        <EditModal
          tab={tab}
          bankId={id}
          mode={modal.mode}
          editId={modal.mode === 'edit' ? modal.id : undefined}
          initial={
            modal.mode === 'edit'
              ? tab === 'word'
                ? words.find((w) => w.id === modal.id)
                : sentences.find((s) => s.id === modal.id)
              : undefined
          }
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            reload()
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm transition ${
        active ? 'bg-white font-medium text-brand-dark shadow' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

/** 新增/编辑弹窗 */
function EditModal({
  tab,
  bankId,
  mode,
  editId,
  initial,
  onClose,
  onSaved,
  onError,
}: {
  tab: Tab
  bankId: number
  mode: 'create' | 'edit'
  editId?: number
  initial?: WordVO | SentenceVO
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    word: (initial as WordVO)?.word ?? '',
    phonetic: (initial as WordVO)?.phonetic ?? '',
    meaning: (initial as WordVO)?.meaning ?? '',
    wordType: (initial as WordVO)?.wordType ?? '',
    english: (initial as SentenceVO)?.english ?? '',
    chinese: (initial as SentenceVO)?.chinese ?? '',
    japanese: (initial as SentenceVO)?.japanese ?? '',
  })

  const save = async () => {
    setSaving(true)
    try {
      if (tab === 'word') {
        const data = { word: form.word, phonetic: form.phonetic || undefined, meaning: form.meaning || undefined, wordType: form.wordType || undefined }
        if (mode === 'create') await manageApi.createWord(bankId, data)
        else if (editId) await manageApi.updateWord(editId, data)
      } else {
        const data = { english: form.english || undefined, chinese: form.chinese || undefined, japanese: form.japanese || undefined }
        if (mode === 'create') await manageApi.createSentence(bankId, data)
        else if (editId) await manageApi.updateSentence(editId, data)
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
          {mode === 'create' ? `新增${tab === 'word' ? '单词' : '句子'}` : `编辑${tab === 'word' ? '单词' : '句子'}`}
        </h3>

        {tab === 'word' ? (
          <div className="space-y-3">
            <Field label="单词" value={form.word} onChange={(v) => setForm({ ...form, word: v })} placeholder="如 apple" />
            <Field label="音标" value={form.phonetic} onChange={(v) => setForm({ ...form, phonetic: v })} placeholder="如 /ˈæpl/" />
            <Field label="释义" value={form.meaning} onChange={(v) => setForm({ ...form, meaning: v })} placeholder="如 苹果" />
            <Field label="词性" value={form.wordType} onChange={(v) => setForm({ ...form, wordType: v })} placeholder="如 n." />
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="英文" value={form.english} onChange={(v) => setForm({ ...form, english: v })} placeholder="English sentence" />
            <Field label="中文" value={form.chinese} onChange={(v) => setForm({ ...form, chinese: v })} placeholder="中文翻译" />
            <Field label="日文" value={form.japanese} onChange={(v) => setForm({ ...form, japanese: v })} placeholder="日本語" />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || (tab === 'word' && !form.word.trim())}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
      />
    </div>
  )
}
