import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config, mailCatcherConfigured, smtpConfigured } from '../config';
import { logger } from '../logger';
import { notConfigured } from '../utils/errors';
import { callUpstream } from './modelClient';
import { effectiveSmtp } from './smtpSettings';

export type MailDelivery = 'sent' | 'development-only' | 'mail-catcher';

const smtpTransport = (smtp: Awaited<ReturnType<typeof effectiveSmtp>>): Transporter =>
  nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.port === 587,
    auth: { user: smtp.user, pass: smtp.pass }
  });

const send = async (options: { to: string; subject: string; text: string }): Promise<MailDelivery> => {
  const smtp = await effectiveSmtp();
  if (smtp.source === 'database' || smtpConfigured) {
    await smtpTransport(smtp).sendMail({ from: smtp.from, to: options.to, subject: options.subject, text: options.text });
    return 'sent';
  }
  if (mailCatcherConfigured) {
    const result = await callUpstream({
      url: `${config.mailCatcher.baseUrl.replace(/\/+$/, '')}/api/v1/send`,
      method: 'POST',
      body: { From: { Address: config.smtp.from || 'ccover-t@example.test' }, To: [{ Address: options.to }], Subject: options.subject, Text: options.text },
      timeoutMs: 5000,
      label: 'Mail catcher'
    });
    if (!result.ok) {
      throw notConfigured('VERIFICATION_UNAVAILABLE', 'The local mail catcher did not accept the message');
    }
    return 'mail-catcher';
  }
  if (!config.devVerificationEnabled || config.isProduction) {
    throw notConfigured('VERIFICATION_UNAVAILABLE', 'Email delivery is not configured on this server');
  }
  return 'development-only';
};

export const sendVerificationEmail = (email: string, verificationUrl: string): Promise<MailDelivery> =>
  send({
    to: email,
    subject: 'Verify your CCOverT account',
    text: [
      'Verify your CCOverT account using this link:',
      verificationUrl,
      '',
      'This single-use link expires in 24 hours.',
      'If you did not request this, you can ignore this message.'
    ].join('\n')
  });

export const sendPasswordResetEmail = (email: string, resetUrl: string): Promise<MailDelivery> =>
  send({
    to: email,
    subject: 'Reset your CCOverT password',
    text: [
      'Reset your CCOverT password using this link:',
      resetUrl,
      '',
      'This single-use link expires in 60 minutes.',
      'If you did not request this, no action is needed and your password stays unchanged.'
    ].join('\n')
  });

/** Best-effort notification: never fails the user-facing action. */
export const notifySilently = async (label: string, task: () => Promise<unknown>): Promise<void> => {
  try {
    await task();
  } catch (error) {
    logger.warn('Notification delivery failed', { label, error: error instanceof Error ? error.message : 'unknown' });
  }
};
