import os from 'node:os';
import path from 'node:path';

/**
 * Runs before any application module is imported. The API reads configuration
 * once at import time, so these values must be set here rather than at the top
 * of a test file, where a static import would already have been evaluated.
 */
process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-123456';
process.env.MODEL_SERVICE_TOKEN = 'test-service-token-0123456789abcdef';
/** No model service is listening here: every prediction must be refused. */
process.env.MODEL_SERVICE_URL = 'http://127.0.0.1:65534';
/** Stored upload bytes must never land in the repository during a test run. */
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'ccovert-api-test-uploads');

/**
 * Pinned last so a developer's local `.env` cannot change test behaviour: the
 * config loader walks up and finds the repository `.env`, which enables the demo
 * profile and could point mail and provider calls at real services.
 */
process.env.ALLOW_DEMO_PROFILE = 'false';
process.env.MODEL_ALLOW_DEMO_PROFILE = 'false';
process.env.AI_PROVIDER = 'disabled';
process.env.ENVIRONMENTAL_PROVIDER = 'disabled';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.DEV_VERIFICATION_ENABLED = 'true';
process.env.LOGIN_OTP_ENABLED = 'false';
process.env.RECAPTCHA_REQUIRED = 'false';
process.env.RECAPTCHA_SECRET_KEY = '';
