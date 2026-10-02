'use client';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiFailure, type ApiOptions } from '@/lib/api';
export function useOwnerApi() {
  const queries = useQueryClient();
  return useCallback(
    async <T>(path: string, options: ApiOptions = {}) => {
      try {
        return await apiRequest<T>(path, options);
      } catch (error) {
        if (
          error instanceof ApiFailure &&
          (error.status === 401 ||
            ['CSRF_INVALID', 'VERSION_MISMATCH', 'QR_SUSPENDED'].includes(error.code))
        )
          void queries.invalidateQueries({ queryKey: ['owner', 'me'] });
        throw error;
      }
    },
    [queries],
  );
}
