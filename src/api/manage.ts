import client, { api } from './client'
import type { SentenceVO, WordVO } from '../types'

export interface GroupCreateRequest {
  languageId: number
  name: string
  description?: string
}

export interface BankCreateRequest {
  groupId: number
  name: string
  description?: string
}

export interface WordSaveRequest {
  word: string
  phonetic?: string
  meaning?: string
  wordType?: string
}

export interface SentenceSaveRequest {
  english?: string
  chinese?: string
  japanese?: string
  sentenceType?: string
}

export const manageApi = {
  // 词库组
  createGroup: (data: GroupCreateRequest) =>
    api<{ id: number; name: string }>(client.post('/groups', data)),
  deleteGroup: (groupId: number) => api<void>(client.delete(`/groups/${groupId}`)),

  // 词库
  createBank: (data: BankCreateRequest) =>
    api<{ id: number; name: string }>(client.post('/banks', data)),
  deleteBank: (bankId: number) => api<void>(client.delete(`/banks/${bankId}`)),

  // 单词
  createWord: (bankId: number, data: WordSaveRequest) =>
    api<WordVO>(client.post(`/banks/${bankId}/words`, data)),
  updateWord: (wordId: number, data: WordSaveRequest) =>
    api<WordVO>(client.put(`/words/${wordId}`, data)),
  deleteWord: (wordId: number) => api<void>(client.delete(`/words/${wordId}`)),

  // 句子
  createSentence: (bankId: number, data: SentenceSaveRequest) =>
    api<SentenceVO>(client.post(`/banks/${bankId}/sentences`, data)),
  updateSentence: (sentenceId: number, data: SentenceSaveRequest) =>
    api<SentenceVO>(client.put(`/sentences/${sentenceId}`, data)),
  deleteSentence: (sentenceId: number) => api<void>(client.delete(`/sentences/${sentenceId}`)),
}
