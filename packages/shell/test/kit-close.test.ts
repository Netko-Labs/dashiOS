import { expect, test } from "bun:test";
import { CloseRequests, QUIT_HOLDS_MS } from "../apps/kit/close.ts";

test("an app with no answer closes at once", () => {
  const requests = new CloseRequests();
  let closed = 0;
  requests.request(() => closed++);
  expect(closed).toBe(1);
  expect(requests.isAnswered).toBe(false);
});

test("an answer holds the window: the app closes or asks, the kit does not close it", () => {
  const requests = new CloseRequests();
  let asked = 0;
  let closed = 0;
  const stop = requests.answer(() => asked++);
  requests.request(() => closed++);
  expect([asked, closed]).toEqual([1, 0]);
  stop();
  requests.request(() => closed++);
  expect([asked, closed]).toEqual([1, 1]);
});

test("the newest answer wins, and taking it back restores the one before", () => {
  const requests = new CloseRequests();
  const heard: string[] = [];
  requests.answer(() => heard.push("window"));
  const stopSheet = requests.answer(() => heard.push("sheet"));
  requests.request(() => heard.push("closed"));
  stopSheet();
  requests.request(() => heard.push("closed"));
  expect(heard).toEqual(["sheet", "window"]);
});

test("a close request just after the shell said the app quits is a quit; any other is a close", () => {
  let now = 1000;
  const requests = new CloseRequests(() => now);
  const reasons: string[] = [];
  requests.answer((reason) => reasons.push(reason));
  requests.request(() => {});
  requests.quitting();
  now += QUIT_HOLDS_MS - 1;
  requests.request(() => {});
  // The word holds for one request only.
  requests.request(() => {});
  // Said, but the request came too late: someone pressed the close control later.
  requests.quitting();
  now += QUIT_HOLDS_MS + 1;
  requests.request(() => {});
  expect(reasons).toEqual(["close", "quit", "close", "close"]);
});
