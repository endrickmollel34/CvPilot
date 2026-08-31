import type { ConfigService } from '@nestjs/config';

/**
 * Reads a genuinely-optional third-party API key — one whose absence must
 * never prevent the app from booting (unlike `config.getOrThrow`, used for
 * required keys like OPENAI_API_KEY).
 *
 * Returns undefined for both an unset/empty value AND an obvious local-dev
 * placeholder (e.g. "sk-ant-placeholder-dev-only") — both mean "not
 * configured," never "configured with a broken value" that should be
 * handed to a real SDK client. Mirrors the existing placeholder-detection
 * convention already used for required keys elsewhere (e.g.
 * StripePaymentProvider, CvService's CLOUDFLARE_R2_* checks).
 */
export function resolveOptionalApiKey(config: ConfigService, key: string): string | undefined {
  const value = config.get<string>(key);
  if (!value || value.trim() === '' || value.includes('placeholder')) {
    return undefined;
  }
  return value;
}
