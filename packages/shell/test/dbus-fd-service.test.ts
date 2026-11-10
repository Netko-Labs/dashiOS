import { afterAll, beforeAll, expect, test } from "bun:test";
import { readSync, writeSync } from "node:fs";
import { DBusConnection, FdConnection, FdService, MessageType, requestName } from "../src/shared/dbus/index.ts";
import { closeFd, pipePair } from "../src/shared/dbus/libc.ts";
import { type PrivateBus, startPrivateBus } from "./private-bus.ts";

let bus: PrivateBus | null = null;

beforeAll(async () => {
  bus = await startPrivateBus("dashi-fd-service");
});

afterAll(() => bus?.stop());

test("a service gets the descriptors that come with a call, and answers ordinary calls", async () => {
  if (!bus) return;
  const service = await FdService.connect({ address: bus.address });
  const seen: string[] = [];
  service.export("/test", [
    {
      name: "dev.dashi.Test",
      methods: {
        Read: {
          in: "h",
          out: "s",
          handler: ([index], call) => {
            const fd = call.fds?.[index as number];
            if (fd === undefined) return "no fd";
            const buffer = Buffer.alloc(64);
            const got = readSync(fd, buffer);
            return buffer.subarray(0, got).toString();
          },
        },
        Echo: {
          in: "s",
          out: "s",
          handler: ([text]) => {
            seen.push(text as string);
            return `echo ${text as string}`;
          },
        },
      },
    },
  ]);
  // The name is requested through the service itself (a plain call it makes).
  const [result] = await service.call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "RequestName",
    signature: "su",
    body: ["dev.dashi.TestService", 4],
  });
  expect(result).toBe(1);

  const plain = await DBusConnection.connect({ address: bus.address });
  const [echoed] = await plain.call({
    destination: "dev.dashi.TestService",
    path: "/test",
    interface: "dev.dashi.Test",
    member: "Echo",
    signature: "s",
    body: ["hi"],
  });
  expect(echoed).toBe("echo hi");
  expect(seen).toEqual(["hi"]);
  expect(await requestName(plain, "dev.dashi.Other")).toBe("primary");

  const pipe = pipePair();
  writeSync(pipe.write, "the document");
  closeFd(pipe.write);
  const client = await FdConnection.connect({ address: bus.address });
  const serial = client.send(
    {
      type: MessageType.MethodCall,
      flags: 0,
      destination: "dev.dashi.TestService",
      path: "/test",
      interface: "dev.dashi.Test",
      member: "Read",
      signature: "h",
      body: [0],
    },
    [pipe.read],
  );
  closeFd(pipe.read);
  for (;;) {
    const { message } = await client.receive(3000);
    if (message.replySerial !== serial) continue;
    expect(message.type).toBe(MessageType.MethodReturn);
    expect(message.body[0]).toBe("the document");
    break;
  }
  client.close();
  plain.close();
  service.close();
});
