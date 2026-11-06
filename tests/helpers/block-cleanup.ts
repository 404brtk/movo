import { constants } from "node:fs";
import { chmod, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UV_FS_O_EXLOCK = 0x10000000;

export async function blockCleanup(directory: string) {
  const blocked = process.platform === "win32" ? directory : join(directory, "locked");
  if (blocked !== directory) await mkdir(blocked);
  const path = join(blocked, "held.partial");
  await writeFile(path, "temporary job bytes");
  if (process.platform !== "win32") {
    await chmod(blocked, 0o500);
    return async () => {
      await chmod(blocked, 0o700);
    };
  }
  const file = await open(path, constants.O_RDONLY | UV_FS_O_EXLOCK);
  return () => file.close();
}
