// lib/api.js — one way to call the API.
//
// A path is always resolved against the API's address (VITE_API_URL), never against the page's own host: on the
// hosted app the page is served by a static host, and a relative "/api/…" there returns the app's HTML shell,
// not the API. The caller's token is attached unless the call brings its own Authorization header.
import { getSessionMaybe } from './session'

export const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

export async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (!headers.Authorization && !headers.authorization) {
    const s = await getSessionMaybe()
    if (s?.access_token) headers.Authorization = 'Bearer ' + s.access_token
  }
  return fetch(API + path, { ...opts, headers })
}
