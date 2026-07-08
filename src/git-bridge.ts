/**
 * Git bridge using isomorphic-git.
 *
 * Provides commit and push functionality from within Obsidian,
 * without requiring the user to have git CLI installed.
 */

// @ts-ignore - isomorphic-git types are incomplete
import * as git from "isomorphic-git";
import * as fs from "fs";
import http from "http";
import https from "https";

export class GitBridge {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Commit all changes and push to remote.
   */
  async commitAndPush(message: string): Promise<void> {
    if (!this.repoPath) {
      throw new Error("Git repo path not set");
    }

    // Stage all changes
    await git.statusMatrix({ fs, dir: this.repoPath }).then(async (status) => {
      for (const [filepath, headStatus, workDirStatus, stageStatus] of status) {
        if (workDirStatus !== headStatus || workDirStatus !== stageStatus) {
          await git.add({ fs, dir: this.repoPath, filepath });
        }
      }
    });

    // Commit
    await git.commit({
      fs,
      dir: this.repoPath,
      message,
      author: {
        name: "Confluence Git Sync",
        email: "confluence-git-sync@dial.studio",
      },
    });

    // Push
    const isHttps = this.repoPath.startsWith("https");
    await git.push({
      fs,
      http: isHttps ? https : http,
      dir: this.repoPath,
      remote: "origin",
      onAuth: () => {
        // For private repos, the user should have their SSH key or credential helper configured
        return { username: "", password: "" };
      },
    } as any);
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
