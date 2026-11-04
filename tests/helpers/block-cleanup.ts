import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$path = [Console]::In.ReadLine(); $file = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None); [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $file.Dispose()",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let closed = false;
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  const release = async () => {
    if (!closed) child.stdin.end("\n");
    await exited;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("LOCKED")) resolve();
      });
      child.once("error", reject);
      child.stderr.on("data", (chunk: Buffer) => reject(new Error(chunk.toString())));
      timer = setTimeout(() => reject(new Error("File lock fixture timed out.")), 5000);
      child.stdin.write(`${path}\n`);
    });
    return release;
  } catch (cause) {
    child.kill();
    await exited;
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
