import { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export class RateLimiterService {
  private static userCache = new Map<string, { count: number; resetTime: number }>();
  private static ipCache = new Map<string, { count: number; resetTime: number }>();

  static checkLimit(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const cached = this.userCache.get(key);

    if (!cached || now > cached.resetTime) {
      const resetTime = now + config.windowMs;
      this.userCache.set(key, { count: 1, resetTime });
      return { allowed: true, remaining: config.max - 1, resetTime };
    }

    if (cached.count >= config.max) {
      return { allowed: false, remaining: 0, resetTime: cached.resetTime };
    }

    cached.count++;
    return { allowed: true, remaining: config.max - cached.count, resetTime: cached.resetTime };
  }

  static checkIpLimit(ip: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const cached = this.ipCache.get(ip);

    if (!cached || now > cached.resetTime) {
      const resetTime = now + config.windowMs;
      this.ipCache.set(ip, { count: 1, resetTime });
      return { allowed: true, remaining: config.max - 1, resetTime };
    }

    if (cached.count >= config.max) {
      return { allowed: false, remaining: 0, resetTime: cached.resetTime };
    }

    cached.count++;
    return { allowed: true, remaining: config.max - cached.count, resetTime: cached.resetTime };
  }

  static middleware(config: RateLimitConfig, limitByIpOnly = false) {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = (req.ip || req.headers['x-forwarded-for'] || '').toString();
      const userId = req.session?.user?.id?.toString();

      // Check IP Limit first
      const ipCheck = this.checkIpLimit(ip, config);
      if (!ipCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: 'Too many requests from this IP. Please try again later.',
          resetTime: ipCheck.resetTime
        });
      }

      // Check User Limit if user is authenticated
      if (!limitByIpOnly && userId) {
        const userCheck = this.checkLimit(userId, config);
        if (!userCheck.allowed) {
          return res.status(429).json({
            success: false,
            error: 'Too many requests. Please try again later.',
            resetTime: userCheck.resetTime
          });
        }
      }

      next();
    };
  }

  static clearCaches(): void {
    this.userCache.clear();
    this.ipCache.clear();
  }
}
