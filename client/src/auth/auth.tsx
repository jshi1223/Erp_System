import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '../lib/auth';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000, retry: false });
}

// Protected route gate. On signed-out, do a full redirect to the classic /login page.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <div className="page-center">Loading…</div>;
  if (!data) {
    window.location.href = '/login';
    return null;
  }
  return <>{children}</>;
}
