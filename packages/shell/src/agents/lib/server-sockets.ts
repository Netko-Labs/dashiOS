/** The agents' sockets: who connects (SO_PEERCRED), the session each connection gets, and the two places it listens. */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { identify, peerPid, socketFd } from "../peer.ts";
import { isConfined, taskOfCgroup, taskSocket } from "../sandbox.ts";
import { Session } from "./session/session.ts";
import type { SessionContext, SessionTask, TaskHooks, TaskPolicy } from "./session/session-types.ts";

/** A file's text, or null. */
const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export interface Listening {
  /** Every session ends, the sockets close, and their files go. */
  close(): void;
}

export interface SocketParts {
  sessions: Map<number, Session>;
  context: SessionContext;
  /** Runs started from the launcher (agents/handoff/): a connection from one's sandbox gets its policy. */
  tasks: (TaskHooks & { policy(task: string): TaskPolicy | null }) | undefined;
  /** The menu bar's list changed. */
  publish(): void;
}

/** The task a connection belongs to, when a launcher run's sandbox made it. */
function taskOf(pid: number, confined: boolean, remote: boolean, tasks: SocketParts["tasks"]): SessionTask | null {
  // A run the launcher started: its scope is named for it, and only the shell knows its policy.
  const taskId = confined && !remote ? taskOfCgroup(readText(`/proc/${pid}/cgroup`) ?? "") : null;
  const policy = taskId ? (tasks?.policy(taskId) ?? null) : null;
  return taskId && policy ? { id: taskId, policy } : null;
}

function handlersFor({ sessions, context, tasks, publish }: SocketParts): Bun.SocketHandler<{ session?: Session }> {
  let nextId = 0;
  return {
    open(socket) {
      // Bun sockets carry their fd; SO_PEERCRED says who is on the other end.
      const fd = socketFd(socket);
      const pid = fd !== null ? peerPid(fd) : null;
      if (pid === null) {
        socket.terminate();
        return;
      }
      const peer = identify(pid);
      const confined = isConfined(readText, pid, peer.remote);
      const task = taskOf(pid, confined, peer.remote, tasks);
      const session = new Session(
        ++nextId,
        // A launcher run goes by its harness's name on sheets and in the activity ("Codex wants to use …"); its detail stays the process.
        task ? { ...peer, name: task.policy.name } : peer,
        socket,
        context,
        (gone) => {
          sessions.delete(gone.id);
          publish();
        },
        confined,
        task,
      );
      socket.data = { session };
      sessions.set(session.id, session);
      publish();
    },
    data(socket, data) {
      socket.data?.session?.receive(data);
    },
    drain(socket) {
      socket.data?.session?.drain();
    },
    close(socket) {
      socket.data?.session?.stop("disconnected");
    },
    error(socket) {
      socket.data?.session?.stop("disconnected");
    },
  };
}

/** Listen at `path`, and at the tasks' folder beside it. */
export function listenAgents(path: string, parts: SocketParts): Listening {
  const handlers = handlersFor(parts);
  /** Listen at `at`, a socket only the person may use; null when it can't be made (logged). */
  const listen = (at: string) => {
    try {
      if (existsSync(at)) unlinkSync(at);
      const listener = Bun.listen<{ session?: Session }>({ unix: at, socket: handlers });
      chmodSync(at, 0o600);
      return listener;
    } catch (error) {
      console.error(`dashi-shell: agents can't connect at ${at}:`, error);
      return null;
    }
  };
  const server = listen(path);
  // Tasks' bridges: a folder of its own, so a restarted shell's socket shows inside their sandboxes.
  const forTasks = taskSocket(dirname(path));
  mkdirSync(dirname(forTasks), { recursive: true, mode: 0o700 });
  const taskServer = listen(forTasks);
  return {
    close() {
      for (const session of parts.sessions.values()) session.stop("disconnected");
      server?.stop(true);
      taskServer?.stop(true);
      for (const at of [path, forTasks]) if (existsSync(at)) unlinkSync(at);
    },
  };
}
