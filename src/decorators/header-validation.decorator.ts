import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface HeaderRule {
  /** Header name — case-insensitive (normalized to lowercase internally). */
  header: string;

  /** Header must be present in the request. */
  required?: boolean;

  /** Header must NOT be present in the request. */
  forbidden?: boolean;

  /**
   * Header value must match this pattern.
   * Only evaluated when the header is present.
   * @example /^Bearer [A-Za-z0-9._-]+$/
   */
  pattern?: string | RegExp;

  /**
   * Header value must NOT match this pattern.
   * Only evaluated when the header is present.
   * @example /^\*\/\*$/  — block wildcard Accept
   */
  notPattern?: string | RegExp;
}

export interface HeaderValidationOptions {
  /**
   * Block headers injected by Playwright, Selenium, WebDriver, and similar tools.
   * These headers never appear in real browser traffic.
   * Checked headers: x-playwright-*, x-selenium-*, x-webdriver-*, x-automation,
   *                  __selenium-*, __webdriver-*, __driver-*, x-test-*
   * @default true
   */
  blockAutomationHeaders?: boolean;

  /**
   * Require Accept, Accept-Language, and Accept-Encoding to all be present.
   * Shorthand for three required rules.
   * Recommended for HTML-facing endpoints.
   * @default false
   */
  requireBrowserHeaders?: boolean;

  /**
   * Verify that Sec-CH-UA header is present and version-consistent with Chrome UA.
   *
   * Chrome 90+ sends Sec-CH-UA on every HTTPS request. Bots spoofing a
   * Chrome User-Agent typically omit it or send a stale version.
   *
   * Only triggers when the User-Agent contains Chrome/90+.
   * @default false
   */
  checkSecChUa?: boolean;

  /**
   * Flag requests where the User-Agent claims to be a browser but
   * Accept header is exactly `*\/*`.
   * Real browsers always send a detailed accept list; scrapers copy the UA
   * but leave Accept as `*\/*`.
   * @default false
   */
  checkAcceptWildcard?: boolean;

  /**
   * Minimum number of headers the request must carry.
   * Extremely sparse header sets indicate stripped-down HTTP clients.
   * A typical browser request has 8–15 headers; set to 5–6 for light enforcement.
   * @example 5
   */
  minHeaderCount?: number;

  /**
   * Custom per-endpoint header rules.
   * Evaluated after all built-in checks.
   * @example [{ header: 'x-api-version', required: true, pattern: /^v\d+$/ }]
   */
  rules?: HeaderRule[];

  /**
   * Log violations without blocking.
   * Useful for observing traffic before enabling enforcement.
   * @default false
   */
  logOnly?: boolean;
}

/**
 * Attach HeaderValidationGuard to a handler or controller.
 *
 * @example
 * // Default — automation blocklist only (safe for any endpoint)
 * @HeaderValidate()
 * @UseGuards(HeaderValidationGuard)
 * @Post('login')
 * login() {}
 *
 * @example
 * // Browser-facing endpoint — full consistency checks
 * @HeaderValidate({
 *   requireBrowserHeaders: true,
 *   checkSecChUa: true,
 *   checkAcceptWildcard: true,
 * })
 * @UseGuards(HeaderValidationGuard)
 * @Get('home')
 * home() {}
 *
 * @example
 * // Custom rule — require versioned Accept header
 * @HeaderValidate({
 *   rules: [
 *     { header: 'accept', required: true, notPattern: /^\*\/\*$/ },
 *     { header: 'x-api-version', required: true, pattern: /^v\d+$/ },
 *   ],
 * })
 * @UseGuards(HeaderValidationGuard)
 * @Get('api/data')
 * data() {}
 *
 * @example
 * // Observation mode — log without blocking
 * @HeaderValidate({ checkSecChUa: true, logOnly: true })
 * @UseGuards(HeaderValidationGuard)
 * @Get('feed')
 * feed() {}
 */
export const HeaderValidate = (options: HeaderValidationOptions = {}) =>
  SetMetadata(GUARD_METADATA.HEADER_VALIDATION_OPTIONS, options);
