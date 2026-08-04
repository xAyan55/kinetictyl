import { resolve, normalize, relative } from 'node:path';
import { createReadStream, createWriteStream, mkdirSync, existsSync } from 'node:fs';
import yauzl from 'yauzl';

/**
 * Validates that a target path resides strictly inside the root server directory.
 * Throws an Error if path traversal is attempted.
 */
export function validatePath(serverRootDir: string, targetPath: string): string {
  const canonicalRoot = resolve(normalize(serverRootDir));
  const canonicalTarget = resolve(normalize(targetPath));
  
  const rel = relative(canonicalRoot, canonicalTarget);
  
  const isEscaping = rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\');
  if (isEscaping) {
    throw new Error(`SECURITY_VIOLATION: Path traversal detected outside server root boundary.`);
  }
  return canonicalTarget;
}

/**
 * Unzips an archive entry-by-entry while applying strict Zip-slip protection.
 */
export function unzipWithGuard(zipFilePath: string, destDir: string): Promise<void> {
  return new Promise((res, rej) => {
    const validatedDest = validatePath(destDir, destDir);
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return rej(err || new Error("Failed to open zip archive."));
      
      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        try {
          const entryDest = validatePath(validatedDest, `${validatedDest}/${entry.fileName}`);
          
          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            mkdirSync(entryDest, { recursive: true });
            zipfile.readEntry();
          } else {
            // File entry
            const parentDir = resolve(entryDest, '..');
            if (!existsSync(parentDir)) {
              mkdirSync(parentDir, { recursive: true });
            }
            
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) return rej(streamErr);
              const writeStream = createWriteStream(entryDest);
              readStream.pipe(writeStream);
              writeStream.on('finish', () => zipfile.readEntry());
              writeStream.on('error', rej);
            });
          }
        } catch (validationErr) {
          rej(validationErr);
        }
      });

      zipfile.on('end', () => res());
      zipfile.on('error', rej);
    });
  });
}
