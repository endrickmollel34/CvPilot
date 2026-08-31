import Link from 'next/link';

interface Props {
  message: string;
  quota: boolean;
}

/**
 * Renders an error message and, only for a genuine plan/quota restriction
 * (see isQuotaError in lib/apiError.ts — HTTP 403 plus the backend's
 * "Upgrade your plan" marker), an inline link to the existing pricing
 * section. Never shown for network failures, AI-provider failures, parsing
 * failures, validation errors, or other server errors.
 *
 * Intentionally unstyled beyond the link itself, so it drops into whatever
 * error container a workspace already has (a boxed banner or a plain
 * paragraph) without changing that container's design.
 */
export function ActionableError({ message, quota }: Props) {
  return (
    <>
      {message}
      {quota && (
        <>
          {' '}
          <Link href="/#pricing" className="font-semibold underline hover:no-underline">
            Upgrade plan
          </Link>
        </>
      )}
    </>
  );
}
