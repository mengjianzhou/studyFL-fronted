import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { practiceApi } from '../api/practice'
import { useSpeech } from '../hooks/useSpeech'
import { useLibraryStore } from '../stores/libraryStore'
import type { PracticeItem } from '../types'

type Phase = 'loading' | 'typing' | 'result' | 'dictation' | 'dictationResult'

/**
 * 打字背单词练习页（QWERTY Learner 风格）
 *
 * 比对策略：
 * - 英语（en）：逐字符实时比对，打错抖动+清空重打（形成正确肌肉记忆）
 * - 日语（ja）：整词比对 —— 日语依赖 IME 输入法（罗马音→假名组合过程会连续触发
 *   onChange），逐字符比对会永远判错形成死循环，故输入完整后按 Enter/按钮提交比对
 */
export default function PracticePage() {
  const { bankId } = useParams()
  const [searchParams] = useSearchParams()
  const initialMode = (searchParams.get('mode') === 'sentence' ? 'sentence' : 'word') as 'word' | 'sentence'
  const tree = useLibraryStore((s) => s.tree)

  const bank = useMemo(() => {
    for (const lang of tree) {
      for (const g of lang.groups) {
        const b = g.banks.find((x) => x.id === Number(bankId))
        if (b) return { ...b, langCode: lang.code }
      }
    }
    return null
  }, [tree, bankId])

  /** 日语依赖 IME → 整词比对；英语逐字符比对 */
  const isJa = bank?.langCode === 'ja'

  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<PracticeItem[]>([])
  const [mode] = useState<'word' | 'sentence'>(initialMode)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [input, setInput] = useState('')
  const [errorCount, setErrorCount] = useState(0)
  const [correctFirst, setCorrectFirst] = useState(0)
  const [totalKeystrokes, setTotalKeystrokes] = useState(0)
  const [shake, setShake] = useState(false)
  const [flash, setFlash] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [dictationScore, setDictationScore] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')

  const startTimeRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 当前词是否打错过（correctFirst / dictationScore 的口径：一次打对） */
  const wrongThisWordRef = useRef(false)
  const { speak, supported } = useSpeech(bank?.langCode ?? 'en')

  const resetRound = useCallback((newItems: PracticeItem[]) => {
    setItems(newItems)
    setCurrentIndex(0)
    setInput('')
    setErrorCount(0)
    setCorrectFirst(0)
    setTotalKeystrokes(0)
    setElapsedMs(0)
    wrongThisWordRef.current = false
    setPhase('typing')
    startTimeRef.current = Date.now()
  }, [])

  // 加载练习词表
  useEffect(() => {
    if (!bankId) return
    setPhase('loading')
    practiceApi
      .words(Number(bankId), mode, 'shuffle')
      .then((res) => {
        if (res.items.length === 0) {
          setNotice('这个词库还没有数据')
          setPhase('typing')
          return
        }
        resetRound(res.items)
        // 自动播放第一个词
        speak(res.items[0].text)
      })
      .catch((e) => setNotice((e as Error).message))
  }, [bankId, mode, speak, resetRound])

  const current = items[currentIndex]
  // 大小写不敏感比对
  const normalizedTarget = useMemo(() => (current ? current.text.toLowerCase() : ''), [current])

  /** 整词通过（日语模式）或整词失败 */
  const checkWhole = useCallback(() => {
    if (!current) return
    setTotalKeystrokes((n) => n + input.length)
    const ok = input.trim().toLowerCase() === current.text.trim().toLowerCase()
    if (ok) {
      const oneShot = !wrongThisWordRef.current && input.length > 0
      wrongThisWordRef.current = false
      setInput('')
      setFlash(true)
      setTimeout(() => setFlash(false), 400)
      if (phase === 'typing' && oneShot) setCorrectFirst((n) => n + 1)
      if (phase === 'dictation' && oneShot) setDictationScore((n) => n + 1)
      speak(current.text)
      if (currentIndex + 1 >= items.length) {
        finish()
      } else {
        setCurrentIndex((i) => i + 1)
      }
    } else {
      wrongThisWordRef.current = true
      setErrorCount((n) => n + 1)
      setShake(true)
      setTimeout(() => setShake(false), 400)
      setInput('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, current, currentIndex, items.length, phase, speak])

  /** 逐字符比对（英语模式） */
  const handleCharInput = useCallback(
    (value: string) => {
      if (phase !== 'typing' && phase !== 'dictation') return
      if (!current) return
      setTotalKeystrokes((n) => n + 1)

      const expected = normalizedTarget.charAt(input.length)
      const actual = value.charAt(value.length - 1)

      if (actual === undefined) {
        // 退格删除 → 忽略（QWERTY 风格不允许修改已输入）
        return
      }
      if (actual.toLowerCase() === expected) {
        // 正确 → 检查是否完成整词
        const newInput = input + actual
        if (newInput.length >= normalizedTarget.length) {
          const oneShot = !wrongThisWordRef.current
          wrongThisWordRef.current = false
          setInput('')
          setFlash(true)
          setTimeout(() => setFlash(false), 400)
          if (phase === 'typing' && oneShot) setCorrectFirst((n) => n + 1)
          if (phase === 'dictation' && oneShot) setDictationScore((n) => n + 1)
          // 播发音
          speak(current.text)
          // 下一词或完成
          if (currentIndex + 1 >= items.length) {
            finish()
          } else {
            setCurrentIndex((i) => i + 1)
          }
        } else {
          setInput(newInput)
        }
      } else {
        // 错误 → 抖动 + 清空 + 重打
        wrongThisWordRef.current = true
        setErrorCount((n) => n + 1)
        setShake(true)
        setTimeout(() => setShake(false), 400)
        setInput('')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, currentIndex, input, items.length, normalizedTarget, phase, speak],
  )

  /** 输入变化：日语整词模式自由输入，英语逐字符比对 */
  const handleChange = useCallback(
    (value: string) => {
      if (isJa) {
        setInput(value)
      } else {
        handleCharInput(value)
      }
    },
    [isJa, handleCharInput],
  )

  const finish = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current
    setElapsedMs(elapsed)
    setPhase((p) => (p === 'dictation' ? 'dictationResult' : 'result'))
    // 提交记录
    setSubmitting(true)
    practiceApi
      .submit({
        bankId: Number(bankId),
        mode,
        orderType: 'shuffle',
        totalWords: items.length,
        correctFirstWords: correctFirst,
        errorCount,
        totalKeystrokes,
        elapsedMs: elapsed,
        isDictation: false,
      })
      .catch((e) => setNotice((e as Error).message))
      .finally(() => setSubmitting(false))
  }, [bankId, correctFirst, errorCount, items.length, mode, totalKeystrokes])

  // 重新开始（重新洗牌）
  const restart = useCallback(() => {
    setPhase('loading')
    setNotice('')
    practiceApi
      .words(Number(bankId), mode, 'shuffle')
      .then((res) => {
        resetRound(res.items)
        speak(res.items[0]?.text ?? '')
      })
      .catch((e) => setNotice((e as Error).message))
  }, [bankId, mode, speak, resetRound])

  // 进入默写模式：隐藏单词，只留音标 + 发音
  const startDictation = useCallback(() => {
    setPhase('dictation')
    setInput('')
    setErrorCount(0)
    setDictationScore(0)
    setTotalKeystrokes(0)
    setCurrentIndex(0)
    wrongThisWordRef.current = false
    startTimeRef.current = Date.now()
    const shuffled = [...items].sort(() => Math.random() - 0.5)
    setItems(shuffled)
    setTimeout(() => speak(shuffled[0]?.text ?? ''), 500)
  }, [items, speak])

  // 默写结束提交
  useEffect(() => {
    if (phase === 'dictationResult') {
      const elapsed = Date.now() - startTimeRef.current
      setElapsedMs(elapsed)
      setSubmitting(true)
      practiceApi
        .submit({
          bankId: Number(bankId),
          mode,
          orderType: 'shuffle',
          totalWords: items.length,
          correctFirstWords: dictationScore,
          errorCount,
          totalKeystrokes,
          elapsedMs: elapsed,
          isDictation: true,
          dictationScore,
        })
        .catch((e) => setNotice((e as Error).message))
        .finally(() => setSubmitting(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // 自动聚焦输入框
  useEffect(() => {
    if (phase === 'typing' || phase === 'dictation') {
      inputRef.current?.focus()
    }
  }, [phase, currentIndex])

  // 计算实时指标
  const wpm = elapsedMs > 0 && currentIndex > 0 ? Math.round((currentIndex / (elapsedMs / 60000)) * 10) / 10 : 0
  const accuracy = totalKeystrokes > 0 ? Math.round(((totalKeystrokes - errorCount) / totalKeystrokes) * 1000) / 10 : 100
  const isDictation = phase === 'dictation' || phase === 'dictationResult'

  if (!bank) return <div className="flex h-full items-center justify-center text-slate-400">词库不存在</div>

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-6">
      {/* 顶部：进度条 + 实时指标 */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">
            {bank.name} · {mode === 'word' ? '单词模式' : '句子模式'}
          </span>
          <span className="text-xs text-slate-400">
            {currentIndex}/{items.length || '–'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${items.length ? (currentIndex / items.length) * 100 : 0}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400">
          <span>⏱ {fmtTime(elapsedMs)}</span>
          <span>⚡ {wpm} WPM</span>
          <span>✓ 正确率 {accuracy}%</span>
          <span>✗ 错误 {errorCount}</span>
        </div>
      </div>

      {phase === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-slate-400">加载词库中…</div>
      )}

      {(phase === 'typing' || phase === 'dictation') && current && (
        <div className={`flex flex-1 flex-col items-center justify-center ${flash ? 'animate-flash rounded-xl' : ''}`}>
          {/* 单词大字（默写模式隐藏） */}
          {!isDictation && (
            <>
              <div className="mb-1 text-5xl font-bold tracking-wide text-slate-800">{current.text}</div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}
          {isDictation && (
            <>
              <div className="mb-1 text-4xl font-bold text-slate-800">✍️ 默写模式</div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}

          {/* 发音按钮 + 释义提示 */}
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => speak(current.text)}
              disabled={!supported}
              className="rounded-full bg-brand-bg p-2.5 text-brand-dark transition hover:bg-brand-light disabled:opacity-40"
              title="发音"
            >
              🔊
            </button>
            {isDictation && current.meaning && (
              <button
                onClick={() => setNotice(`提示：${current.meaning}`)}
                className="text-xs text-slate-400 underline hover:text-brand-dark"
              >
                提示释义
              </button>
            )}
            {!isDictation && current.meaning && (
              <span className="text-sm text-slate-500">{current.meaning}</span>
            )}
          </div>

          {/* 打字输入区 */}
          <div className="w-full max-w-md">
            <div
              className={`flex items-center gap-2 rounded-xl border-2 bg-white px-4 py-3 transition-colors ${
                shake ? 'animate-shake border-red-400' : 'border-brand-light focus-within:border-brand'
              }`}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (isJa) {
                    // 日语：Enter 提交整词（IME 组合中的 Enter 不触发）
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      checkWhole()
                    }
                  } else if (e.key === 'Backspace') {
                    e.preventDefault()
                  }
                }}
                placeholder={
                  isJa
                    ? isDictation
                      ? '凭记忆输入，Enter 提交…'
                      : '用输入法输入，Enter 提交…'
                    : isDictation
                      ? '凭记忆输入…'
                      : '开始打字…'
                }
                className="w-full bg-transparent text-center font-mono outline-none placeholder:text-slate-300"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                lang={bank.langCode}
              />
              {isJa && (
                <button
                  onClick={checkWhole}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
                >
                  提交
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              {isJa
                ? '输入完整内容后按 Enter 或点提交 · 错误会清空重来'
                : '打错会清空重来 · 逐字符比对 · 退格无效'}
              {' · '}
              {currentIndex + 1}/{items.length}
            </p>
          </div>
        </div>
      )}

      {phase === 'result' && (
        <ResultPanel
          title="练习完成 🎉"
          correctFirst={correctFirst}
          total={items.length}
          accuracy={accuracy}
          wpm={wpm}
          errorCount={errorCount}
          submitting={submitting}
          onRestart={restart}
          onDictation={items.length >= 3 ? startDictation : undefined}
          onBack={undefined}
        />
      )}

      {phase === 'dictationResult' && (
        <ResultPanel
          title="默写完成 ✍️"
          correctFirst={dictationScore}
          total={items.length}
          accuracy={accuracy}
          wpm={wpm}
          errorCount={errorCount}
          submitting={submitting}
          onRestart={startDictation}
          onBack={undefined}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-800 px-5 py-2 text-sm text-white shadow-lg">
          {notice}
          <button className="ml-3 text-slate-300 hover:text-white" onClick={() => setNotice('')}>
            ✕
          </button>
        </div>
      )}

      {/* 底部：返回词库 */}
      <div className="mt-4 flex justify-center">
        <Link to="/" className="text-sm text-slate-400 transition hover:text-brand-dark">
          ← 返回词库
        </Link>
      </div>
    </div>
  )
}

function ResultPanel({
  title,
  correctFirst,
  total,
  accuracy,
  wpm,
  errorCount,
  submitting,
  onRestart,
  onDictation,
}: {
  title: string
  correctFirst: number
  total: number
  accuracy: number
  wpm: number
  errorCount: number
  submitting: boolean
  onRestart?: () => void
  onDictation?: () => void
  onBack?: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <h2 className="mb-8 text-3xl font-bold text-slate-800">{title}</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="一次打对" value={`${correctFirst}/${total}`} />
        <StatCard label="正确率" value={`${accuracy}%`} />
        <StatCard label="速度" value={`${wpm} WPM`} />
        <StatCard label="错误按键" value={`${errorCount}`} />
      </div>
      <div className="flex gap-3">
        <Link
          to="/"
          className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
        >
          返回词库
        </Link>
        {onRestart && (
          <button
            onClick={onRestart}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            再练一次
          </button>
        )}
        {onDictation && (
          <button
            onClick={onDictation}
            className="rounded-lg bg-green-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-600"
          >
            ✍️ 进入默写
          </button>
        )}
      </div>
      {submitting && <p className="mt-4 text-xs text-slate-400">成绩保存中…</p>}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-center shadow-sm">
      <div className="text-xl font-bold text-brand-dark">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  )
}

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
