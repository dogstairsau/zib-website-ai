import { next, rewrite } from '@vercel/edge';

/**
 * Serve white-label audit pages at the ROOT of each partner's audit subdomain
 * (e.g. audit.cheeksandco.com.au, audit.twinsocial.com.au).
 *
 * A vercel.json `rewrites` entry can't do this: Vercel serves the static
 * index.html (the Zib homepage) before rewrites are evaluated. Edge Middleware
 * runs before the filesystem, so it can map "/" to the partner page while
 * keeping the URL clean (no /cheeks shown). Only runs on the root path.
 */
export const config = { matcher: '/' };

const PARTNER_HOSTS: Record<string, string> = {
  'audit.cheeksandco.com.au': '/cheeks',
  'audit.twinsocial.com.au': '/twinsocial',
};

export default function middleware(request: Request) {
  const host = (request.headers.get('host') || '').toLowerCase().replace(/^www\./, '');
  const page = PARTNER_HOSTS[host];
  if (page) return rewrite(new URL(page, request.url));
  return next();
}
