import client, { api } from './client'
import type { PracticeItemsResponse, ProgressVO } from '../types'

export interface SubmitPayload {
  bankId: number
  mode: 'word' | 'sentence'
  orderType: 'asc' | 'shuffle'
  totalWords: number
  correctFirstWords: number
  errorCount: number
  totalKeystrokes: number
  elapsedMs: number
  isDictation: boolean
  dictationScore?: number
  itemResults?: { itemId: number; success: boolean }[]
}

export const practiceApi = {
  words: (bankId: number, mode: 'word' | 'sentence', order: 'asc' | 'shuffle' = 'shuffle') =>
    api<PracticeItemsResponse>(client.get('/practices/words', { params: { bankId, mode, order } })),
  submit: (payload: SubmitPayload) =>
    api<{ recordId: number; progress: ProgressVO }>(client.post('/practices/records', payload)),
  progress: (bankId: number, mode: 'word' | 'sentence') =>
    api<ProgressVO>(client.get('/progress', { params: { bankId, mode } })),
}
