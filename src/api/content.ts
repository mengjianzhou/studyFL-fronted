import client, { api } from './client'
import type { PageResult, SentenceVO, WordVO } from '../types'

export const contentApi = {
  /** 单词分页 */
  words: (bankId: number, page = 1, size = 50) =>
    api<PageResult<WordVO>>(client.get(`/banks/${bankId}/words`, { params: { page, size } })),
  /** 句子分页 */
  sentences: (bankId: number, page = 1, size = 50) =>
    api<PageResult<SentenceVO>>(client.get(`/banks/${bankId}/sentences`, { params: { page, size } })),
}
