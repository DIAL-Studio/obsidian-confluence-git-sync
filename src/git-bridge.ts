/**
 * Git bridge using isomorphic-git.
 *
 * Provides commit and push functionality from within Obsidian,
 * without requiring the user to have git CLI installed.
 *
 * Uses VaultFsAdapter instead of Node.js fs because Obsidian's
 * renderer process sandboxes the fs module.
 * Uses requestUrl for HTTP operations to avoid CORS.
 *
 * Commit strategy mirrors obsidian-git (Vinzent03/obsidian-git):
 * git.walk() to compare HEAD vs WORKDIR, stage changes, then commit.
 */

// @ts-ignore - isomorphic-git types are incomplete
import * as git from "isomorphic-git";
import type { Vault } from "obsidian";
import { requestUrl } from "obsidian";
import { VaultFsAdapter } from "./vault-fs-adapter";

export class GitBridge {
  private repoPath: string;
  private fs: VaultFsAdapter;

  constructor(repoPath: string, vault: Vault) {
    this.repoPath = repoPath;
    this.fs = new VaultFsAdapter(vault);
  }

  /**
   * Stage and commit all changed files.
   * Returns false if nothing was committed.
   */
  async commit(message: string): Promise<boolean> {
    if (!this.repoPath) {
      throw new Error("Git repo path not set");
    }

    const changedFiles = await this.getUnstagedFiles();
    console.log("[ConfluenceGitSync] Changed files:", changedFiles.length, changedFiles);

    if (changedFiles.length === 0) {
      return false;
    }

    // Stage all changed files
    for (const filepath of changedFiles) {
      await git.add({ fs: this.fs, dir: this.repoPath, filepath });
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

  /**
   * Find files that differ between HEAD and working directory.
   * Uses git.walk() to compare content hashes (OIDs), same as obsidian-git.
   */
  private async getUnstagedFiles(): Promise<string[]> {
    const repo = { fs: this.fs, dir: this.repoPath };
    const changed: string[] = [];

    await git.walk({
      ...repo,
      trees: [git.TREE({ ref: "HEAD" }), git.WORKDIR()],
      map: async (filepath, [head, workdir]) => {
        // Compare OIDs — different hash means the file changed
        const headOid = await head?.oid();
        const workdirOid = await workdir?.oid();

        if (headOid !== workdirOid) {
          changed.push(filepath);
        }

        // Return something to satisfy the walker
        return null;
      },
    });

    return changed;
  }

  /**
   * Push committed changes to the remote.
   * Requires a GitHub token for HTTPS authentication.
   */
  async push(token?: string): Promise<boolean> {
    const remotes = await git.listRemotes({ fs: this.fs, dir: this.repoPath });
    if (remotes.length === 0) {
      throw new Error("No git remote configured");
    }

    const remote = "origin";
    const remoteInfo = remotes.find((r) => r.remote === remote);
    if (!remoteInfo) {
      throw new Error(`Remote '${remote}' not found`);
    }

    const url = remoteInfo.url;
    if (url.startsWith("git@") || url.startsWith("ssh://")) {
      throw new Error("SSH remotes are not supported. Please switch to HTTPS.");
    }

    const currentBranch =
      (await git.currentBranch({ fs: this.fs, dir: this.repoPath })) || "main";

    await git.push({
      fs: this.fs,
      dir: this.repoPath,
      http: this.httpClient(token),
      remote,
      ref: currentBranch,
      onAuth: () => ({
        username: token || "",
        password: token || "",
      }),
      onMessage: (msg) => console.log("[ConfluenceGitSync] Push:", msg),
    });

    return true;
  }

  async commitAndPush(message: string, token?: string): Promise<string> {
    const didCommit = await this.commit(message);
    if (!didCommit) {
      return "No changes to commit";
    }

    try {
      await this.push(token);
      return "Committed and pushed";
    } catch (e: any) {
      console.warn("[ConfluenceGitSync] Push failed, commit saved locally:", e.message);
      return `Committed locally (push failed: ${e.message})`;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const branch = await git.currentBranch({ fs: this.fs, dir: this.repoPath });
    return branch || "main";
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const files = await this.getUnstagedFiles();
    return files.length > 0;
  }

  private httpClient(token?: string) {
    return {
      async request({ url, method, headers, body }: any): Promise<any> {
        const reqHeaders: Record<string, string> = { ...headers };
        if (token) {
          reqHeaders["Authorization"] = `Bearer ${token}`;
        }

        const res = await requestUrl({
          url,
          method,
          headers: reqHeaders,
          body,
          throw: false,
        });

        return {
          url,
          method,
          headers: res.headers,
          body: [new Uint8Array(res.arrayBuffer)],
          statusCode: res.status,
          statusMessage: res.status.toString(),
        };
      },
    };
  }
}
