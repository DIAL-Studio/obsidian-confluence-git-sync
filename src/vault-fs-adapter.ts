/**
 * File-system adapter for isomorphic-git that reads/writes via Obsidian's
 * Vault adapter instead of Node.js fs (which is sandboxed and unreliable
 * in Obsidian's renderer process).
 *
 * Based on obsidian-git's MyAdapter.
 */

import type { DataAdapter, Vault } from "obsidian";

export class VaultFsAdapter {
  private adapter: DataAdapter;

  constructor(vault: Vault) {
    this.adapter = vault.adapter;
  }

  async readFile(path: string, opts?: any): Promise<string | ArrayBuffer> {
    if (opts === "utf8" || opts?.encoding === "utf8") {
      return this.adapter.read(normalize(path));
    }
    return this.adapter.readBinary(normalize(path));
  }

  async writeFile(
    path: string,
    data: string | ArrayBuffer | ArrayBufferView
  ): Promise<void> {
    const normalized = normalize(path);
    if (typeof data === "string") {
      await this.adapter.write(normalized, data);
    } else {
      const buf = toArrayBuffer(data);
      await this.adapter.writeBinary(normalized, buf);
    }
  }

  async readdir(path: string): Promise<string[]> {
    const res = await this.adapter.list(normalize(path));
    return [...res.files, ...res.folders];
  }

  async mkdir(path: string): Promise<void> {
    await this.adapter.mkdir(normalize(path));
  }

  async rmdir(path: string): Promise<void> {
    await this.adapter.rmdir(normalize(path), true);
  }

  async stat(path: string): Promise<any> {
    const normalized = normalize(path);
    try {
      const s = await this.adapter.stat(normalized);
      if (s) {
        return {
          type: s.type === "folder" ? "directory" : "file",
          mode: s.type === "folder" ? 0o755 : 0o644,
          size: s.size ?? 0,
          mtimeMs: s.mtime ?? 0,
          ctimeMs: s.ctime ?? 0,
          isFile: () => s.type === "file",
          isDirectory: () => s.type === "folder",
          isSymbolicLink: () => false,
        };
      }
    } catch (_) {
      // stat failed — but root directory always exists
    }

    // Fallback for root "/" or any path where stat returns nothing
    return {
      type: "directory",
      mode: 0o755,
      size: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
  }

  async unlink(path: string): Promise<void> {
    await this.adapter.remove(normalize(path));
  }

  async lstat(path: string): Promise<any> {
    return this.stat(path);
  }

  async readlink(_path: string): Promise<string> {
    throw new Error("readlink not implemented");
  }

  async symlink(_path: string): Promise<void> {
    throw new Error("symlink not implemented");
  }
}

function normalize(filepath: string): string {
  return filepath === "." ? "/" : filepath.startsWith("/") ? filepath : `/${filepath}`;
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
  ) {
    return data.buffer;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
    .buffer;
}
