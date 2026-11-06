import { expect, test } from "bun:test";
import { CloseRequests } from "../apps/kit/close.ts";

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
