/**
 * Git bridge using isomorphic-git.
 *
 * Provides commit functionality from within Obsidian,
 * without requiring the user to have git CLI installed.
 *
 * Uses VaultFsAdapter instead of Node.js fs because Obsidian's
 * renderer process sandboxes the fs module.
 */

// @ts-ignore - isomorphic-git types are incomplete
import * as git from "isomorphic-git";
import type { Vault } from "obsidian";
import { VaultFsAdapter } from "./vault-fs-adapter";

export class GitBridge {
  private repoPath: string;
  private fs: VaultFsAdapter;

  constructor(repoPath: string, vault: Vault) {
    this.repoPath = repoPath;
    this.fs = new VaultFsAdapter(vault);
  }

  async commit(message: string): Promise<boolean> {
    if (!this.repoPath) {
      throw new Error("Git repo path not set");
    }

    const status = await git.statusMatrix({ fs: this.fs, dir: this.repoPath });
    const changes: string[] = [];
    const allFiles: string[] = [];

    for (const [filepath, headStatus, workDirStatus, stageStatus] of status) {
      allFiles.push(`${filepath} [h:${headStatus} w:${workDirStatus} s:${stageStatus}]`);
      const changed = workDirStatus !== headStatus || workDirStatus !== stageStatus;
      if (changed) {
        changes.push(`${filepath}`);
        await git.add({ fs: this.fs, dir: this.repoPath, filepath });
      }
    }

    console.log("[ConfluenceGitSync] All tracked files:", allFiles);
    console.log("[ConfluenceGitSync] Changed files:", changes.length, changes);

    if (changes.length === 0) {
      return false;
    }

    await git.commit({
      fs: this.fs,
      dir: this.repoPath,
      message,
      author: {
        name: "Confluence Git Sync",
        email: "confluence-git-sync@dial.studio",
      },
    });
    return true;
  }

  async getCurrentBranch(): Promise<string> {
    const branch = await git.currentBranch({ fs: this.fs, dir: this.repoPath });
    return branch || "main";
  }

  async getLastCommitHash(): Promise<string> {
    const log = await git.log({ fs: this.fs, dir: this.repoPath, depth: 1 });
    if (log.length === 0) throw new Error("No commits found");
    return log[0].oid;
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const status = await git.statusMatrix({ fs: this.fs, dir: this.repoPath });
    for (const [, head, workdir, stage] of status) {
      if (workdir !== head || workdir !== stage) {
        return true;
      }
    }
    return false;
  }
}
