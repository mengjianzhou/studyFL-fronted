import client, { api } from './client'
import type { BankVO, LanguageVO } from '../types'

export const libraryApi = {
  tree: () => api<LanguageVO[]>(client.get('/library/tree')),
  bankDetail: (bankId: number) => api<BankVO>(client.get(`/banks/${bankId}`)),
}
