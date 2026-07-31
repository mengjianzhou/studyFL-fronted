import { create } from 'zustand'
import { libraryApi } from '../api/library'
import type { LanguageVO } from '../types'

interface LibraryState {
  tree: LanguageVO[]
  loading: boolean
  error: string | null
  fetchTree: () => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set) => ({
  tree: [],
  loading: false,
  error: null,
  fetchTree: async () => {
    set({ loading: true, error: null })
    try {
      const tree = await libraryApi.tree()
      set({ tree, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },
}))
