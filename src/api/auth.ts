import client, { api } from './client'
import type { LoginResponse, User } from '../types'

export const authApi = {
  register: (data: { username: string; password: string; nickname?: string }) =>
    api<LoginResponse>(client.post('/auth/register', data)),
  login: (data: { username: string; password: string }) =>
    api<LoginResponse>(client.post('/auth/login', data)),
  me: () => api<User>(client.get('/auth/me')),
  updateMe: (data: { nickname?: string; activeLanguageId?: number }) =>
    api<User>(client.put('/users/me', data)),
}
