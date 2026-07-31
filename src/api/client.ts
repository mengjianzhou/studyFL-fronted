import axios from 'axios'
import { useAuthStore } from '../stores/authStore'
import type { ApiResult } from '../types'

const client = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// 请求拦截器：注入 JWT
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：统一错误处理 + 401 跳登录
client.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResult<unknown>
    if (body.code !== 0) {
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    const msg = error.response?.data?.message || error.message || '网络错误'
    return Promise.reject(new Error(msg))
  },
)

/** 获取 data 字段 */
export async function api<T>(promise: Promise<{ data: ApiResult<T> }>): Promise<T> {
  const res = await promise
  return res.data.data
}

export default client
