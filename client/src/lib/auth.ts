import { apiFetch, apiGet } from './api';
import type { MeResponse } from '../types';

export async function fetchMe(): Promise<MeResponse | null> {
  const { ok, data } = await apiGet<MeResponse>('/api/me');
  if (!ok || !data?.loggedIn) return null;
  if (data.csrfToken) window.__CSRF_TOKEN__ = data.csrfToken;
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login';
  }
}
