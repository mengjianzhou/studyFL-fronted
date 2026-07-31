import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { manageApi } from '../api/manage'
import { practiceApi } from '../api/practice'
import { useSpeech } from '../hooks/useSpeech'
import { useLibraryStore } from '../stores/libraryStore'
import type { PracticeItem } from '../types'

type Phase = 'loading' | 'typing' | 'result' | 'dictation' | 'dictationResult'

/**
 * 打字背单词练习页（QWERTY Learner 风格）
 *
 * 输入策略矩阵：
 * - 单词模式 + 英语：逐字符实时比对，打错抖动+清空重打
 * - 句子模式 + 英语：逐词判断 —— 每个单词独立标色（对=绿，错=红，不自动清空），
 *   全部单词正确 + Enter 才跳下一句
 * - 日语（任一模式）：整词比对 —— IME 输入法组合过程会连续触发 onChange，
 *   逐字符/逐词比对会误判，输入完整后按 Enter/按钮提交
 * - 默写模式：隐藏答案，整词 Enter 提交（逐词标色会泄题）
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
  /** 编辑当前句子/单词弹窗 */
  const [editOpen, setEditOpen] = useState(false)

  const startTimeRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 本词是否打错过（correctFirst / dictationScore 口径：一次全对） */
  const wrongThisWordRef = useRef(false)
  /** 逐词模式下已标红的词下标集合（避免重复计数） */
  const wrongWordsRef = useRef<Set<number>>(new Set())
  const { speak, supported } = useSpeech(bank?.langCode ?? 'en')

  const isDictationPhase = phase === 'dictation' || phase === 'dictationResult'

  /** 日语依赖 IME → 整词比对 */
  const isJa = bank?.langCode === 'ja'
  /** 英语句子模式（非默写）→ 逐词判断标色 */
  const isWordWise = mode === 'sentence' && !isJa && !isDictationPhase

  const resetRound = useCallback((newItems: PracticeItem[]) => {
    setItems(newItems)
    setCurrentIndex(0)
    setInput('')
    setErrorCount(0)
    setCorrectFirst(0)
    setTotalKeystrokes(0)
    setElapsedMs(0)
    wrongThisWordRef.current = false
    wrongWordsRef.current = new Set()
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
        speak(res.items[0].text)
      })
      .catch((e) => setNotice((e as Error).message))
  }, [bankId, mode, speak, resetRound])

  const current = items[currentIndex]
  // 大小写不敏感比对
  const normalizedTarget = useMemo(() => (current ? current.text.toLowerCase() : ''), [current])
  /** 逐词判断：目标词数组 */
  const targetWords = useMemo(
    () => normalizedTarget.split(' ').filter((w) => w.length > 0),
    [normalizedTarget],
  )

  /** 解析用户输入：已完成词 + 进行中的词（过滤空格产生的空 token） */
  const parseInput = useCallback(
    (value: string) => {
      const typed = value.split(' ')
      const lastComplete = value.endsWith(' ')
      let completed = lastComplete ? typed : typed.slice(0, -1)
      completed = completed.filter((w) => w.length > 0)
      const currentWord = lastComplete ? '' : typed[typed.length - 1] ?? ''
      return { typed, completed, currentWord, lastComplete }
    },
    [],
  )

  /** 当前每个词块的判定状态：green / red / active / pending */
  const wordStates = useMemo(() => {
    if (!isWordWise || !current) return []
    const { completed, currentWord, lastComplete } = parseInput(input)
    const states: Array<'green' | 'red' | 'active' | 'pending'> = []
    for (let i = 0; i < targetWords.length; i++) {
      if (i < completed.length) {
        states.push(completed[i].toLowerCase() === targetWords[i] ? 'green' : 'red')
      } else if (i === completed.length && !lastComplete) {
        // 正在输入的词：完整匹配→绿（可不按空格直接 Enter），前缀→active，不匹配→红
        if (currentWord.length === 0) {
          states.push('active')
        } else if (targetWords[i] === currentWord.toLowerCase()) {
          states.push('green')
        } else if (targetWords[i].startsWith(currentWord.toLowerCase())) {
          states.push('active')
        } else {
          states.push('red')
        }
      } else {
        states.push('pending')
      }
    }
    return states
  }, [isWordWise, current, input, targetWords, parseInput])

  /** 整词通过（日语 / 默写模式）：Enter 提交整词比对 */
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

  /** 逐字符比对（单词模式 + 英语） */
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
          speak(current.text)
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

  /**
   * 逐词判断（句子模式 + 英语）
   * 每个单词独立标色：正确绿色 / 错误红色（不清空），全部正确 + Enter 跳下一句
   */
  const handleWordWiseInput = useCallback(
    (value: string) => {
      if (!current) return
      setTotalKeystrokes((n) => n + (value.length > input.length ? 1 : 0))
      setInput(value)

      // 实时判定：标记新出现的错误词（Set 去重，不重复计数）
      const { completed, currentWord, lastComplete } = parseInput(value)
      const newWrong: number[] = []
      for (let i = 0; i < completed.length; i++) {
        if (i >= targetWords.length || completed[i].toLowerCase() !== targetWords[i]) {
          newWrong.push(i)
        }
      }
      // 正在输入词：前缀不匹配（已打错）
      if (!lastComplete && completed.length < targetWords.length) {
        const target = targetWords[completed.length]
        if (currentWord.length > 0 && !target.startsWith(currentWord.toLowerCase())) {
          newWrong.push(completed.length)
        }
      }
      if (newWrong.length > 0) {
        wrongThisWordRef.current = true
        for (const idx of newWrong) {
          if (!wrongWordsRef.current.has(idx)) {
            wrongWordsRef.current.add(idx)
            setErrorCount((n) => n + 1)
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, input, targetWords, parseInput],
  )

  /** 输入分发：日语/默写 → 整词；单词+英语 → 逐字符；句子+英语 → 逐词 */
  const handleChange = useCallback(
    (value: string) => {
      if (phase !== 'typing' && phase !== 'dictation') return
      if (isJa || phase === 'dictation') {
        setInput(value)
      } else if (mode === 'sentence') {
        handleWordWiseInput(value)
      } else {
        handleCharInput(value)
      }
    },
    [isJa, mode, phase, handleCharInput, handleWordWiseInput],
  )

  /** 逐词模式：全部词正确且按 Enter → 跳下一句 */
  const handleWordWiseEnter = useCallback(() => {
    if (!current) return
    const { completed, currentWord, lastComplete } = parseInput(input)
    // 所有目标词都已正确输入（最后一个词可不按空格，完整匹配即可）
    const typedCount = lastComplete ? completed.length : completed.length + 1
    const allCorrect =
      typedCount === targetWords.length &&
      targetWords.every((w, i) => {
        if (i < completed.length) return completed[i].toLowerCase() === w
        return currentWord.toLowerCase() === w
      })
    if (!allCorrect) {
      // 未完成、有多余词或还有错误 → Enter 无效，提示
      setShake(true)
      setTimeout(() => setShake(false), 400)
      setNotice(typedCount > targetWords.length ? '输入了多余的单词' : '还有未完成或错误的单词')
      setTimeout(() => setNotice(''), 1500)
      return
    }
    // 全部正确 → 完成本句
    const oneShot = !wrongThisWordRef.current
    wrongThisWordRef.current = false
    wrongWordsRef.current = new Set()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, current, currentIndex, items.length, phase, speak, targetWords, parseInput])

  const finish = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current
    setElapsedMs(elapsed)
    setPhase((p) => (p === 'dictation' ? 'dictationResult' : 'result'))
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
    wrongWordsRef.current = new Set()
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

  /** 保存编辑后的句子/单词：更新数据库 + 更新本地词表继续练习 */
  const handleEditSave = useCallback(
    async (data: { text: string; meaning?: string; extra?: string; phonetic?: string }) => {
      if (!current) return
      try {
        if (mode === 'sentence') {
          const updated = await manageApi.updateSentence(current.id, {
            english: data.text || undefined,
            chinese: data.meaning || undefined,
            japanese: data.extra || undefined,
          })
          setItems((list) =>
            list.map((it) =>
              it.id === current.id
                ? {
                    ...it,
                    text: updated.english ?? it.text,
                    meaning: updated.chinese ?? it.meaning,
                    extra: updated.japanese ?? it.extra,
                  }
                : it,
            ),
          )
        } else {
          const updated = await manageApi.updateWord(current.id, {
            word: data.text,
            phonetic: data.phonetic || undefined,
            meaning: data.meaning || undefined,
            wordType: data.extra || undefined,
          })
          setItems((list) =>
            list.map((it) =>
              it.id === current.id
                ? {
                    ...it,
                    text: updated.word,
                    phonetic: updated.phonetic ?? it.phonetic,
                    meaning: updated.meaning ?? it.meaning,
                    extra: updated.wordType ?? it.extra,
                  }
                : it,
            ),
          )
        }
        setEditOpen(false)
        // 目标已变化，清空当前输入从头打
        setInput('')
        wrongThisWordRef.current = false
        wrongWordsRef.current = new Set()
        setNotice('已保存修改')
        setTimeout(() => setNotice(''), 2000)
      } catch (e) {
        setNotice((e as Error).message)
      }
    },
    [current, mode],
  )

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
          {/* 单词模式：大字单词；逐词模式：彩色词块；默写：隐藏 */}
          {!isDictationPhase && !isWordWise && (
            <>
              <div className="mb-1 text-5xl font-bold tracking-wide text-slate-800">{current.text}</div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}
          {isWordWise && (
            <>
              <div className="mb-3 flex max-w-2xl flex-wrap items-center justify-center gap-1.5">
                {targetWords.map((w, i) => (
                  <span
                    key={i}
                    className={`rounded-lg px-2.5 py-1 text-lg font-medium transition-colors ${
                      wordStates[i] === 'green'
                        ? 'bg-green-100 text-green-600'
                        : wordStates[i] === 'red'
                          ? 'bg-red-100 text-red-500'
                          : wordStates[i] === 'active'
                            ? 'bg-brand-bg text-brand-dark ring-2 ring-brand'
                            : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {w}
                  </span>
                ))}
              </div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}
          {isDictationPhase && (
            <>
              <div className="mb-1 text-4xl font-bold text-slate-800">✍️ 默写模式</div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}

          {/* 发音按钮 + 编辑 + 释义提示 */}
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => speak(current.text)}
              disabled={!supported}
              className="rounded-full bg-brand-bg p-2.5 text-brand-dark transition hover:bg-brand-light disabled:opacity-40"
              title="发音"
            >
              🔊
            </button>
            {!isDictationPhase && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-full bg-slate-100 p-2.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                title={mode === 'sentence' ? '编辑这个句子' : '编辑这个单词'}
              >
                ✏️
              </button>
            )}
            {isDictationPhase && current.meaning && (
              <button
                onClick={() => setNotice(`提示：${current.meaning}`)}
                className="text-xs text-slate-400 underline hover:text-brand-dark"
              >
                提示释义
              </button>
            )}
            {!isDictationPhase && !isWordWise && current.meaning && (
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
                  if (e.key === 'Enter') {
                    if (isJa || isDictationPhase) {
                      // 日语 / 默写：整词提交（IME 组合中的 Enter 不触发）
                      if (!e.nativeEvent.isComposing) {
                        e.preventDefault()
                        checkWhole()
                      }
                    } else if (mode === 'sentence') {
                      // 逐词模式：全部正确才生效
                      e.preventDefault()
                      handleWordWiseEnter()
                    }
                  } else if (e.key === 'Backspace') {
                    // 逐字符模式不允许退格；逐词/整词模式允许（错误不清除，可自行修改）
                    if (mode === 'word' && !isJa) e.preventDefault()
                  }
                }}
                placeholder={
                  isJa
                    ? isDictationPhase
                      ? '凭记忆输入，Enter 提交…'
                      : '用输入法输入，Enter 提交…'
                    : isDictationPhase
                      ? '凭记忆输入，Enter 提交…'
                      : mode === 'sentence'
                        ? '逐词输入，空格分隔，全部正确后按 Enter…'
                        : '开始打字…'
                }
                className="w-full bg-transparent text-center font-mono outline-none placeholder:text-slate-300"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                lang={bank.langCode}
              />
              {(isJa || isDictationPhase) && (
                <button
                  onClick={checkWhole}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
                >
                  提交
                </button>
              )}
              {isWordWise && (
                <button
                  onClick={handleWordWiseEnter}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
                >
                  确认
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              {isJa
                ? '输入完整内容后按 Enter 或点提交 · 错误会清空重来'
                : isDictationPhase
                  ? '凭记忆输入 · Enter 提交 · 错误会清空重来'
                  : mode === 'sentence'
                    ? '每个单词独立判断：绿色正确 / 红色错误（不自动清除）· 全部正确 + Enter 跳下一句'
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
        />
      )}

      {/* 编辑当前句子/单词弹窗 */}
      {editOpen && current && (
        <EditItemModal
          mode={mode}
          item={current}
          onClose={() => setEditOpen(false)}
          onSave={handleEditSave}
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
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <h2 className="mb-8 text-3xl font-bold text-slate-800">{title}</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="一次全对" value={`${correctFirst}/${total}`} />
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

/** 编辑当前句子/单词弹窗（发现内容有误时直接修改） */
function EditItemModal({
  mode,
  item,
  onClose,
  onSave,
}: {
  mode: 'word' | 'sentence'
  item: PracticeItem
  onClose: () => void
  onSave: (data: { text: string; meaning?: string; extra?: string; phonetic?: string }) => void
}) {
  const [text, setText] = useState(item.text)
  const [meaning, setMeaning] = useState(item.meaning ?? '')
  const [extra, setExtra] = useState(item.extra ?? '')
  const [phonetic, setPhonetic] = useState(item.phonetic ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!text.trim()) {
      setError(mode === 'sentence' ? '英文内容不能为空' : '单词不能为空')
      return
    }
    setSaving(true)
    try {
      await onSave({ text: text.trim(), meaning: meaning.trim() || undefined, extra: extra.trim() || undefined, phonetic: phonetic.trim() || undefined })
    } catch (e) {
      setError((e as Error).message)
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
          {mode === 'sentence' ? '编辑句子' : '编辑单词'}
        </h3>
        {mode === 'sentence' ? (
          <div className="space-y-3">
            <EditField label="英文" value={text} onChange={setText} placeholder="English sentence" />
            <EditField label="中文" value={meaning} onChange={setMeaning} placeholder="中文翻译" />
            <EditField label="日文" value={extra} onChange={setExtra} placeholder="日本語" />
          </div>
        ) : (
          <div className="space-y-3">
            <EditField label="单词" value={text} onChange={setText} placeholder="如 apple" />
            <EditField label="音标" value={phonetic} onChange={setPhonetic} placeholder="如 /ˈæpl/" />
            <EditField label="释义" value={meaning} onChange={setMeaning} placeholder="如 苹果" />
            <EditField label="词性" value={extra} onChange={setExtra} placeholder="如 n." />
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <p className="mt-2 text-xs text-slate-400">修改会保存到词库，所有用户都能看到；当前词将从新内容重新练习</p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditField({
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

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
