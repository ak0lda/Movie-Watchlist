import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

/** Writes via a temp file and rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, filePath);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  );
}
