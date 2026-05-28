import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface LockState {
  key:           string;
  reason:        string;
  lockedAt:      number;     // Unix ms
  expiresAt?:    number;     // Unix ms — auto-unlock when reached
  allowedIps?:   string[];   // IPs that bypass this lock (set at lock time)
  allowedRoles?: string[];   // roles that bypass this lock (set at lock time)
}

/**
 * Manages the in-memory registry of emergency locks.
 *
 * Single-instance: state lives in the Node.js process (survives restarts only
 * if keys are in EMERGENCY_LOCK_KEYS env var).
 * Multi-instance: extend this class and back the Map with Redis (HSET/HGETALL).
 */
@Injectable()
export class EmergencyLockService implements OnModuleInit {
  private readonly logger = new Logger(EmergencyLockService.name);
  private readonly locks = new Map<string, LockState>();

  onModuleInit(): void {
    const raw = process.env.EMERGENCY_LOCK_KEYS;
    if (!raw) return;
    for (const key of raw.split(',').map(k => k.trim()).filter(Boolean)) {
      this.lock(key, 'Startup lock via EMERGENCY_LOCK_KEYS env var');
    }
  }

  lock(
    key:           string,
    reason         = 'Emergency lock activated',
    ttlSeconds?:   number,
    allowedIps?:   string[],
    allowedRoles?: string[],
  ): LockState {
    const state: LockState = {
      key,
      reason,
      lockedAt:     Date.now(),
      expiresAt:    ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      allowedIps:   allowedIps?.length   ? allowedIps   : undefined,
      allowedRoles: allowedRoles?.length ? allowedRoles : undefined,
    };
    this.locks.set(key, state);
    this.logger.warn(
      `[EMERGENCY-LOCK] LOCKED "${key}" — ${reason}` +
      (ttlSeconds ? ` (TTL: ${ttlSeconds}s)` : ''),
    );
    return state;
  }

  unlock(key: string): boolean {
    const had = this.locks.has(key);
    this.locks.delete(key);
    if (had) this.logger.log(`[EMERGENCY-LOCK] UNLOCKED "${key}"`);
    return had;
  }

  unlockAll(): string[] {
    const keys = [...this.locks.keys()];
    this.locks.clear();
    if (keys.length) {
      this.logger.log(`[EMERGENCY-LOCK] UNLOCKED ALL — keys removed: ${keys.join(', ')}`);
    }
    return keys;
  }

  isLocked(key: string): LockState | null {
    const state = this.locks.get(key);
    if (!state) return null;
    if (state.expiresAt && Date.now() > state.expiresAt) {
      this.locks.delete(key);
      this.logger.log(`[EMERGENCY-LOCK] AUTO-UNLOCKED "${key}" (TTL expired)`);
      return null;
    }
    return state;
  }

  getAllLocks(): LockState[] {
    for (const [key, state] of this.locks) {
      if (state.expiresAt && Date.now() > state.expiresAt) {
        this.locks.delete(key);
        this.logger.log(`[EMERGENCY-LOCK] AUTO-UNLOCKED "${key}" (TTL expired)`);
      }
    }
    return [...this.locks.values()];
  }
}
