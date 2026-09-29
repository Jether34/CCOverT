import { config } from '../config';
import { AppError } from '../utils/errors';

export async function verifyRecaptcha(token: string | undefined, remoteIp: string): Promise<void> {
  if (!config.recaptcha.required && !config.recaptcha.secretKey) return;
  if (!token) throw new AppError(400, 'CAPTCHA_REQUIRED', 'Complete the human verification challenge and try again');
  const body = new URLSearchParams({ secret: config.recaptcha.secretKey, response: token });
  if (remoteIp !== 'unknown') body.set('remoteip', remoteIp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body, signal: controller.signal });
    const result = await response.json() as { success?: boolean };
    if (!response.ok || !result.success) throw new AppError(400, 'CAPTCHA_FAILED', 'Human verification failed. Please try again');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'CAPTCHA_UNAVAILABLE', 'Human verification is temporarily unavailable. Please try again');
  } finally {
    clearTimeout(timeout);
  }
}
