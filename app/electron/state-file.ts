import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createSerializedJsonWriter() {
  let pending: Promise<void> = Promise.resolve();
  let sequence = 0;

  return (file: string, value: unknown): Promise<void> => {
    // Capture each version before another handler can mutate the shared state.
    const contents = JSON.stringify(value, null, 2);
    const temporary = `${file}.${process.pid}.${++sequence}.tmp`;
    const write = pending.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      try {
        await writeFile(temporary, contents);
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });

    // A failed write must not prevent later state changes from being saved.
    pending = write.catch(() => {});
    return write;
  };
}
