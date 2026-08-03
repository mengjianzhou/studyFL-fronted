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

/** 句子切分单元 */
export interface SentenceSegment {
  /** 表面文本（日语为原文，英语为单词） */
  text: string
  /** 读音（罗马音 / 音标） */
  reading?: string
  /** 中文释义 */
  meaning?: string
  /** 词性标签：noun / particle / verb / auxiliary / adjective / adverb … */
  type?: string
  /** 是否作为填空（true 时需用户填写，false 为提示骨架） */
  isBlank?: boolean | string
}

export interface PracticeItem {
  id: number
  /** 需要打的内容 */
  text: string
  phonetic: string | null
  meaning: string
  english?: string | null
  chinese?: string | null
  japanese?: string | null
  extra: string | null
  /** 切分单元列表（后端已切分时），null 表示未切分 */
  segments?: SentenceSegment[]
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
