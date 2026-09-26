import crypto from 'node:crypto';
import { config } from '../config';
import { db, type SmtpOverride } from '../repositories/database';

const key = crypto.createHash('sha256').update(`ccovert:smtp:${config.sessionSecret}`).digest();

export function encryptSmtpPassword(password: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

export function decryptSmtpPassword(encrypted: string): string {
  const [iv, tag, data] = encrypted.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export async function effectiveSmtp(): Promise<{ host: string; port: number; secure: boolean; user: string; pass: string; from: string; source: 'database' | 'environment' }> {
  const override = await db.getSmtpOverride();
  if (override?.enabled) return {
    host: override.host, port: override.port, secure: override.secure, user: override.user,
    pass: decryptSmtpPassword(override.encryptedPassword), from: override.from, source: 'database'
  };
  return { ...config.smtp, source: 'environment' };
}

export function publicSmtp(override: SmtpOverride | null): { enabled: boolean; configured: boolean; host: string | null; port: number; secure: boolean; user: string | null; from: string | null; source: string } {
  const active = override?.enabled ? override : null;
  return {
    enabled: Boolean(active), configured: Boolean(active ? active.host && active.encryptedPassword && active.from : config.smtp.host && config.smtp.pass && config.smtp.from),
    host: active?.host ?? config.smtp.host ?? null, port: active?.port ?? config.smtp.port,
    secure: active?.secure ?? config.smtp.secure, user: active?.user ?? config.smtp.user ?? null,
    from: active?.from ?? config.smtp.from ?? null, source: active ? 'database' : 'environment'
  };
}
