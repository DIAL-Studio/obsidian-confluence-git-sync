/**
 * Git bridge using isomorphic-git.
 *
 * Provides commit and push functionality from within Obsidian,
 * without requiring the user to have git CLI installed.
 */

// @ts-ignore - isomorphic-git types are incomplete
import * as git from "isomorphic-git";
import * as fs from "fs";

export class GitBridge {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Commit all changes locally. Push is left to the user.
   */
  async commit(message: string): Promise<boolean> {
    if (!this.repoPath) {
      throw new Error("Git repo path not set");
    }

    // Debug: log the status matrix to understand what's happening
    const status = await git.statusMatrix({ fs, dir: this.repoPath });
    const changes: string[] = [];
    const allFiles: string[] = [];

    for (const [filepath, headStatus, workDirStatus, stageStatus] of status) {
      allFiles.push(`${filepath} [h:${headStatus} w:${workDirStatus} s:${stageStatus}]`);
      const changed = workDirStatus !== headStatus || workDirStatus !== stageStatus;
      if (changed) {
        changes.push(`${filepath}`);
        await git.add({ fs, dir: this.repoPath, filepath });
      }
    }

    console.log("[ConfluenceGitSync] All tracked files:", allFiles);
    console.log("[ConfluenceGitSync] Changed files:", changes.length, changes);

    if (changes.length === 0) {
      return false;
    }

    await git.commit({
      fs,
      dir: this.repoPath,
      message,
      author: {
        name: "Confluence Git Sync",
        email: "confluence-git-sync@dial.studio",
      },
    });
    return true;
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    const branch = await git.currentBranch({ fs, dir: this.repoPath });
    return branch || "main";
  }

  /**
   * Get the last commit hash.
   */
  async getLastCommitHash(): Promise<string> {
    const log = await git.log({ fs, dir: this.repoPath, depth: 1 });
    if (log.length === 0) throw new Error("No commits found");
    return log[0].oid;
  }

  /**
   * Check if the repo has uncommitted changes.
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const status = await git.statusMatrix({ fs, dir: this.repoPath });
    for (const [, head, workdir, stage] of status) {
      if (workdir !== head || workdir !== stage) {
        return true;
      }
    }
    return false;
  }
}
