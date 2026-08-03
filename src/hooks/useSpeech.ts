import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * 浏览器语音合成（Web Speech API）
 * - en → en-US，ja → ja-JP
 * - 系统无对应语音包时静默降级（返回 available=false）
 */
export function useSpeech(langCode: 'en' | 'ja' | string = 'en') {
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const voiceLang = useMemo(() => {
    const normalized = langCode.trim().toLowerCase()
    return normalized === 'ja' || normalized === 'jp' || normalized.startsWith('ja-') ? 'ja-JP' : 'en-US'
  }, [langCode])
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const speechRequestRef = useRef(0)

  useEffect(() => {
    if (!speechSupported) return

    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices()
    }
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)

    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [speechSupported])

  const speak = useCallback(
    (text: string) => {
      const content = text.trim()
      if (!speechSupported || !content) return

      const requestId = speechRequestRef.current + 1
      speechRequestRef.current = requestId
      window.speechSynthesis.cancel()

      const play = (attempt: number) => {
        if (speechRequestRef.current !== requestId) return
        const availableVoices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices()
        if (availableVoices.length === 0 && attempt < 10) {
          window.setTimeout(() => play(attempt + 1), 100)
          return
        }

        const utterance = new SpeechSynthesisUtterance(content)
        utterance.lang = voiceLang
        utterance.rate = 0.9

        const normalizedLang = voiceLang.toLowerCase()
        const baseLang = normalizedLang.split('-')[0]
        const matchingVoices = availableVoices.filter((voice) => voice.lang.toLowerCase().split('-')[0] === baseLang)
        const match =
          matchingVoices.find((voice) => voice.lang.toLowerCase() === normalizedLang && voice.localService) ??
          matchingVoices.find((voice) => voice.lang.toLowerCase() === normalizedLang) ??
          matchingVoices.find((voice) => voice.localService) ??
          matchingVoices[0]

        if (match) utterance.voice = match
        window.speechSynthesis.speak(utterance)
      }

      play(0)
    },
    [speechSupported, voiceLang],
  )

  const stop = useCallback(() => {
    speechRequestRef.current += 1
    if (speechSupported) window.speechSynthesis.cancel()
  }, [speechSupported])

  // 组件卸载时停止播报
  useEffect(() => {
    return () => {
      speechRequestRef.current += 1
      if (speechSupported) window.speechSynthesis.cancel()
    }
  }, [speechSupported])

  return { speak, stop, supported: speechSupported }
}
