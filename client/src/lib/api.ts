export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

declare global {
  interface Window {
    __CSRF_TOKEN__?: string;
  }
}

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (method !== 'GET' && !headers.has('X-CSRF-Token')) {
    const token = String(window.__CSRF_TOKEN__ || '').trim();
    if (token) headers.set('X-CSRF-Token', token);
  }
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function apiGet<T = unknown>(url: string) {
  return apiFetch<T>(url);
}

export function apiPatch<T = unknown>(url: string, body: unknown) {
  return apiFetch<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export function apiPost<T = unknown>(url: string, body: unknown) {
  return apiFetch<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export function apiPut<T = unknown>(url: string, body: unknown) {
  return apiFetch<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}
