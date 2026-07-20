// middleware.js
// Disabled (empty matcher) — kept as a stub. The previous version imported
// jsonwebtoken here, which pulls Node-only modules into the Edge runtime and
// makes Vercel reject the whole deployment even though this never runs.
// Admin route protection happens server-side in the API routes instead.
import { NextResponse } from 'next/server';

export async function middleware(req) {
  return NextResponse.next();
}

export const config = {
  matcher: [], // 👈 Disable middleware for now
};
