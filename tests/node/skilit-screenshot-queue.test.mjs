import assert from "node:assert/strict";
import test from "node:test";

import { ScreenshotQueue } from "../../packages/providers/monet/screenshot/queue.ts";

test("an empty queue is safe to inspect and dequeue", () => {
  const queue = new ScreenshotQueue();
  assert.equal(queue.isEmpty(), true);
  assert.equal(queue.size(), 0);
  assert.equal(queue.peek(), undefined);
  assert.equal(queue.dequeue(), undefined);
});

test("single-item FIFO ordering and size are preserved", () => {
  const queue = new ScreenshotQueue();
  queue.enqueue("screen-one");
  queue.enqueue("screen-two");

  assert.equal(queue.size(), 2);
  assert.equal(queue.peek(), "screen-one");
  assert.equal(queue.size(), 2);
  assert.equal(queue.dequeue(), "screen-one");
  assert.equal(queue.peek(), "screen-two");
  assert.equal(queue.dequeue(), "screen-two");
  assert.equal(queue.isEmpty(), true);
});

test("batch enqueue preserves caller order", () => {
  const queue = new ScreenshotQueue();
  queue.enqueueAll(["first", "second", "third"]);
  assert.deepEqual(
    [queue.dequeue(), queue.dequeue(), queue.dequeue()],
    ["first", "second", "third"],
  );
});

test("empty batch enqueue does not change the queue", () => {
  const queue = new ScreenshotQueue();
  queue.enqueueAll([]);
  assert.equal(queue.size(), 0);
  assert.equal(queue.dequeue(), undefined);
});

test("the queue retains duplicate IDs without deduplication", () => {
  const queue = new ScreenshotQueue();
  queue.enqueue("same");
  queue.enqueue("same");
  assert.equal(queue.size(), 2);
  assert.equal(queue.dequeue(), "same");
  assert.equal(queue.dequeue(), "same");
});

test("different queue instances never share in-memory items", () => {
  const first = new ScreenshotQueue();
  const second = new ScreenshotQueue();
  first.enqueue("private-to-first");
  assert.equal(first.size(), 1);
  assert.equal(second.size(), 0);
  assert.equal(second.dequeue(), undefined);
});
