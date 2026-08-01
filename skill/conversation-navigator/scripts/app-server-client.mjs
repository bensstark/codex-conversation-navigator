import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class AppServerClient {
  constructor({ spawnProcess = spawn, command = "codex" } = {}) {
    this.spawnProcess = spawnProcess;
    this.command = command;
    this.nextId = 1;
    this.pending = new Map();
    this.child = null;
    this.lines = null;
    this.stopping = false;
  }

  async start() {
    if (this.child) {
      return;
    }

    try {
      this.child = this.spawnProcess(this.command, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      this.child = null;
      throw new Error(`Unable to start Codex App Server: ${error.message}`, {
        cause: error,
      });
    }

    this.child.on("error", (error) => {
      this.failAll(
        new Error(`Unable to start Codex App Server: ${error.message}`, {
          cause: error,
        }),
      );
    });
    this.child.on("exit", (code, signal) => {
      if (this.stopping) {
        return;
      }
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.failAll(new Error(`Codex App Server exited with ${detail}`));
    });

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "conversation_navigator",
        title: "Conversation Navigator",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  request(method, params = undefined) {
    if (!this.child) {
      return Promise.reject(new Error("Codex App Server is not running"));
    }

    const id = this.nextId++;
    const message = { method, id };
    if (params !== undefined) {
      message.params = params;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (!error) {
          return;
        }
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method, params = undefined) {
    if (!this.child) {
      throw new Error("Codex App Server is not running");
    }

    const message = { method };
    if (params !== undefined) {
      message.params = params;
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async listThreads(cwd, sourceKinds = ["vscode", "cli"]) {
    const threads = [];
    let cursor;

    do {
      const response = await this.request("thread/list", {
        cwd,
        sourceKinds,
        sortKey: "updated_at",
        sortDirection: "desc",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      threads.push(...(response.data ?? []));
      cursor = response.nextCursor ?? null;
    } while (cursor);

    return threads;
  }

  async readThread(threadId) {
    const response = await this.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    return response.thread;
  }

  stop() {
    if (!this.child || this.stopping) {
      return;
    }

    this.stopping = true;
    this.failAll(new Error("Codex App Server stopped"));
    this.lines?.close();
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.failAll(
        new Error(`Invalid JSON from Codex App Server: ${error.message}`, {
          cause: error,
        }),
      );
      return;
    }

    if (message.id === undefined) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message ?? "Codex App Server error"));
    } else {
      pending.resolve(message.result);
    }
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }
}
