import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const API_BASE = '/api'

// Axios' default is no timeout, so a stuck request (server hung, LB
// black hole, dropped packets) will sit pending forever and freeze any
// UI affordance waiting on it. 30s is generous for our longest endpoint
// (history backfills) and tight enough to surface real outages.
const REQUEST_TIMEOUT_MS = 30_000

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Auth rides on the HttpOnly session cookie the backend sets at login; the
// browser attaches it to these same-origin requests automatically, so no
// Authorization header is injected here.

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
