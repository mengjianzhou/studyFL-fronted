import { useCallback, useEffect } from 'react'

/**
 * 浏览器语音合成（Web Speech API）
 * - en → en-US，ja → ja-JP
 * - 系统无对应语音包时静默降级（返回 available=false）
 */
export function useSpeech(langCode: 'en' | 'ja' | string = 'en') {
  const voiceLang = langCode === 'ja' ? 'ja-JP' : 'en-US'

  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const speak = useCallback(
    (text: string) => {
      if (!speechSupported) return
      // 先取消当前播报，避免叠加
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = voiceLang
      utterance.rate = 0.9
      // 尝试选一个匹配语言的本地语音
      const voices = window.speechSynthesis.getVoices()
      const match = voices.find((v) => v.lang.toLowerCase().startsWith(voiceLang.toLowerCase()))
      if (match) utterance.voice = match
      window.speechSynthesis.speak(utterance)
    },
    [speechSupported, voiceLang],
  )

  const stop = useCallback(() => {
    if (speechSupported) window.speechSynthesis.cancel()
  }, [speechSupported])

  // 组件卸载时停止播报
  useEffect(() => {
    return () => {
      if (speechSupported) window.speechSynthesis.cancel()
    }
  }, [speechSupported])

  return { speak, stop, supported: speechSupported }
}
