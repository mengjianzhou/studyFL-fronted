import client, { api } from './client'

export const translateApi = {
  /** 日语 → 英语 */
  jaToEn: (text: string) =>
    api<string>(client.post('/translate', { text, from: 'ja', to: 'en' })),
  /** 日语 → 中文 */
  jaToZh: (text: string) =>
    api<string>(client.post('/translate', { text, from: 'ja', to: 'zh-CN' })),
}
