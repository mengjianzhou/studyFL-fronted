import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { manageApi } from '../api/manage'
import { practiceApi } from '../api/practice'
import { translateApi } from '../api/translate'
import { useSpeech } from '../hooks/useSpeech'
import { useLibraryStore } from '../stores/libraryStore'
import type { PracticeItem } from '../types'

type Phase = 'loading' | 'typing' | 'result' | 'dictation' | 'dictationResult'
type WordCheckState = 'pending' | 'active' | 'correct' | 'incorrect'
type SentenceAnswerMode = 'practice' | 'study'

/**
 * 打字背单词练习页（QWERTY Learner 风格）
 *
 * 输入策略矩阵：
 * - 单词模式 + 英语：逐字符实时比对，打错抖动+清空重打
 * - 句子模式 + 英语：逐词判断 —— 每个单词独立提交并标色（对=绿，错=红），错误也可继续
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
  const [wordChecks, setWordChecks] = useState<WordCheckState[]>([])
  const [wordAnswers, setWordAnswers] = useState<string[]>([])
  const [wordCursor, setWordCursor] = useState(0)
  const [shake, setShake] = useState(false)
  const [flash, setFlash] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [dictationScore, setDictationScore] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  /** 编辑/新增弹窗：edit = 修改当前词，create = 新增到本词库 */
  const [dialog, setDialog] = useState<null | { action: 'edit'; item: PracticeItem } | { action: 'create' }>(null)

  /** 填空模式（segments 带 isBlank）的逐格状态 */
  const [blankInputs, setBlankInputs] = useState<string[]>([])
  const [blankStates, setBlankStates] = useState<WordCheckState[]>([])
  const [activeBlank, setActiveBlank] = useState<number>(-1)
  const [sentenceAnswerMode, setSentenceAnswerMode] = useState<SentenceAnswerMode>('practice')
  const blankRefs = useRef<(HTMLInputElement | null)[]>([])
  /** 当前填空句是否犯过错（用于一次全对统计） */
  const segItemErrorRef = useRef(false)
  /** 填空模式累计一次全对数量 */
  const segCorrectFirstRef = useRef(0)

  const startTimeRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 本词是否打错过（correctFirst / dictationScore 口径：一次全对） */
  const wrongThisWordRef = useRef(false)
  /** 逐词模式下已标红的词下标集合（避免重复计数） */
  const wrongWordsRef = useRef<Set<number>>(new Set())
  const wordWiseErrorRef = useRef(0)
  const wordWiseKeystrokesRef = useRef(0)
  const wordWiseCorrectFirstRef = useRef(0)
  const wordWiseItemWrongRef = useRef(false)
  const itemResultsRef = useRef<Map<number, boolean>>(new Map())
  const { speak, supported } = useSpeech(bank?.langCode ?? 'en')

  const isDictationPhase = phase === 'dictation' || phase === 'dictationResult'

  /** 日语依赖 IME → 整词比对 */
  const isJa = bank?.langCode === 'ja'
  /** 英语句子模式（非默写）→ 逐词判断标色 */
  const isWordWise = mode === 'sentence' && !isJa && !isDictationPhase
  /** 句子练习统一使用截图中的深色学习卡片；日语仍保留整句 IME 提交逻辑 */
  const isSentenceCard = mode === 'sentence' && !isDictationPhase

  const speakItem = useCallback(
    (item?: PracticeItem) => {
      if (!item) return
      const speechText = isJa && mode === 'sentence' ? item.extra?.trim() || item.text : item.text
      speak(speechText ?? '')
    },
    [isJa, mode, speak],
  )

  const resetRound = useCallback((newItems: PracticeItem[]) => {
    setItems(newItems)
    setCurrentIndex(0)
    setInput('')
    setErrorCount(0)
    setCorrectFirst(0)
    setTotalKeystrokes(0)
    setWordChecks([])
    setWordAnswers([])
    setWordCursor(0)
    setElapsedMs(0)
    setSentenceAnswerMode('practice')
    wrongThisWordRef.current = false
    wrongWordsRef.current = new Set()
    wordWiseErrorRef.current = 0
    wordWiseKeystrokesRef.current = 0
    wordWiseCorrectFirstRef.current = 0
    wordWiseItemWrongRef.current = false
    itemResultsRef.current = new Map()
    setPhase('typing')
    startTimeRef.current = Date.now()
  }, [])

  // 加载练习词表
  useEffect(() => {
    // 等词库语言加载完成后再请求和播报，避免日语内容先使用默认英文语音。
    if (!bankId || !bank) return
    setPhase('loading')
    practiceApi
      .words(Number(bankId), mode, 'shuffle')
      .then((res) => {
        if (res.items.length === 0) {
          setItems([])
          setNotice(mode === 'word' ? '今天没有到期单词，或这个词库还没有单词' : '这个词库还没有句子')
          setPhase('typing')
          return
        }
        resetRound(res.items)
        speakItem(res.items[0])
      })
      .catch((e) => setNotice((e as Error).message))
  }, [bankId, bank, mode, speakItem, resetRound])

  const current = items[currentIndex]
  // 大小写不敏感比对（text 可能为 null：只填了日文没填英文的句子）
  const normalizedTarget = useMemo(() => (current?.text?.toLowerCase() ?? ''), [current])

  /** 切分单元：优先使用后端 segments，否则按空格/全角空格自动拆分 */
  const segments = useMemo(() => {
    if (current?.segments && current.segments.length > 0) {
      return current.segments
        .filter((segment) => !isPunctuationSegment(segment.text))
        .map((s) => ({
          text: s.text,
          reading: s.reading ?? '',
          furigana: (s as Segment).furigana ?? '',
          meaning: s.meaning ?? '',
        }))
    }
    // 回退：按空格拆分
    const words = normalizedTarget.split(/[\s\u3000]+/).filter((w) => w.length > 0)
    return words.map((w) => ({ text: w, reading: '', furigana: '', meaning: '' }))
  }, [current, normalizedTarget])

  /** 带词性/填空标记的切分单元（用于填空式显示）；无 segments 时为 null（走旧渲染） */
  const sentenceSegments = useMemo<Segment[] | null>(() => {
    const raw = current?.segments
    if (raw && raw.length > 0) {
      const wordSegments = raw.filter((segment) => !isPunctuationSegment(segment.text))
      // 仅当 segments 携带 isBlank 信息时才启用填空式显示，避免影响纯自动切分的旧数据
      const hasBlankInfo = wordSegments.some((s) => s.isBlank !== undefined)
      if (!hasBlankInfo) return null
      return wordSegments.map((s) => ({
        text: s.text,
        reading: s.reading ?? '',
        furigana: (s as Segment).furigana ?? '',
        meaning: s.meaning ?? '',
        type: s.type ?? '',
        isBlank: s.isBlank === true || s.isBlank === 'true',
      }))
    }
    return null
  }, [current])

  /** 目标词数组（用于输入比对）—— 取 segments 的 text */
  const targetWords = useMemo(() => segments.map((s) => s.text.toLowerCase()), [segments])

  const sentenceCardSegments = useMemo(
    () => (isWordWise ? segments : current?.text ? [{ text: current.text, reading: '', meaning: '' }] : []),
    [current, isWordWise, segments],
  )

  useEffect(() => {
    if (!isWordWise || !current) return
    setWordChecks(segments.map((_, index) => (index === 0 ? 'active' : 'pending')))
    setWordAnswers(segments.map(() => ''))
    setWordCursor(0)
    setInput('')
    wordWiseItemWrongRef.current = false
  }, [current, isWordWise, segments])

  /** 填空模式：切换句子时重置每格状态，聚焦第一个空格 */
  useEffect(() => {
    if (!sentenceSegments) return
    setBlankInputs(sentenceSegments.map(() => ''))
    setBlankStates(sentenceSegments.map((s, i) => (s.isBlank ? (i === 0 ? 'active' : 'pending') : 'correct')))
    const first = sentenceSegments.findIndex((s) => s.isBlank)
    segItemErrorRef.current = false
    if (sentenceAnswerMode === 'study') {
      setActiveBlank(-1)
    } else if (first >= 0) {
      setActiveBlank(first)
      setTimeout(() => blankRefs.current[first]?.focus(), 60)
    }
  }, [current, sentenceSegments, sentenceAnswerMode])

  useEffect(() => {
    if (sentenceAnswerMode !== 'study' || phase !== 'typing' || !sentenceSegments || dialog) return

    const handleStudyModeKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      if (currentIndex >= items.length - 1) return
      event.preventDefault()
      setCurrentIndex((index) => Math.min(index + 1, items.length - 1))
    }

    window.addEventListener('keydown', handleStudyModeKeyDown)
    return () => window.removeEventListener('keydown', handleStudyModeKeyDown)
  }, [currentIndex, dialog, items.length, phase, sentenceAnswerMode, sentenceSegments])

  /** 整词通过（日语 / 默写模式）：Enter 提交整词比对 */
  const checkWhole = useCallback(() => {
    if (!current) return
    setTotalKeystrokes((n) => n + input.length)
    const ok = normalizeWholeAnswer(input, isJa) === normalizeWholeAnswer(current.text ?? '', isJa)
    if (ok) {
      const oneShot = !wrongThisWordRef.current && input.length > 0
      if (mode === 'word') itemResultsRef.current.set(current.id, oneShot)
      wrongThisWordRef.current = false
      setInput('')
      setFlash(true)
      setTimeout(() => setFlash(false), 400)
      if (phase === 'typing' && oneShot) setCorrectFirst((n) => n + 1)
      if (phase === 'dictation' && oneShot) setDictationScore((n) => n + 1)
      speakItem(current)
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
  }, [input, current, currentIndex, items.length, phase, speakItem])

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
          if (mode === 'word') itemResultsRef.current.set(current.id, oneShot)
          wrongThisWordRef.current = false
          setInput('')
          setFlash(true)
          setTimeout(() => setFlash(false), 400)
          if (phase === 'typing' && oneShot) setCorrectFirst((n) => n + 1)
          if (phase === 'dictation' && oneShot) setDictationScore((n) => n + 1)
          speakItem(current)
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
    [current, currentIndex, input, items.length, normalizedTarget, phase, speakItem],
  )

  /** 逐词模式只收集当前词，空格或 Enter 时再提交判断 */
  const handleWordWiseInput = useCallback(
    (value: string) => {
      if (!current || wordCursor >= targetWords.length) return
      const added = Math.max(0, value.length - input.length)
      if (added > 0) {
        setTotalKeystrokes((n) => n + added)
        wordWiseKeystrokesRef.current += added
      }
      setInput(value)
    },
    [current, input.length, targetWords.length, wordCursor],
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

  const finish = useCallback((overrides?: { correctFirst?: number; errorCount?: number; totalKeystrokes?: number }) => {
    const elapsed = Date.now() - startTimeRef.current
    setElapsedMs(elapsed)
    const isDictationRound = phase === 'dictation'
    setPhase(isDictationRound ? 'dictationResult' : 'result')
    if (isDictationRound) return
    setSubmitting(true)
    practiceApi
      .submit({
        bankId: Number(bankId),
        mode,
        orderType: 'shuffle',
        totalWords: items.length,
        correctFirstWords: overrides?.correctFirst ?? correctFirst,
        errorCount: overrides?.errorCount ?? errorCount,
        totalKeystrokes: overrides?.totalKeystrokes ?? totalKeystrokes,
        elapsedMs: elapsed,
        isDictation: false,
        itemResults: mode === 'word' ? Array.from(itemResultsRef.current, ([itemId, success]) => ({ itemId, success })) : undefined,
      })
      .catch((e) => setNotice((e as Error).message))
      .finally(() => setSubmitting(false))
  }, [bankId, correctFirst, errorCount, items.length, mode, phase, totalKeystrokes])

  /** 逐词模式：每个词独立判定，错误词也允许继续 */
  const handleWordWiseEnter = useCallback(() => {
    if (!current || !input.trim() || wordCursor >= targetWords.length) return
    const normalizeWord = (value: string) => value.trim().toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
    const correct = normalizeWord(input) === normalizeWord(targetWords[wordCursor])
    const nextErrorCount = wordWiseErrorRef.current + (correct ? 0 : 1)
    wordWiseErrorRef.current = nextErrorCount
    if (!correct) {
      wordWiseItemWrongRef.current = true
      setErrorCount((n) => n + 1)
      setShake(true)
      setTimeout(() => setShake(false), 400)
    }

    const nextCursor = wordCursor + 1
    setWordAnswers((answers) => answers.map((answer, index) => (index === wordCursor ? input.trim() : answer)))
    setWordChecks((states) => states.map((state, index) => {
      if (index === wordCursor) return correct ? 'correct' : 'incorrect'
      if (index === nextCursor && nextCursor < targetWords.length) return 'active'
      return state
    }))
    setInput('')

    if (nextCursor < targetWords.length) {
      setWordCursor(nextCursor)
      return
    }

    const itemCorrectFirst = !wordWiseItemWrongRef.current && correct
    const nextCorrectFirst = wordWiseCorrectFirstRef.current + (itemCorrectFirst ? 1 : 0)
    wordWiseCorrectFirstRef.current = nextCorrectFirst
    setCorrectFirst(nextCorrectFirst)
    setFlash(true)
    setTimeout(() => setFlash(false), 400)
    speakItem(current)
    if (currentIndex + 1 >= items.length) {
      finish({ correctFirst: nextCorrectFirst, errorCount: nextErrorCount, totalKeystrokes: wordWiseKeystrokesRef.current })
    } else {
      setCurrentIndex((index) => index + 1)
    }
  }, [current, currentIndex, finish, input, items.length, speakItem, targetWords, wordCursor])

  /** 填空模式：单格输入变化 → 实时判断正确/错误（单格错不波及他格） */
  const handleBlankChange = useCallback(
    (idx: number, value: string) => {
      if (!sentenceSegments) return
      const prevVal = blankInputs[idx] ?? ''
      const added = Math.max(0, value.length - prevVal.length)
      if (added > 0) setTotalKeystrokes((n) => n + added)
      setBlankInputs((prev) => prev.map((v, i) => (i === idx ? value : v)))
      const target = sentenceSegments[idx].text.trim().toLowerCase()
      const typed = value.trim().toLowerCase()
      const next: WordCheckState = typed === '' ? 'pending' : typed === target ? 'correct' : 'incorrect'
      const old = blankStates[idx]
      setBlankStates((prev) => prev.map((st, i) => (i === idx ? next : st)))
      if (next === 'incorrect' && old !== 'incorrect') {
        setErrorCount((n) => n + 1)
        segItemErrorRef.current = true
      }
    },
    [sentenceSegments, blankInputs, blankStates],
  )

  /** 填空模式：所有空格正确后进入下一句 */
  const goNextFromBlanks = useCallback(() => {
    if (!current || !sentenceSegments) return
    const blankIdxs = sentenceSegments.map((s, i) => (s.isBlank ? i : -1)).filter((i) => i >= 0)
    const allCorrect = blankIdxs.length > 0 && blankIdxs.every((i) => blankStates[i] === 'correct')
    if (!allCorrect) return
    const oneShot = !segItemErrorRef.current
    if (phase === 'typing' && oneShot) {
      segCorrectFirstRef.current += 1
      setCorrectFirst(segCorrectFirstRef.current)
    }
    setFlash(true)
    setTimeout(() => setFlash(false), 400)
    speakItem(current)
    if (currentIndex + 1 >= items.length) {
      finish({ correctFirst: segCorrectFirstRef.current, errorCount, totalKeystrokes })
    } else {
      setCurrentIndex((i) => i + 1)
    }
  }, [current, sentenceSegments, blankStates, phase, speakItem, currentIndex, items.length, errorCount, totalKeystrokes, finish])

  /** 填空模式：空格或回车 → 跳到下一格；若全部正确则进入下一句 */
  const handleBlankKeyDown = useCallback(
    (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      const isNextKey = e.key === 'Enter' || e.key === ' ' || e.code === 'Space'
      if (!sentenceSegments || !isNextKey) return
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      const blankIdxs = sentenceSegments.map((s, i) => (s.isBlank ? i : -1)).filter((i) => i >= 0)
      const pos = blankIdxs.indexOf(idx)
      const nextBlank = pos >= 0 && pos < blankIdxs.length - 1 ? blankIdxs[pos + 1] : -1
      const allCorrect = blankIdxs.length > 0 && blankIdxs.every((i) => blankStates[i] === 'correct')
      if (nextBlank >= 0) {
        setActiveBlank(nextBlank)
        blankRefs.current[nextBlank]?.focus()
      } else if (allCorrect) {
        goNextFromBlanks()
      }
    },
    [sentenceSegments, blankStates, goNextFromBlanks],
  )

  // 重新开始（重新洗牌）
  const restart = useCallback(() => {
    setPhase('loading')
    setNotice('')
    practiceApi
      .words(Number(bankId), mode, 'shuffle')
      .then((res) => {
        resetRound(res.items)
        speakItem(res.items[0])
      })
      .catch((e) => setNotice((e as Error).message))
  }, [bankId, mode, speakItem, resetRound])

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
    itemResultsRef.current = new Map()
    startTimeRef.current = Date.now()
    const shuffled = [...items].sort(() => Math.random() - 0.5)
    setItems(shuffled)
    setTimeout(() => speakItem(shuffled[0]), 500)
  }, [items, speakItem])

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
          itemResults: mode === 'word' ? Array.from(itemResultsRef.current, ([itemId, success]) => ({ itemId, success })) : undefined,
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
    async (data: { text: string; meaning?: string; extra?: string; phonetic?: string; segmentsJson?: string }) => {
      if (!current) return
      try {
        if (mode === 'sentence') {
          const updated = await manageApi.updateSentence(current.id, {
            english: data.text || undefined,
            chinese: data.meaning || undefined,
            japanese: data.extra || undefined,
            segmentsJson: data.segmentsJson,
          })
          // 解析返回的 segments 更新本地
          let parsedSegments: PracticeItem['segments'] | undefined
          if (data.segmentsJson) {
            try { parsedSegments = JSON.parse(data.segmentsJson) } catch { /* ignore */ }
          }
          setItems((list) =>
            list.map((it) =>
              it.id === current.id
                ? {
                    ...it,
                    text: updated.english ?? it.text,
                    meaning: updated.chinese ?? it.meaning,
                    extra: updated.japanese ?? it.extra,
                    segments: parsedSegments ?? it.segments,
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
        setDialog(null)
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

  /** 新增句子/单词到当前词库（与当前页面相同的词库组/词库），追加到会话末尾 */
  const handleAddSave = useCallback(
    async (data: { text: string; meaning?: string; extra?: string; phonetic?: string; segmentsJson?: string }) => {
      if (!bankId) return
      try {
        let newItem: PracticeItem
        if (mode === 'sentence') {
          const created = await manageApi.createSentence(Number(bankId), {
            english: data.text,
            chinese: data.meaning || undefined,
            japanese: data.extra || undefined,
            segmentsJson: data.segmentsJson,
          })
          let parsedSegments: PracticeItem['segments'] | undefined
          if (data.segmentsJson) {
            try { parsedSegments = JSON.parse(data.segmentsJson) } catch { /* ignore */ }
          }
          newItem = {
            id: created.id,
            text: created.english ?? data.text,
            phonetic: null,
            meaning: created.chinese ?? '',
            extra: created.japanese ?? '',
            segments: parsedSegments,
          }
        } else {
          const created = await manageApi.createWord(Number(bankId), {
            word: data.text,
            phonetic: data.phonetic || undefined,
            meaning: data.meaning || undefined,
            wordType: data.extra || undefined,
          })
          newItem = {
            id: created.id,
            text: created.word,
            phonetic: created.phonetic ?? null,
            meaning: created.meaning ?? '',
            extra: created.wordType ?? null,
          }
        }
        setItems((list) => [...list, newItem])
        setDialog(null)
        setNotice('已添加到本词库，稍后就练到它')
        setTimeout(() => setNotice(''), 2500)
      } catch (e) {
        setNotice((e as Error).message)
      }
    },
    [bankId, mode],
  )

  if (!bank) return <div className="flex h-full items-center justify-center text-slate-400">词库不存在</div>

  return (
    <div
      className={`mx-auto flex h-full w-full flex-col px-6 py-6 ${
        isSentenceCard ? 'bg-black text-white' : 'max-w-3xl'
      }`}
    >
      {/* 顶部：进度条 + 实时指标 */}
      <div className={`mx-auto mb-6 w-full ${isSentenceCard ? 'max-w-3xl' : ''}`}>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className={`font-medium ${isSentenceCard ? 'text-white/80' : 'text-slate-700'}`}>
            {bank.name} · {mode === 'word' ? '单词模式' : '句子模式'}
          </span>
          <span className={`text-xs ${isSentenceCard ? 'text-white/40' : 'text-slate-400'}`}>
            {currentIndex}/{items.length || '–'}
          </span>
        </div>
        <div className={`h-2 w-full overflow-hidden rounded-full ${isSentenceCard ? 'bg-white/10' : 'bg-slate-200'}`}>
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${items.length ? (currentIndex / items.length) * 100 : 0}%` }}
          />
        </div>
        <div className={`mt-2 flex justify-between text-xs ${isSentenceCard ? 'text-white/40' : 'text-slate-400'}`}>
          <span>⏱ {fmtTime(elapsedMs)}</span>
          <span>⚡ {wpm} WPM</span>
          <span>✓ 正确率 {accuracy}%</span>
          <span>✗ 错误 {errorCount}</span>
        </div>
      </div>

      {phase === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-slate-400">加载词库中…</div>
      )}

      {(phase === 'typing' || phase === 'dictation') && !current && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-lg font-medium text-slate-700">今天没有需要练习的内容</div>
          <p className="mt-2 text-sm text-slate-400">已掌握的单词会在规则设定的日期再次出现</p>
        </div>
      )}

      {(phase === 'typing' || phase === 'dictation') && current && (
        <div className={`flex flex-1 flex-col items-center justify-center ${flash ? 'animate-flash rounded-xl' : ''}`}>
          {/* 单词模式：大字单词；句子模式：截图风格卡片；默写：隐藏 */}
          {!isDictationPhase && !isSentenceCard && (
            <>
              <div className="mb-1 text-5xl font-bold tracking-wide text-slate-800">{current.text ?? ''}</div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}
          {isSentenceCard && sentenceSegments && (
            <SegmentedSentenceCard
              segments={sentenceSegments}
              meaning={current.meaning}
              blankInputs={blankInputs}
              blankStates={blankStates}
              activeBlank={activeBlank}
              onBlankChange={handleBlankChange}
              onBlankKeyDown={handleBlankKeyDown}
              onBlankFocus={(i: number) => {
                setActiveBlank(i)
                blankRefs.current[i]?.focus()
              }}
              answerMode={sentenceAnswerMode}
              onAnswerModeChange={(nextMode) => {
                setSentenceAnswerMode(nextMode)
                if (nextMode === 'study') {
                  blankRefs.current[activeBlank]?.blur()
                  setActiveBlank(-1)
                  return
                }
                setBlankInputs(sentenceSegments.map(() => ''))
                const firstBlank = sentenceSegments.findIndex((segment) => segment.isBlank)
                setBlankStates(sentenceSegments.map((segment, index) => (segment.isBlank ? (index === firstBlank ? 'active' : 'pending') : 'correct')))
                setActiveBlank(firstBlank)
                segItemErrorRef.current = false
                if (firstBlank >= 0) setTimeout(() => blankRefs.current[firstBlank]?.focus(), 60)
              }}
              blankRefs={blankRefs}
            />
          )}
          {isSentenceCard && !sentenceSegments && (
            <>
              {/* 截图风格：深色卡片，中文在上、英文在下，顶部暖色日出光晕 */}
              <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 px-6 pb-8 pt-10 shadow-2xl shadow-indigo-950/30 sm:px-10">
                {/* 日出光晕 */}
                <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-64 -translate-x-1/2 -translate-y-1/4 rounded-full bg-gradient-to-b from-amber-300/60 via-orange-400/25 to-transparent blur-2xl" />

                {/* 中文翻译（上，略小） */}
                <div className="relative mb-6 text-center">
                  <div className="text-2xl font-medium text-indigo-200/80">{current.meaning || ''}</div>
                </div>

                {/* 逐词样式（下，大字，状态色适配深色底） */}
                <div className="relative flex flex-wrap items-end justify-center gap-x-4 gap-y-2 px-4">
                  {sentenceCardSegments.map((seg, i) => {
                    const state = isWordWise ? wordChecks[i] ?? 'pending' : 'active'
                    const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(seg.text)
                    const visibleText = isWordWise
                      ? punctuationOnly
                        ? seg.text
                        : state === 'active'
                          ? input.trim()
                          : wordAnswers[i] || ''
                      : seg.text
                    const blankWidth = `${Math.max(44, Math.min(112, seg.text.length * 22))}px`
                    return (
                      <div key={i} className="flex flex-col items-center">
                        {/* 词文本 */}
                        <span
                          className={`text-4xl font-bold leading-none transition-colors ${
                            !visibleText && !punctuationOnly
                              ? 'text-transparent'
                              : state === 'correct'
                              ? 'text-green-400'
                              : state === 'incorrect'
                                ? 'text-red-400 line-through decoration-red-400/60'
                                : state === 'active'
                                  ? 'text-indigo-300'
                                  : 'text-indigo-200/50'
                          }`}
                        >
                          {visibleText || (punctuationOnly ? seg.text : '\u00a0')}
                        </span>
                        {/* 下划线 */}
                        {!punctuationOnly && (
                          <span
                            className={`mt-1.5 h-0.5 rounded-full transition-colors ${
                              state === 'correct'
                                ? 'bg-green-400/80'
                                : state === 'incorrect'
                                  ? 'bg-red-400/60'
                                  : state === 'active'
                                    ? 'bg-indigo-300'
                                    : 'bg-slate-600'
                            }`}
                            style={{ width: blankWidth }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* 底部细装饰线 */}
                <div className="relative mx-auto mt-6 h-0.5 w-24 rounded-full bg-indigo-400/40" />
              </div>
            </>
          )}
          {isDictationPhase && (
            <>
              <div className="mb-1 text-4xl font-bold text-slate-800">✍️ 默写模式</div>
              {current.phonetic && <div className="mb-2 text-lg text-slate-400">{current.phonetic}</div>}
            </>
          )}

          {/* 发音按钮 + 编辑 + 释义提示 */}
          <div className={`mb-6 flex items-center gap-3 ${isSentenceCard ? 'text-white' : ''}`}>
            <button
              onClick={() => speakItem(current)}
              disabled={!supported}
              className={`rounded-full p-2.5 transition disabled:opacity-40 ${
                isSentenceCard ? 'bg-white/10 text-white/80 hover:bg-white/20' : 'bg-brand-bg text-brand-dark hover:bg-brand-light'
              }`}
              title="发音"
            >
              🔊
            </button>
            {!isDictationPhase && (
              <>
                <button
                  onClick={() => setDialog({ action: 'create' })}
                  className={`rounded-full p-2.5 transition ${
                    isSentenceCard ? 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                  }`}
                  title={mode === 'sentence' ? '新增句子到本词库' : '新增单词到本词库'}
                >
                  ➕
                </button>
                <button
                  onClick={() => {
                    const japanese = current.extra?.trim()
                      ? current.extra
                      : current.segments?.map((segment) => segment.text).join('') || current.text || ''
                    setDialog({ action: 'edit', item: { ...current, extra: japanese } })
                  }}
                  className={`rounded-full p-2.5 transition ${
                    isSentenceCard ? 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                  }`}
                  title={mode === 'sentence' ? '编辑这个句子' : '编辑这个单词'}
                >
                  ✏️
                </button>
              </>
            )}
            {isDictationPhase && current.meaning && (
              <button
                onClick={() => setNotice(`提示：${current.meaning}`)}
                className="text-xs text-slate-400 underline hover:text-brand-dark"
              >
                提示释义
              </button>
            )}
            {!isDictationPhase && !isSentenceCard && current.meaning && (
              <span className="text-sm text-slate-500">{current.meaning}</span>
            )}
          </div>

          {/* 打字输入区 */}
          {sentenceSegments && !isDictationPhase ? (
            <div className="w-full max-w-md">
              <p className="mt-2 text-center text-xs text-white/40">
                每个空格独立判断：绿色正确 / 红色错误 · 部分填错不会清空其他空格 · 按空格或 Enter 跳到下一格
                {' · '}
                {currentIndex + 1}/{items.length}
              </p>
            </div>
          ) : (
          <div className="w-full max-w-md">
            <div
              className={`flex items-center gap-2 rounded-xl border-2 px-4 py-3 transition-colors ${
                isSentenceCard ? 'bg-white/5' : 'bg-white'
              } ${
                shake
                  ? 'animate-shake border-red-400'
                  : isSentenceCard
                    ? 'border-white/20 focus-within:border-indigo-300'
                    : 'border-brand-light focus-within:border-brand'
              }`}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (isWordWise && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    handleWordWiseEnter()
                  } else if (e.key === 'Enter') {
                    if (isJa || isDictationPhase) {
                      // 日语 / 默写：整词提交（IME 组合中的 Enter 不触发）
                      if (!e.nativeEvent.isComposing) {
                        e.preventDefault()
                        checkWhole()
                      }
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
                        ? '输入当前单词，按空格或 Enter 独立判断…'
                        : '开始打字…'
                }
                className={`w-full bg-transparent text-center font-mono outline-none ${
                  isSentenceCard ? 'text-white placeholder:text-white/30' : 'placeholder:text-slate-300'
                }`}
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
            <p className={`mt-2 text-center text-xs ${isSentenceCard ? 'text-white/40' : 'text-slate-400'}`}>
              {isJa
                ? '输入完整内容后按 Enter 或点提交 · 错误会清空重来'
                : isDictationPhase
                  ? '凭记忆输入 · Enter 提交 · 错误会清空重来'
                  : mode === 'sentence'
                    ? '每个单词独立判断：绿色正确 / 红色错误 · 错误也可继续下一个'
                    : '打错会清空重来 · 逐字符比对 · 退格无效'}
              {' · '}
              {currentIndex + 1}/{items.length}
            </p>
          </div>
          )}
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

      {/* 编辑/新增弹窗 */}
      {dialog && current && (
        <EditItemModal
          key={`${dialog.action}-${current.id}`}
          mode={mode}
          action={dialog.action}
          item={dialog.action === 'edit' ? dialog.item : current}
          isJa={isJa}
          speak={speak}
          onClose={() => setDialog(null)}
          onSave={handleEditSave}
          onCreate={handleAddSave}
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

/** 词性标签 → 中文名 + 配色（深色卡片用） */
const TYPE_META: Record<string, { label: string; cls: string }> = {
  noun: { label: '名词', cls: 'bg-sky-500/20 text-sky-300' },
  particle: { label: '助词', cls: 'bg-violet-500/20 text-violet-300' },
  verb: { label: '动词', cls: 'bg-emerald-500/20 text-emerald-300' },
  auxiliary: { label: '助动词', cls: 'bg-amber-500/20 text-amber-300' },
  adjective: { label: '形容词', cls: 'bg-pink-500/20 text-pink-300' },
  adverb: { label: '副词', cls: 'bg-teal-500/20 text-teal-300' },
}
function typeMeta(type: string) {
  if (type && TYPE_META[type]) return TYPE_META[type]
  return { label: type || '', cls: 'bg-white/10 text-white/50' }
}

/**
 * 填空式句子卡片：
 * - 中文翻译在顶部
 * - 非填空段（助词/助动词等）作为提示骨架显示，并带词性标签
 * - 填空段为独立输入框，逐格判断正确(绿)/错误(红)，单格错不波及他格
 */
function SegmentedSentenceCard({
  segments,
  meaning,
  blankInputs,
  blankStates,
  activeBlank,
  onBlankChange,
  onBlankKeyDown,
  onBlankFocus,
  answerMode,
  onAnswerModeChange,
  blankRefs,
}: {
  segments: Segment[]
  meaning: string
  blankInputs: string[]
  blankStates: WordCheckState[]
  activeBlank: number
  onBlankChange: (idx: number, value: string) => void
  onBlankKeyDown: (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlankFocus: (idx: number) => void
  answerMode: SentenceAnswerMode
  onAnswerModeChange: (mode: SentenceAnswerMode) => void
  blankRefs: React.MutableRefObject<(HTMLInputElement | null)[]>
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex justify-center">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-900 p-1 shadow-lg shadow-black/20">
          <button
            type="button"
            onClick={() => onAnswerModeChange('practice')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              answerMode === 'practice' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            练习模式
          </button>
          <button
            type="button"
            onClick={() => onAnswerModeChange('study')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              answerMode === 'study' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            学习模式
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950 px-6 pb-8 pt-10 shadow-2xl shadow-indigo-950/30 sm:px-10">
      {/* 日出光晕 */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-64 -translate-x-1/2 -translate-y-1/4 rounded-full bg-gradient-to-b from-amber-300/60 via-orange-400/25 to-transparent blur-2xl" />

      {/* 中文翻译（顶部） */}
      <div className="relative mb-6 text-center">
        <div className="text-2xl font-medium text-indigo-200/80">{meaning || ''}</div>
      </div>

      {/* 切分单元：填空段为输入框，非填空段为提示骨架 */}
      <div className="relative flex flex-wrap items-end justify-center gap-x-3 gap-y-5 px-2">
        {segments.map((seg, i) => {
          const meta = typeMeta(seg.type)
          if (isPunctuationSegment(seg.text)) {
            return <span key={i} className="pb-2 text-3xl font-bold leading-none text-indigo-200/90">{seg.text}</span>
          }
          if (!seg.isBlank) {
            // 提示骨架（给定词）：显示文本 + 词性标签
            return (
              <div key={i} className="flex flex-col items-center">
                <span className={`mb-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                <span className="text-3xl font-bold leading-none text-indigo-200/90">{seg.text}</span>
                {seg.reading && <span className="mt-1 text-xs text-slate-500">{seg.reading}</span>}
              </div>
            )
          }
          // 填空段
          const state = blankStates[i] ?? 'pending'
          const isStudyMode = answerMode === 'study'
          const isActive = !isStudyMode && activeBlank === i
          const characterCount = [...seg.text].length
          const width = `${Math.max(64, Math.min(320, characterCount * 44))}px`
          const colorCls = isStudyMode
            ? 'border-indigo-300 text-indigo-100'
            : state === 'correct'
              ? 'border-green-400 text-green-300'
              : state === 'incorrect'
                ? 'border-red-400 text-red-300'
                : 'border-white/50 text-white'
          return (
            <div key={i} className="flex flex-col items-center">
              {meta.label && <span className={`mb-1 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>}
              <input
                ref={(el) => {
                  blankRefs.current[i] = el
                }}
                value={isStudyMode ? seg.text : blankInputs[i] ?? ''}
                onChange={isStudyMode ? undefined : (e) => onBlankChange(i, e.target.value)}
                onKeyDown={isStudyMode ? undefined : (e) => onBlankKeyDown(i, e)}
                onFocus={isStudyMode ? undefined : () => onBlankFocus(i)}
                onClick={isStudyMode ? undefined : () => onBlankFocus(i)}
                readOnly={isStudyMode}
                tabIndex={isStudyMode ? -1 : 0}
                style={{ width }}
                className={`h-14 border-0 border-b-2 bg-transparent px-1 pb-1 pt-0 text-center text-3xl font-bold leading-none outline-none transition-all ${
                  colorCls
                } ${isActive ? 'border-indigo-300' : ''} ${isStudyMode ? 'cursor-default' : ''}`}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              {seg.reading && (
                <span className={`mt-1 text-xs ${isStudyMode ? 'text-indigo-300/70' : state === 'correct' ? 'text-green-400/70' : state === 'incorrect' ? 'text-red-400/70' : 'text-slate-500'}`}>
                  {seg.reading}
                </span>
              )}
            </div>
          )
        })}
      </div>

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

/** 切分单元 */
interface Segment {
  text: string
  reading: string
  /** 假名（日语汉字的注音假名） */
  furigana: string
  meaning: string
  /** 词性标签（noun/particle/verb/...） */
  type: string
  /** 是否作为填空（true 需用户填写） */
  isBlank: boolean
}

function isPunctuationSegment(text: string): boolean {
  return Boolean(text.trim()) && /^[\p{P}\p{S}]+$/u.test(text.trim())
}

/** 日语助词：自动切分时不生成练习单元 */
const JAPANESE_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'の', 'も', 'や',
  'から', 'まで', 'より', 'だけ', 'しか', 'ほど', 'くらい', 'ぐらい', 'など',
  'こそ', 'さえ', 'すら', 'でも', 'って', 'では', 'には', 'とは', 'への',
  'ね', 'よ', 'な', 'か',
])

/** 数字后的常用量词与时间单位会合并为一个单元，例如 6 + 時 → 6時 */
const JAPANESE_COUNTERS = new Set([
  '時', '分', '秒', '年', '月', '日', '人', '名', '個', '本', '枚', '冊',
  '台', '匹', '回', '歳', '才', '階', '円', 'つ',
])

const JAPANESE_NUMBER_PATTERN = /^(?:[0-9０-９]+|[一二三四五六七八九十百千万億兆〇零]+)$/

function splitJapaneseWords(text: string): string[] {
  const wordSegmenter = new Intl.Segmenter('ja', { granularity: 'word' })
  const tokens = Array.from(wordSegmenter.segment(text))
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.trim())
    .filter((token) => token && !JAPANESE_PARTICLES.has(token))

  return tokens.reduce<string[]>((result, token) => {
    const previous = result[result.length - 1]
    if (previous && JAPANESE_NUMBER_PATTERN.test(previous) && JAPANESE_COUNTERS.has(token)) {
      result[result.length - 1] = previous + token
    } else {
      result.push(token)
    }
    return result
  }, [])
}

const ROMAJI_PARTICLES = new Set([
  'wa', 'ga', 'o', 'wo', 'ni', 'e', 'he', 'to', 'de', 'no', 'mo', 'ya',
  'kara', 'made', 'yori', 'dake', 'shika', 'hodo', 'kurai', 'gurai', 'nado',
  'koso', 'sae', 'sura', 'demo', 'tte', 'dewa', 'niwa', 'towa', 'eno',
  'ne', 'yo', 'na', 'ka',
])

function splitRomajiWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .split(/\s+/)
    .map((token) => token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter((token) => token && !ROMAJI_PARTICLES.has(token.toLocaleLowerCase('en')))
}

const LOCAL_JAPANESE_MEANINGS = new Map<string, string>([
  ['です', '是'],
  ['でした', '曾是'],
  ['ます', '礼貌语'],
  ['あります', '有'],
  ['います', '在'],
])

function localJapaneseMeaning(word: string): string | null {
  const directMeaning = LOCAL_JAPANESE_MEANINGS.get(word)
  if (directMeaning) return directMeaning

  const normalized = word.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xfee0))
  const unitMatch = normalized.match(/^(\d+)(時|分|秒|年|月|日|人|名|個|本|枚|冊|台|匹|回|歳|才|階|円)$/)
  if (!unitMatch) return null

  const [, value, unit] = unitMatch
  const unitLabels: Record<string, string> = {
    時: '点', 分: '分', 秒: '秒', 年: '年', 月: '月', 日: '日', 人: '人', 名: '人',
    個: '个', 本: '个', 枚: '张', 冊: '本', 台: '台', 匹: '只', 回: '次', 歳: '岁', 才: '岁',
    階: '层', 円: '日元',
  }
  return `${value}${unitLabels[unit]}`
}

/** 自动切分文本：日语按词语切分并过滤助词，英语/Latin 按空格；默认每个单元都是填空 */
function autoSplitText(text: string, isJa: boolean): Segment[] {
  if (!text.trim()) return []
  if (isJa) {
    return splitJapaneseWords(text).map((word) => ({ text: word, reading: '', furigana: '', meaning: '', type: '', isBlank: true }))
  }
  // 英语/Latin：按空格/全角空格拆分
  return text.split(/[\s\u3000]+/).filter((w) => w.length > 0).map((w) => ({ text: w, reading: '', furigana: '', meaning: '', type: '', isBlank: true }))
}

function createEmptySegment(): Segment {
  return { text: '', reading: '', furigana: '', meaning: '', type: '', isBlank: true }
}

function createEmptySegments(count = 5): Segment[] {
  return Array.from({ length: count }, createEmptySegment)
}

type SentencePracticeItem = PracticeItem & {
  english?: string | null
  chinese?: string | null
  japanese?: string | null
}

const ROMAJI_MARKERS = new Set([
  'wa', 'ga', 'wo', 'o', 'desu', 'masu', 'mashita', 'shimasu', 'shimashita', 'arimasu', 'gozaimasu',
  'kudasai', 'onegai', 'yoroshiku', 'kara', 'made', 'koso', 'ne', 'yo', 'ka', 'kun', 'san',
])

const ROMAJI_SUFFIXES = ['mashita', 'masu', 'desu', 'shimasu', 'kudasai', 'gozaimasu']

function compactLatin(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function looksLikeLegacyRomaji(value: string, item: PracticeItem) {
  const candidate = value.trim()
  if (!candidate) return false

  const candidateCompact = compactLatin(candidate)
  const readingCompact = compactLatin(
    item.segments?.map((segment) => segment.reading ?? '').filter(Boolean).join(' ') ?? '',
  )
  if (readingCompact && candidateCompact === readingCompact) return true

  const tokens = candidate
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^a-z0-9āīūēō'-]+/u)
    .filter(Boolean)
  return tokens.some((token) => ROMAJI_MARKERS.has(token) || ROMAJI_SUFFIXES.some((suffix) => token.endsWith(suffix)))
}

function getEditFieldValues(item: PracticeItem, isCreate: boolean, jaLayout: boolean) {
  if (isCreate) return { text: '', meaning: '', extra: '', phonetic: '' }

  const sentenceItem = item as SentencePracticeItem
  if (!jaLayout) {
    return {
      text: item.text ?? '',
      meaning: item.meaning ?? '',
      extra: item.extra ?? '',
      phonetic: item.phonetic ?? '',
    }
  }

  const segmentText = item.segments?.map((segment) => segment.text).join('') ?? ''
  const japanese = item.extra?.trim()
    ? item.extra
    : sentenceItem.japanese?.trim()
      ? sentenceItem.japanese
      : segmentText.trim()
        ? segmentText
        : item.text ?? ''
  const storedEnglish = sentenceItem.english?.trim() || ''
  const legacyCandidate = storedEnglish || item.phonetic?.trim() || ''
  const english = legacyCandidate && !looksLikeLegacyRomaji(legacyCandidate, item)
    ? legacyCandidate
    : item.text?.trim() && item.text.trim() !== japanese.trim()
      ? item.text
      : ''

  return {
    text: english ?? '',
    meaning: item.meaning?.trim() ? item.meaning : sentenceItem.chinese ?? '',
    extra: japanese,
    phonetic: '',
  }
}

function getEditSegments(item: PracticeItem, mode: 'word' | 'sentence', isCreate: boolean, sourceText: string, isJa: boolean) {
  if (mode !== 'sentence') return []
  if (!isCreate && item.segments && item.segments.length > 0) {
    return item.segments
      .filter((segment) => !isPunctuationSegment(segment.text))
      .map((segment) => ({
        text: segment.text,
        reading: segment.reading ?? '',
        furigana: (segment as Segment).furigana ?? '',
        meaning: segment.meaning ?? '',
        type: segment.type ?? '',
        isBlank: segment.isBlank === true || segment.isBlank === 'true',
      }))
  }
  const splitSegments = autoSplitText(sourceText, isJa)
  return splitSegments.length > 0 ? splitSegments : createEmptySegments()
}

/** 编辑/新增句子或单词弹窗：edit = 修改当前词，create = 新增到本词库 */
function EditItemModal({
  mode,
  action,
  item,
  isJa,
  speak,
  onClose,
  onSave,
  onCreate,
}: {
  mode: 'word' | 'sentence'
  action: 'edit' | 'create'
  item: PracticeItem
  isJa: boolean
  speak: (text: string) => void
  onClose: () => void
  onSave: (data: { text: string; meaning?: string; extra?: string; phonetic?: string; segmentsJson?: string }) => void
  onCreate: (data: { text: string; meaning?: string; extra?: string; phonetic?: string; segmentsJson?: string }) => void
}) {
  const isCreate = action === 'create'
  // 日语模式句子：日文优先布局 + 自动翻译（新增和编辑一致）
  const jaLayout = isJa && mode === 'sentence'
  const initialValues = getEditFieldValues(item, isCreate, jaLayout)
  const [text, setText] = useState(initialValues.text)
  const [meaning, setMeaning] = useState(initialValues.meaning)
  const [extra, setExtra] = useState(initialValues.extra)
  const [phonetic, setPhonetic] = useState(initialValues.phonetic)
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [error, setError] = useState('')

  /* ---- 切分编辑器状态（仅句子模式）---- */
  const [segments, setSegments] = useState<Segment[]>(() =>
    getEditSegments(item, mode, isCreate, jaLayout ? initialValues.extra : initialValues.text, isJa),
  )

  useEffect(() => {
    const values = getEditFieldValues(item, isCreate, jaLayout)
    setText(values.text)
    setMeaning(values.meaning)
    setExtra(values.extra)
    setPhonetic(values.phonetic)
    setSegments(getEditSegments(item, mode, isCreate, jaLayout ? values.extra : values.text, isJa))
    setSplitting(false)
    setError('')
    setTranslating(false)

    if (jaLayout && !isCreate && !values.text.trim() && values.extra.trim()) {
      let cancelled = false
      setTranslating(true)
      translateApi.jaToEn(values.extra.trim())
        .then((english) => {
          if (!cancelled && english.trim()) setText(english.trim())
        })
        .catch(() => {
          // 翻译失败时保留空白，用户可以手动填写英文。
        })
        .finally(() => {
          if (!cancelled) setTranslating(false)
        })
      return () => {
        cancelled = true
      }
    }
  }, [action, isCreate, isJa, item, jaLayout, mode])

  /** 日文输入结束（失焦）→ 自动翻译成英文填充（英文为空时才翻译） */
  const handleJaBlur = async () => {
    if (!extra.trim() || text.trim() || translating) return
    setTranslating(true)
    try {
      const en = await translateApi.jaToEn(extra.trim())
      if (en) setText(en)
    } catch {
      // 翻译失败静默处理，用户可手动输入英文
    } finally {
      setTranslating(false)
    }
  }

  /* ---- 切分编辑器操作 ---- */

  /** 自动切分，并为日语词语补全中文释义和罗马音 */
  const handleAutoSplit = async () => {
    const src = jaLayout ? (extra || text) : text
    const nextSegments = autoSplitText(src, isJa)
    setSegments(nextSegments)
    if (!isJa || nextSegments.length === 0) return

    setSplitting(true)
    setError('')
    try {
      const romajiWords = splitRomajiWords(text)
      const alignedRomaji = romajiWords.length === nextSegments.length ? romajiWords : []
      const meanings = await Promise.all(
        nextSegments.map(async (segment) => {
          const localMeaning = localJapaneseMeaning(segment.text)
          if (localMeaning) return localMeaning
          try {
            const translated = (await translateApi.jaToZh(segment.text)).trim()
            return /^[\p{P}\p{S}\s]+$/u.test(translated) ? '' : translated
          } catch {
            return ''
          }
        }),
      )
      setSegments(
        nextSegments.map((segment, index) => ({
          ...segment,
          meaning: meanings[index] ?? '',
          reading: alignedRomaji[index] ?? '',
        })),
      )
    } finally {
      setSplitting(false)
    }
  }

  /** 切换某单元是否为填空 */
  const toggleBlank = (idx: number) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, isBlank: !s.isBlank } : s)))
  }

  /** 删除指定单元 */
  const deleteSegment = (idx: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== idx))
  }

  /** 在末尾增加一个空白切分单元 */
  const addSegment = () => {
    setSegments((prev) => [...prev, createEmptySegment()])
  }

  /** 更新某个单元的内容 */
  const updateSegment = (idx: number, field: keyof Segment, value: string) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
  }

  const save = async () => {
    if (!text.trim()) {
      setError(mode === 'sentence' ? '英文内容不能为空' : '单词不能为空')
      return
    }
    const filledSegments = segments.filter(
      (segment) => !isPunctuationSegment(segment.text) && (segment.text.trim() || segment.meaning.trim() || segment.reading.trim()),
    )
    const incompleteSegmentIndex = filledSegments.findIndex((segment) => !segment.text.trim())
    if (mode === 'sentence' && incompleteSegmentIndex >= 0) {
      setError(`切分单元第 ${incompleteSegmentIndex + 1} 行需要填写日文`)
      return
    }
    setSaving(true)
    try {
      // 构造 segmentsJson（仅句子模式且有切分数据时），保留 type / isBlank / furigana
      const segmentsJson = mode === 'sentence' && filledSegments.length > 0
        ? JSON.stringify(
            filledSegments.map((s) => ({
              text: s.text.trim(),
              reading: s.reading.trim() || undefined,
              furigana: s.furigana.trim() || undefined,
              meaning: s.meaning.trim() || undefined,
              type: s.type || undefined,
              isBlank: s.isBlank,
            })),
          )
        : undefined
      const data = { text: text.trim(), meaning: meaning.trim() || undefined, extra: extra.trim() || undefined, phonetic: phonetic.trim() || undefined, segmentsJson }
      if (isCreate) await onCreate(data)
      else await onSave(data)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="presentation">
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-editor-title"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 id="practice-editor-title" className="text-lg font-semibold text-slate-800">
            {isCreate
              ? `新增${mode === 'sentence' ? '句子' : '单词'}到本词库`
              : `${mode === 'sentence' ? '编辑句子' : '编辑单词'}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
            aria-label="关闭编辑窗口"
          >
            ×
          </button>
        </div>
        {mode === 'sentence' ? (
          jaLayout ? (
            /* 日语模式新增：日文在前（失焦自动翻译英文），中文手动输入 */
            <div className="space-y-3">
              <EditField
                label="日文"
                value={extra}
                onChange={setExtra}
                onBlur={handleJaBlur}
                placeholder="日本語（输入完成鼠标点别处自动翻译英文）"
                hint={translating ? '正在翻译成英文…' : '输入日文后离开输入框，自动翻译英文'}
              />
              <EditField label="中文" value={meaning} onChange={setMeaning} placeholder="中文翻译（手动输入）" />
              <EditField label="英文（自动翻译）" value={text} onChange={setText} placeholder="English（可手动修改）" />
            </div>
          ) : (
            <div className="space-y-3">
              <EditField label="英文" value={text} onChange={setText} placeholder="English sentence" />
              <EditField label="中文" value={meaning} onChange={setMeaning} placeholder="中文翻译" />
              <EditField label="日文" value={extra} onChange={setExtra} placeholder="日本語" />
            </div>
          )
        ) : (
          <div className="space-y-3">
            <EditField label="单词" value={text} onChange={setText} placeholder="如 apple" />
            <EditField label="音标" value={phonetic} onChange={setPhonetic} placeholder="如 /ˈæpl/" />
            <EditField label="释义" value={meaning} onChange={setMeaning} placeholder="如 苹果" />
            <EditField label="词性" value={extra} onChange={setExtra} placeholder="如 n." />
          </div>
        )}
        {/* 切分编辑器（仅句子模式） */}
        {mode === 'sentence' && (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">切分单元（{segments.length} 个）</span>
              <button
                type="button"
                onClick={handleAutoSplit}
                disabled={splitting}
                className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {splitting ? '正在补全…' : '✂️ 自动切分'}
              </button>
            </div>

            <div className="space-y-2 pb-1">
                <div className="grid grid-cols-[1fr_0.9fr_1.1fr_1fr_auto_auto_auto] items-center gap-2 px-1 text-[11px] font-medium text-slate-500">
                  <span>日文</span>
                  <span>假名</span>
                  <span>中文</span>
                  <span>罗马音</span>
                  <span className="w-9" />
                  <span className="w-12 text-center">填空</span>
                  <span className="w-8" />
                </div>
                {segments.map((segment, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[1fr_0.9fr_1.1fr_1fr_auto_auto_auto] items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                  >
                    <input
                      value={segment.text}
                      onChange={(e) => updateSegment(index, 'text', e.target.value)}
                      placeholder="日本語"
                      className="min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-light"
                    />
                    <input
                      value={segment.furigana}
                      onChange={(e) => updateSegment(index, 'furigana', e.target.value)}
                      placeholder="ふりがな"
                      className="min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-light"
                    />
                    <input
                      value={segment.meaning}
                      onChange={(e) => updateSegment(index, 'meaning', e.target.value)}
                      placeholder="中文释义"
                      className="min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-light"
                    />
                    <input
                      value={segment.reading}
                      onChange={(e) => updateSegment(index, 'reading', e.target.value)}
                      placeholder="Romaji"
                      className="min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-light"
                    />
                    {/* 单词发音按钮 */}
                    <button
                      type="button"
                      onClick={() => speak(segment.text || '')}
                      disabled={!segment.text.trim()}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-base transition ${
                        segment.text.trim()
                          ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:bg-indigo-200'
                          : 'cursor-not-allowed bg-slate-100 text-slate-300'
                      }`}
                      title={`播放「${segment.text || ''}」`}
                      aria-label={`播放 ${segment.text}`}
                    >
                      🔊
                    </button>
                    <label className="flex w-12 items-center justify-center" title={segment.isBlank ? '作为填空' : '作为提示'}>
                      <input
                        type="checkbox"
                        checked={segment.isBlank}
                        onChange={() => toggleBlank(index)}
                        className="h-4 w-4 accent-brand"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteSegment(index)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                      title={`删除第 ${index + 1} 行`}
                      aria-label={`删除第 ${index + 1} 行`}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addSegment}
                className="rounded-lg border border-brand-light bg-white px-3 py-1.5 text-xs font-medium text-brand-dark transition hover:bg-brand-bg"
              >
                + 增加一行
              </button>
              <span className="text-[10px] text-slate-400">空白行不会保存；每行日文为必填项</span>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <p className="mt-2 text-xs text-slate-400">
          {isCreate
            ? '新增内容归属当前词库（与当前练习相同的词库组/词库），追加到本轮练习末尾'
            : '修改会保存到词库，所有用户都能看到；当前词将从新内容重新练习'}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || translating || splitting}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {saving ? '保存中…' : translating ? '翻译中…' : splitting ? '补全中…' : isCreate ? '添加' : '保存'}
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
  onBlur,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
      />
      {hint && <p className="mt-1 text-xs text-brand-dark">{hint}</p>}
    </div>
  )
}

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function normalizeWholeAnswer(value: string, ignoreWhitespace: boolean) {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase()
  return ignoreWhitespace ? normalized.replace(/\s+/gu, '') : normalized
}
