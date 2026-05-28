import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { HeaderValidationOptions, HeaderRule } from '../../decorators/header-validation.decorator';
import { InvalidHeaderException, MissingRequiredHeaderException } from '../../exceptions/security.exception';

// ── Automation-tool header patterns ───────────────────────────────────────────
// Headers injected by test frameworks that never appear in legitimate traffic.
const AUTOMATION_HEADER_PATTERNS: RegExp[] = [
  /^x-playwright/,
  /^x-selenium/,
  /^x-webdriver/,
  /^x-automation$/,
  /^__selenium/,
  /^__webdriver/,
  /^__driver/,
  /^x-test-/,
];

// ── Internal types ─────────────────────────────────────────────────────────────

type ViolationType = 'missing' | 'forbidden' | 'invalid';

interface Violation {
  header:  string;
  reason:  string;
  type:    ViolationType;
}

/**
 * Level 2 — Header Validation Guard
 *
 * Deterministic header validator — hard fails on any violation.
 * Different from BotDetectionGuard (which scores probabilistically):
 * this guard enforces explicit rules and browser consistency checks that
 * bots almost universally fail.
 *
 * ── What it checks ────────────────────────────────────────────────────────────
 *
 *  1. Automation header blocklist (default: on)
 *     Headers injected by Playwright, Selenium, and other test frameworks.
 *     Real users never send these.
 *
 *  2. sec-ch-ua consistency (opt-in: checkSecChUa)
 *     Chrome 90+ automatically sends Sec-CH-UA with a version that matches
 *     the User-Agent. Bots that spoof a Chrome UA omit it or send wrong versions.
 *
 *     UA: Mozilla/5.0 … Chrome/124 …
 *     Expected: Sec-CH-UA: "Chromium";v="124", "Google Chrome";v="124", …
 *
 *  3. Accept wildcard check (opt-in: checkAcceptWildcard)
 *     Browsers always send detailed Accept headers. A request with a browser
 *     UA but sends a wildcard-only Accept header — real browsers never do this.
 *
 *  4. Browser required headers (opt-in: requireBrowserHeaders)
 *     Accept, Accept-Language, Accept-Encoding must all be present.
 *     Shorthand for adding three required rules manually.
 *
 *  5. Minimum header count (opt-in: minHeaderCount)
 *     Very sparse header sets (< N) indicate stripped-down HTTP clients.
 *
 *  6. Custom rules (opt-in: rules)
 *     Per-endpoint header requirements with optional regex validation.
 *
 * ── Differences from BotDetectionGuard ───────────────────────────────────────
 *
 *   BotDetectionGuard:  scoring model, probabilistic, threshold-based
 *   HeaderValidationGuard: deterministic, any violation = block (or logOnly)
 *
 * ── Both together ─────────────────────────────────────────────────────────────
 *
 *   @HeaderValidate({ checkSecChUa: true, requireBrowserHeaders: true })
 *   @SetMetadata(GUARD_METADATA.BOT_OPTIONS, { threshold: 60 })
 *   @UseGuards(HeaderValidationGuard, BotDetectionGuard)
 *   @Post('register')
 *   register() {}
 *
 * Usage:
 *   // Automation blocklist only (good default)
 *   @HeaderValidate()
 *   @UseGuards(HeaderValidationGuard)
 *   @Post('login')
 *   login() {}
 *
 *   // Browser-facing endpoint — full consistency checks
 *   @HeaderValidate({ checkSecChUa: true, requireBrowserHeaders: true, checkAcceptWildcard: true })
 *   @UseGuards(HeaderValidationGuard)
 *   @Get('page')
 *   page() {}
 *
 *   // API — require specific headers and block wildcard Accept
 *   @HeaderValidate({
 *     rules: [
 *       { header: 'x-api-version', required: true, pattern: /^v\d+$/ },
 *       { header: 'accept', required: true, notPattern: /^\*\/\*$/ },
 *     ],
 *   })
 *   @UseGuards(HeaderValidationGuard)
 *   @Get('data')
 *   data() {}
 */
@Injectable()
export class HeaderValidationGuard implements CanActivate {
  private readonly logger = new Logger(HeaderValidationGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<HeaderValidationOptions | undefined>(
      GUARD_METADATA.HEADER_VALIDATION_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    // No decorator → guard is a no-op (safe default)
    if (!options) return true;

    const request  = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const violations: Violation[] = [];

    // ── 1. Automation header blocklist ──────────────────────────────────────
    if (options.blockAutomationHeaders !== false) {
      this.checkAutomationHeaders(request, violations);
    }

    // ── 2. Minimum header count ──────────────────────────────────────────────
    if (options.minHeaderCount !== undefined) {
      const count = Object.keys(request.headers).length;
      if (count < options.minHeaderCount) {
        violations.push({
          header: '(headers)',
          reason: `only ${count} headers present, minimum is ${options.minHeaderCount}`,
          type:   'missing',
        });
      }
    }

    // ── 3. requireBrowserHeaders shorthand ───────────────────────────────────
    if (options.requireBrowserHeaders) {
      for (const h of ['accept', 'accept-language', 'accept-encoding'] as const) {
        if (!request.headers[h]) {
          violations.push({
            header: h,
            reason: 'required browser header missing',
            type:   'missing',
          });
        }
      }
    }

    // ── 4. Custom rules ───────────────────────────────────────────────────────
    if (options.rules?.length) {
      this.checkRules(request, options.rules, violations);
    }

    // ── 5. sec-ch-ua consistency ─────────────────────────────────────────────
    if (options.checkSecChUa) {
      this.checkSecChUa(request, violations);
    }

    // ── 6. Accept wildcard check ─────────────────────────────────────────────
    if (options.checkAcceptWildcard) {
      this.checkAcceptWildcard(request, violations);
    }

    // ── Outcome ───────────────────────────────────────────────────────────────
    if (violations.length === 0) return true;

    const summary = violations.map((v) => `${v.header}:${v.type}`).join(', ');
    this.logger.warn(
      `HeaderValidation — ${violations.length} violation(s) [${summary}]` +
        ` — ${request.method} ${request.url}`,
    );

    // Expose violations in response header for debugging (redact in prod if needed)
    response.setHeader('X-Header-Violations', String(violations.length));

    if (options.logOnly) return true;

    // Throw on the first (most important) violation
    const first = violations[0];
    if (first.type === 'missing') {
      throw new MissingRequiredHeaderException(first.header);
    }
    throw new InvalidHeaderException(first.header, first.reason);
  }

  // ── Checkers ────────────────────────────────────────────────────────────────

  private checkAutomationHeaders(request: Request, violations: Violation[]): void {
    for (const name of Object.keys(request.headers)) {
      const lower = name.toLowerCase();
      if (AUTOMATION_HEADER_PATTERNS.some((p) => p.test(lower))) {
        violations.push({
          header: name,
          reason: 'automation/testing framework header detected',
          type:   'forbidden',
        });
      }
    }
  }

  private checkRules(request: Request, rules: HeaderRule[], violations: Violation[]): void {
    for (const rule of rules) {
      const raw   = request.headers[rule.header.toLowerCase()];
      const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '');
      const present = raw !== undefined;

      if (rule.required && !present) {
        violations.push({ header: rule.header, reason: 'required header missing', type: 'missing' });
        continue;
      }

      if (rule.forbidden && present) {
        violations.push({ header: rule.header, reason: 'forbidden header present', type: 'forbidden' });
        continue;
      }

      if (present && rule.pattern) {
        const re = typeof rule.pattern === 'string' ? new RegExp(rule.pattern) : rule.pattern;
        if (!re.test(value)) {
          violations.push({
            header: rule.header,
            reason: `value '${value.slice(0, 60)}' does not match required pattern ${re}`,
            type:   'invalid',
          });
        }
      }

      if (present && rule.notPattern) {
        const re = typeof rule.notPattern === 'string' ? new RegExp(rule.notPattern) : rule.notPattern;
        if (re.test(value)) {
          violations.push({
            header: rule.header,
            reason: `value matches forbidden pattern ${re}`,
            type:   'invalid',
          });
        }
      }
    }
  }

  /**
   * Verify Sec-CH-UA header is present and version-consistent with Chrome UA.
   *
   * Chrome 90+ sends Sec-CH-UA on every HTTPS request. The version token
   * inside matches the Chrome version in the User-Agent string:
   *   UA:         Chrome/124.0.0.0
   *   Sec-CH-UA:  "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"
   *
   * Bots spoofing Chrome UA typically:
   *   a) Don't send Sec-CH-UA at all
   *   b) Send a static/wrong version (copied from a blog post, etc.)
   */
  private checkSecChUa(request: Request, violations: Violation[]): void {
    const ua = request.headers['user-agent'] ?? '';

    // Only applies to Chrome/Chromium UAs — Edge sends Edg/ but also sends sec-ch-ua
    const chromeMatch = ua.match(/Chrome\/(\d+)/);
    if (!chromeMatch) return;

    const chromeMajor = parseInt(chromeMatch[1], 10);
    if (chromeMajor < 90) return; // Sec-CH-UA was added in Chrome 89 / shipped in 90

    const secChUa = request.headers['sec-ch-ua'] as string | undefined;

    // Check A: missing sec-ch-ua entirely
    if (!secChUa) {
      violations.push({
        header: 'sec-ch-ua',
        reason: `UA claims Chrome/${chromeMajor} but Sec-CH-UA header is absent — likely spoofed UA`,
        type:   'forbidden',
      });
      return;
    }

    // Check B: version alignment
    // Extract version numbers from sec-ch-ua, ignoring the "Not-A.Brand" placeholder (v=99 or v=8 etc.)
    const versions = Array.from(secChUa.matchAll(/v="(\d+)"/g))
      .map((m) => parseInt(m[1], 10))
      .filter((v) => v !== 99 && v > 20); // filter placeholder versions

    if (versions.length > 0 && !versions.includes(chromeMajor)) {
      violations.push({
        header: 'sec-ch-ua',
        reason:
          `Sec-CH-UA versions [${versions.join(', ')}] don't match Chrome/${chromeMajor} in UA — version mismatch`,
        type:   'invalid',
      });
    }
  }

  /**
   * Flag browser UAs with a wildcard-only Accept header — real browsers always send
   * a detailed Accept header; scrapers often copy the UA but not the Accept.
   */
  private checkAcceptWildcard(request: Request, violations: Violation[]): void {
    const ua     = request.headers['user-agent'] ?? '';
    const accept = (request.headers['accept'] as string | undefined ?? '').trim();

    // Only relevant when the client claims to be a browser
    const looksLikeBrowser = /Mozilla|Chrome|Firefox|Safari|Edg\//.test(ua);
    if (!looksLikeBrowser) return;

    if (accept === '*/*') {
      violations.push({
        header: 'accept',
        reason: 'browser UA with Accept: */* — real browsers always send specific accept types',
        type:   'invalid',
      });
    }
  }
}
