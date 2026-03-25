import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const API_BASE = '/api'

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor for auth
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('watchtower_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor for errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth state - this will trigger redirect to login
      useAuthStore.getState().handleAuthError()
    }
    return Promise.reject(error)
  }
)
