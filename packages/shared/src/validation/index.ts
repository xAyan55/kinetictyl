import { z } from 'zod';

export const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, {
    message: "Username must be 3-32 characters long and contain only letters, numbers, and underscores."
  }),
  email: z.string().email({ message: "Invalid email address format." }),
  password: z.string().min(8, { message: "Password must be at least 8 characters long." }),
  confirmPassword: z.string().min(8)
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"]
});

export const LoginSchema = z.object({
  identity: z.string().min(1, { message: "Username or Email is required." }),
  password: z.string().min(1, { message: "Password is required." }),
  remember: z.boolean().optional()
});

export const CreateServerSchema = z.object({
  name: z.string().min(3).max(64),
  ownerId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  type: z.string().min(1),
  version: z.string().min(1),
  buildUuid: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
  ramLimitMB: z.number().int().min(512),
  diskLimitMB: z.number().int().min(1024),
  cpuLimitPct: z.number().int().min(10).max(800),
  javaOverride: z.string().optional()
});

export const FileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

export const FileDeleteSchema = z.object({
  path: z.string().min(1)
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateServerInput = z.infer<typeof CreateServerSchema>;
export type FileWriteInput = z.infer<typeof FileWriteSchema>;
export type FileDeleteInput = z.infer<typeof FileDeleteSchema>;
