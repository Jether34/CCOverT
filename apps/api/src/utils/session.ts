import crypto from 'node:crypto';
import { config } from '../config';
import { AppError } from './errors';

interface SessionPayload {
  sub: string;
  exp: number;
  nonce: string;
}

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');
const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');
const sign = (value: string): string => crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = {
    sub: userId,
    exp: Date.now() + config.sessionMaxAgeMs,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(decode(encoded)) as Partial<SessionPayload>;
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp < Date.now() || typeof payload.nonce !== 'string' || !payload.nonce) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: import('express').Response, userId: string): void {
  response.cookie(config.sessionCookieName, createSessionToken(userId), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionMaxAgeMs,
    path: '/'
  });
}

export function clearSessionCookie(response: import('express').Response): void {
  response.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/'
  });
}

export function requireSameOrigin(request: import('express').Request): void {
  // In local development the gate is off on purpose. The dev server can be
  // reached as localhost, 127.0.0.1, or ::1, through the Vite proxy or
  // straight to the API, and an allowlist that has to be edited every time a
  // port or hostname spelling changes blocks the dev loop without protecting
  // anything. Every other environment, including production, keeps the exact
  // allowlist below: that is a real CSRF defence, not a development guard.
  if (config.nodeEnv === 'development') return;
  const origin = request.get('origin');
  if (origin) {
    if (config.webOrigins.includes(origin)) return;
    throw new AppError(403, 'FORBIDDEN', 'The request origin is not allowed.');
  }
  const referer = request.get('referer');
  if (referer) {
    try {
      if (config.webOrigins.includes(new URL(referer).origin)) return;
    } catch {
      throw new AppError(403, 'FORBIDDEN', 'The request referrer is not allowed.');
    }
    throw new AppError(403, 'FORBIDDEN', 'The request referrer is not allowed.');
  }
  const fetchSite = request.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    throw new AppError(403, 'FORBIDDEN', 'The request origin is not allowed.');
  }
}

export function sameOriginMiddleware(request: import('express').Request, _response: import('express').Response, next: import('express').NextFunction): void {
  requireSameOrigin(request);
  next();
}
