// The NestJS API mounts every route under a global "api" prefix (see apps/api/src/main.ts).
// This must stay in sync with the default documented in apps/web/.env.example.
export const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api';
