# Vercel / Next.js dynamic route fix

The request-dependent API routes are explicitly marked dynamic:

- `/api/search`
- `/api/sets`
- `/api/old`
- `/api/ping`
- `/api/health`
- `/api/check-exotico` was already dynamic.

This prevents Next.js 14 from trying to prerender request-specific API handlers during `next build`, which caused `DYNAMIC_SERVER_USAGE` when `request.url` was read inside a `try/catch`.
