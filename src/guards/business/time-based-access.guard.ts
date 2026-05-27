import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { AccessOutsideAllowedHoursException } from '../../exceptions/business.exception';

export interface TimeWindow {
  start: string;   // 'HH:MM' in 24h format
  end: string;     // 'HH:MM' in 24h format
  days?: number[]; // 0=Sunday ... 6=Saturday. Default: all days
}

export interface TimeAccessOptions {
  allowedWindows: TimeWindow[];
  maintenanceWindows?: TimeWindow[];
  timezone?: string;
}

/**
 * Level 5 — Time-Based Access Guard
 *
 * Restricts endpoint access to specific time windows.
 * Uses Intl.DateTimeFormat for accurate timezone-aware time comparisons
 * without any external date library.
 *
 * Also supports maintenance windows that block access regardless of allowed times.
 *
 * Usage:
 *   // Allow weekdays 9am–5pm Mexico City time:
 *   @SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
 *     allowedWindows: [{ start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] }],
 *     timezone: 'America/Mexico_City',
 *   })
 *   @UseGuards(TimeBasedAccessGuard)
 *   @Get('reports')
 *   getReports() {}
 */
@Injectable()
export class TimeBasedAccessGuard implements CanActivate {
  private readonly logger = new Logger(TimeBasedAccessGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<TimeAccessOptions>(
      GUARD_METADATA.TIME_ACCESS_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const timezone = options.timezone ?? 'UTC';
    const { hour, minute, dayOfWeek } = this.getCurrentTime(timezone);

    // Check maintenance windows first — they block regardless
    if (options.maintenanceWindows?.length) {
      for (const window of options.maintenanceWindows) {
        if (this.isInWindow(hour, minute, dayOfWeek, window)) {
          this.logger.warn(`Access blocked — maintenance window active`);
          throw new AccessOutsideAllowedHoursException();
        }
      }
    }

    // Check if current time is in any allowed window
    const isAllowed = options.allowedWindows.some((window) =>
      this.isInWindow(hour, minute, dayOfWeek, window),
    );

    if (!isAllowed) {
      this.logger.warn(`Access blocked — outside allowed hours (current: ${hour}:${minute.toString().padStart(2, '0')} ${timezone} day=${dayOfWeek})`);
      throw new AccessOutsideAllowedHoursException();
    }

    return true;
  }

  private getCurrentTime(timezone: string): { hour: number; minute: number; dayOfWeek: number } {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeek = weekdays.indexOf(weekdayStr);

    // Handle 24h format — Intl sometimes returns '24' for midnight
    return { hour: hour === 24 ? 0 : hour, minute, dayOfWeek };
  }

  private isInWindow(hour: number, minute: number, dayOfWeek: number, window: TimeWindow): boolean {
    if (window.days && window.days.length > 0 && !window.days.includes(dayOfWeek)) {
      return false;
    }

    const [startH, startM] = window.start.split(':').map(Number);
    const [endH, endM] = window.end.split(':').map(Number);

    const currentMinutes = hour * 60 + minute;
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Handle overnight windows (e.g., 22:00–06:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}
