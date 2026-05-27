import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import '../interfaces/security-context.interface'; // ensure module augmentation is loaded

@Injectable()
export class IpExtractorService {
  /**
   * Returns the real client IP.
   * If SecurityContextMiddleware already ran, reads from request.securityContext.ip
   * to avoid re-parsing headers on every guard that calls this method.
   */
  getClientIp(request: Request): string {
    // Read from context if already computed by SecurityContextMiddleware
    if (request.securityContext?.ip) return request.securityContext.ip;

    const xForwardedFor = request.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
      return xForwardedFor.split(',')[0].trim();
    }
    const xRealIp = request.headers['x-real-ip'];
    if (typeof xRealIp === 'string') {
      return xRealIp.trim();
    }
    return (request.socket?.remoteAddress ?? request.ip ?? 'unknown').replace(
      /^::ffff:/,
      '',
    );
  }

  // Check if IPv4 address is in a CIDR range (e.g., 192.168.0.0/24)
  isIpInCidr(ip: string, cidr: string): boolean {
    if (!cidr.includes('/')) return ip === cidr;

    const [subnet, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);

    if (isNaN(bits) || bits < 0 || bits > 32) return false;

    try {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      const ipNum = this.ipToInt(ip);
      const subnetNum = this.ipToInt(subnet);
      return (ipNum & mask) === (subnetNum & mask);
    } catch {
      return false;
    }
  }

  private ipToInt(ip: string): number {
    const parts = ip.split('.');
    if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);
    return parts.reduce((acc, octet) => {
      const n = parseInt(octet, 10);
      if (isNaN(n) || n < 0 || n > 255) throw new Error(`Invalid octet: ${octet}`);
      return (acc << 8) | n;
    }, 0) >>> 0;
  }

  isValidIp(ip: string): boolean {
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4.test(ip) || ipv6.test(ip);
  }

  getSubnet(ip: string, prefixLength: number = 24): string {
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    if (prefixLength >= 24) return parts.slice(0, 3).join('.');
    if (prefixLength >= 16) return parts.slice(0, 2).join('.');
    return parts[0];
  }
}
