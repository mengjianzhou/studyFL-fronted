/** 后端统一响应 */
export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

/** 分页响应 */
export interface PageResult<T> {
  total: number
  page: number
  size: number
  records: T[]
}

export interface User {
  id: number
  username: string
  nickname: string
  avatar: string | null
  activeLanguageId: number | null
}

export interface LoginResponse {
  token: string
  user: User
}

export interface WordVO {
  id: number
  word: string
  phonetic: string | null
  meaning: string | null
  wordType: string | null
}

export interface SentenceVO {
  id: number
  english: string | null
  chinese: string | null
  japanese: string | null
  sentenceType: string | null
}

export interface ProgressVO {
  status: 'IN_PROGRESS' | 'COMPLETED'
  totalCount: number
  completedCount: number
  completedAt: string | null
}

export interface BankVO {
  id: number
  name: string
  description: string
  wordCount: number
  sentenceCount: number
  progress: ProgressVO | null
}

export interface GroupVO {
  id: number
  name: string
  description: string
  banks: BankVO[]
}

export interface LanguageVO {
  id: number
  name: string
  code: string
  groups: GroupVO[]
}

export interface PracticeItem {
  id: number
  /** 需要打的内容 */
  text: string
  phonetic: string | null
  meaning: string
  extra: string | null
}

export interface PracticeItemsResponse {
  items: PracticeItem[]
  totalCount: number
}

export interface Statistics {
  totalPractices: number
  totalKeystrokes: number
  avgAccuracy: number
  avgWpm: number
  daily: { date: string; count: number }[]
}

export interface BankStats {
  bankId: number
  bankName: string
  groupName: string
  languageCode: string
  practices: number
  avgAccuracy: number
  avgWpm: number
  progressStatus: string | null
}
