import { Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/client.js';
import { CONFIG } from '../config/index.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { RegisterSchema, LoginSchema, UserRole } from '@kinetictyl/shared';

export async function registerController(req: AuthenticatedRequest, res: Response) {
  try {
    const parseResult = RegisterSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, errors: parseResult.error.errors });
    }

    const { username, email, password } = parseResult.data;

    // Check if registration is allowed
    const userCount = await prisma.user.count();
    if (userCount > 0 && !CONFIG.ALLOW_REGISTRATION) {
      return res.status(403).json({ success: false, error: "Public registration is currently disabled." });
    }

    // Check duplicates
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] }
    });
    if (existing) {
      return res.status(409).json({ success: false, error: "Username or email is already registered." });
    }

    // First account registered receives ADMIN role
    const role = userCount === 0 ? UserRole.ADMIN : UserRole.USER;
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { username, email, passwordHash, role }
    });

    const token = jwt.sign({ userId: user.id }, CONFIG.APP_SECRET, { expiresIn: '7d' });

    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(201).json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function loginController(req: AuthenticatedRequest, res: Response) {
  try {
    const parseResult = LoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, errors: parseResult.error.errors });
    }

    const { identity, password } = parseResult.data;

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identity }, { email: identity }] }
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, error: "Invalid credentials." });
    }

    const token = jwt.sign({ userId: user.id }, CONFIG.APP_SECRET, { expiresIn: '7d' });

    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function logoutController(req: AuthenticatedRequest, res: Response) {
  res.clearCookie('session');
  return res.json({ success: true, message: "Logged out successfully." });
}

export async function meController(req: AuthenticatedRequest, res: Response) {
  return res.json({ success: true, user: req.user });
}
