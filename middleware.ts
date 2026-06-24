import { next, rewrite } from '@vercel/edge';

/**
 * Serve the Cheeks & Co audit at the ROOT of audit.cheeksandco.com.au.
 *
 * A vercel.json `rewrites` entry can't do this: Vercel serves the static
 * index.html (the Zib homepage) before rewrites are evaluated. Edge Middleware
 * runs before the filesystem, so it can map "/" to the Cheeks page while
 * keeping the URL clean (no /cheeks shown). Only runs on the root path.
 */
export const config = { matcher: '/' };

export default function middleware(request: Request) {
  const host = (request.headers.get('host') || '').toLowerCase();
  if (host === 'audit.cheeksandco.com.au' || host === 'www.audit.cheeksandco.com.au') {
    return rewrite(new URL('/cheeks', request.url));
  }
  return next();
}
