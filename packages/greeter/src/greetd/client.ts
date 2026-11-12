/**
 * A connection to greetd. Requests go one at a time, each waiting for its
 * response, which is all greetd's protocol allows.
 */

import { encode, FrameReader, parseResponse, type Request, type Response } from "./lib/protocol.ts";

export interface Greetd {
  send(request: Request): Promise<Response>;
  close(): void;
}

export async function connectGreetd(path = process.env.GREETD_SOCK): Promise<Greetd> {
  if (!path) throw new Error("GREETD_SOCK is not set: the greeter runs under greetd");
  const reader = new FrameReader();
  const waiting: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  let chain: Promise<unknown> = Promise.resolve();

  const socket = await Bun.connect({
    unix: path,
    socket: {
      data(_socket, chunk) {
        for (const json of reader.push(chunk)) {
          const next = waiting.shift();
          const response = parseResponse(json);
          if (!next) continue;
          if (response) next.resolve(response);
          else next.reject(new Error("greetd sent something that is not a response"));
        }
      },
      close() {
        for (const next of waiting.splice(0)) next.reject(new Error("greetd closed the connection"));
      },
    },
  });

  const send = (request: Request): Promise<Response> => {
    const result = chain.then(
      () =>
        new Promise<Response>((resolve, reject) => {
          waiting.push({ resolve, reject });
          socket.write(encode(request));
        }),
    );
    chain = result.catch(() => {});
    return result;
  };

  return { send, close: () => socket.end() };
}
