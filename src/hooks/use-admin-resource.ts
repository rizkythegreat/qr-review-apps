'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAdminApi, useAdminAuth } from '@/components/providers';

export function useAdminResource<T>(path: string) {
  const api = useAdminApi();
  const { session } = useAdminAuth();
  return useQuery({
    queryKey: ['admin', session?.user.id, path],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: Boolean(session),
  });
}
export function useAdminList<T>(path: string) {
  const api = useAdminApi();
  const { session } = useAdminAuth();
  return useInfiniteQuery({
    queryKey: ['admin', session?.user.id, path, 'pages'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      api<T[]>(
        `${path}${path.includes('?') ? '&' : '?'}limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    getNextPageParam: (page) => page.pagination?.next_cursor || undefined,
    enabled: Boolean(session),
  });
}
