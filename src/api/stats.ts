import client, { api } from './client'
import type { BankStats, Statistics } from '../types'

export const statsApi = {
  me: (days = 30) => api<Statistics>(client.get('/statistics/me', { params: { days } })),
  banks: () => api<BankStats[]>(client.get('/statistics/banks')),
}
