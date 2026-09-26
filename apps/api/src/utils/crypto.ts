import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const verificationToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (token: string): string => sha256(token);
