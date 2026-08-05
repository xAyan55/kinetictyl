import { existsSync, readFileSync, statSync } from 'fs';
import { basename, resolve } from 'path';
import {
  appendFileContent,
  compressArchive,
  createEmptyFile,
  extractArchive,
  getSandboxedPath,
  listDirectory,
  makeDirectory,
  readFileContent,
  removeItem,
  renameItem,
  writeFileContent,
} from '../handlers/fs.js';
import logger from '../logger.js';
import { validateContainerId } from '../validation.js';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleFsList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const path = url.searchParams.get('path') || '';
  if (!id || !validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  try {
    const files = listDirectory(id, path);
    return json({ files, contents: files });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'failed to list directory' }, 400);
  }
}

export async function handleFsSize(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);
  return json({ size: 0 });
}

export async function handleFsInfo(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const path = url.searchParams.get('path') || '';
  if (!id || !validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  try {
    const full = getSandboxedPath(id, path);
    const st = statSync(full);
    return json({
      name: basename(full),
      size: st.size,
      isDir: st.isDirectory(),
      updatedAt: st.mtime,
    });
  } catch {
    return json({ error: 'file not found' }, 404);
  }
}

export async function handleFsFileRead(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const path = url.searchParams.get('path') || '';
  if (!id || !validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  try {
    const content = readFileContent(id, path);
    return new Response(content, { headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'file read error' }, 400);
  }
}

export async function handleFsFileWrite(req: Request): Promise<Response> {
  let body: { id?: string; path?: string; content?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, path, content = '' } = body;
  if (!id || !validateContainerId(id) || !path) return json({ error: 'invalid request' }, 400);

  try {
    writeFileContent(id, path, content);
    return json({ message: 'file written successfully' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'file write error' }, 400);
  }
}

export function handleFsDownload(req: Request): Response {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const path = url.searchParams.get('path') || '';
  if (!id || !validateContainerId(id) || !path) return json({ error: 'invalid request' }, 400);

  try {
    const full = getSandboxedPath(id, path);
    if (!existsSync(full)) return json({ error: 'file not found' }, 404);
    const filename = basename(full);
    const content = readFileSync(full);
    return new Response(content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return json({ error: 'download failed' }, 400);
  }
}

export async function handleFsRm(req: Request): Promise<Response> {
  let body: { id?: string; path?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, path } = body;
  if (!id || !validateContainerId(id) || !path) return json({ error: 'invalid request' }, 400);

  try {
    removeItem(id, path);
    return json({ message: 'item deleted successfully' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delete error' }, 400);
  }
}

export async function handleFsZip(req: Request): Promise<Response> {
  let body: { id?: string; files?: string[]; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, files = [], name = 'archive.tar.gz' } = body;
  if (!id || !validateContainerId(id)) return json({ error: 'invalid request' }, 400);

  try {
    await compressArchive(id, files, name);
    return json({ message: 'archive created successfully' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'zip error' }, 400);
  }
}

export async function handleFsUnzip(req: Request): Promise<Response> {
  let body: { id?: string; file?: string; destination?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, file, destination = '' } = body;
  if (!id || !validateContainerId(id) || !file) return json({ error: 'invalid request' }, 400);

  try {
    await extractArchive(id, file, destination);
    return json({ message: 'archive extracted successfully' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unzip error' }, 400);
  }
}

export async function handleFsMkdir(req: Request): Promise<Response> {
  let body: { id?: string; name?: string; path?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, name, path = '' } = body;
  if (!id || !validateContainerId(id) || !name) return json({ error: 'invalid request' }, 400);

  try {
    makeDirectory(id, `${path}/${name}`);
    return json({ message: 'directory created successfully' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'mkdir error' }, 400);
  }
}

export async function handleFsRename(req: Request): Promise<Response> {
  let body: { id?: string; from?: string; to?: string; path?: string; newName?: string; newPath?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id } = body;
  const fromPath = body.from || body.path;
  const toPath = body.to || body.newPath || body.newName;
  if (!id || !validateContainerId(id) || !fromPath || !toPath) return json({ error: 'invalid request' }, 400);

  try {
    renameItem(id, fromPath, toPath);
    return json({ message: 'item renamed successfully' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'rename error' }, 400);
  }
}

export async function handleFsUpload(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let id = url.searchParams.get('id');
  let path = url.searchParams.get('path') || '';
  let fileName = url.searchParams.get('fileName') || '';
  let contentBuffer: Buffer | null = null;

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = (await req.json()) as { id?: string; path?: string; fileName?: string; fileContent?: string };
      if (body.id) id = body.id;
      if (body.path) path = body.path;
      if (body.fileName) fileName = body.fileName;
      if (body.fileContent) {
        const raw = body.fileContent.includes(';base64,')
          ? body.fileContent.split(';base64,')[1]
          : body.fileContent;
        contentBuffer = Buffer.from(raw, 'base64');
      }
    } catch {}
  } else {
    contentBuffer = Buffer.from(await req.arrayBuffer());
  }

  if (!id || !validateContainerId(id)) return json({ error: 'invalid request' }, 400);

  try {
    const targetPath = fileName ? (path.endsWith('/') ? `${path}${fileName}` : `${path}/${fileName}`) : path;
    writeFileContent(id, targetPath, contentBuffer ? contentBuffer : Buffer.from(''));
    return json({ message: 'upload successful', fileName, path: targetPath });
  } catch (err) {
    return json({ error: 'upload failed' }, 400);
  }
}

export async function handleFsCreateEmpty(req: Request): Promise<Response> {
  let body: { id?: string; path?: string; fileName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, path = '', fileName = '' } = body;
  if (!id || !validateContainerId(id)) return json({ error: 'invalid request' }, 400);

  try {
    const targetPath = fileName ? (path.endsWith('/') ? `${path}${fileName}` : `${path}/${fileName}`) : path;
    createEmptyFile(id, targetPath);
    return json({ message: 'file created successfully' });
  } catch (err) {
    return json({ error: 'create file failed' }, 400);
  }
}

export async function handleFsAppend(req: Request): Promise<Response> {
  let body: { id?: string; path?: string; fileName?: string; content?: string; fileContent?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const { id, path = '', fileName = '' } = body;
  let rawContent = body.content || body.fileContent || '';
  if (rawContent.includes(';base64,')) {
    rawContent = Buffer.from(rawContent.split(';base64,')[1], 'base64').toString('utf8');
  }
  if (!id || !validateContainerId(id)) return json({ error: 'invalid request' }, 400);

  try {
    const targetPath = fileName ? (path.endsWith('/') ? `${path}${fileName}` : `${path}/${fileName}`) : path;
    appendFileContent(id, targetPath, rawContent);
    return json({ message: 'content appended successfully' });
  } catch (err) {
    return json({ error: 'append file failed' }, 400);
  }
}
