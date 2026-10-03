import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { handleResolver } from '@/server/runtime';

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const token = request.nextUrl.pathname.split('/')[2];
  const response = await handleResolver(request, token, (task) => event.waitUntil(task));
  if (response.status === 200 && response.headers.get('X-QR-Page') === 'activation') {
    const page = NextResponse.next();
    for (const name of [
      'Cache-Control',
      'X-Request-Id',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Strict-Transport-Security',
    ]) {
      const value = response.headers.get(name);
      if (value) page.headers.set(name, value);
    }
    return page;
  }
  return response;
}
export const config = { matcher: '/r/:token' };
