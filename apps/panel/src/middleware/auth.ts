import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/client.js';
import { CONFIG } from '../config/index.js';
import { UserRole } from '@kinetictyl/shared';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
    role: string;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.session || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Session token required.' });
  }

  try {
    const decoded = jwt.verify(token, CONFIG.APP_SECRET) as { userId: number };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, username: true, email: true, role: true }
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: User no longer exists.' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Invalid or expired session.' });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== UserRole.ADMIN) {
    return res.status(403).json({ success: false, error: 'FORBIDDEN: Admin role required.' });
  }
  next();
}
