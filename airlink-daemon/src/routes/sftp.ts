import { generateCredential, getActiveSessionCount, revokeCredentialForServer } from '../handlers/sftp';
import logger from '../logger';
import { validateContainerId } from '../validation';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleSftpCreate(req: Request): Promise<Response> {
  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id || typeof body.id !== 'string') return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(body.id)) return json({ error: 'invalid server ID format' }, 400);

  try {
    const cred = await generateCredential(body.id);
    return json({
      username: cred.username,
      password: cred.password,
      host: cred.host,
      port: cred.port,
      expiresAt: cred.expiresAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to generate SFTP credentials';
    logger.error(`SFTP credential generation failed for ${body.id}`, err);
    return json({ error: msg }, 500);
  }
}

export async function handleSftpRevoke(req: Request): Promise<Response> {
  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id || typeof body.id !== 'string') return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(body.id)) return json({ error: 'invalid server ID format' }, 400);

  try {
    revokeCredentialForServer(body.id);
    return json({ message: 'SFTP credentials revoked' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to revoke SFTP credentials';
    logger.error(`SFTP credential revocation failed for ${body.id}`, err);
    return json({ error: msg }, 500);
  }
}

export function handleSftpStatus(_req: Request): Response {
  return json({ activeSessions: getActiveSessionCount() });
}

