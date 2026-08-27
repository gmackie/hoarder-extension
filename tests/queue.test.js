import { describe, expect, it } from "vitest";
import { normalizeQueueHistory } from "../src/queue.js";

describe("MeTube queue monitor", () => {
  it("provides a queue history normalizer", async () => {
    const queueModule = await import("../src/queue.js").catch(() => ({}));

    expect(queueModule.normalizeQueueHistory).toBeTypeOf("function");
  });

  it("shows active work and the five newest results for one target folder", () => {
    const history = {
      queue: [
        {
          id: "active-root",
          title: "Downloading now",
          folder: "",
          status: "downloading",
          percent: 42.6,
          timestamp: 20,
        },
        {
          id: "active-secondary",
          title: "Other destination",
          folder: "secondary",
          status: "downloading",
          percent: 75,
          timestamp: 21,
        },
      ],
      pending: [
        {
          id: "waiting-root",
          title: "Waiting",
          status: "pending",
          timestamp: 19,
        },
      ],
      done: Array.from({ length: 7 }, (_, index) => ({
        id: `done-${index + 1}`,
        title: `Result ${index + 1}`,
        folder: "",
        status: index === 5 ? "error" : "finished",
        msg: index === 5 ? "Network error" : null,
        timestamp: index + 1,
      })),
    };

    const result = normalizeQueueHistory(history, {
      folder: "",
      recentLimit: 5,
    });

    expect(result.active).toEqual([
      expect.objectContaining({
        id: "active-root",
        title: "Downloading now",
        status: "downloading",
        progress: 43,
      }),
      expect.objectContaining({
        id: "waiting-root",
        title: "Waiting",
        status: "pending",
        progress: 0,
      }),
    ]);
    expect(result.recent.map((item) => item.id)).toEqual([
      "done-7",
      "done-6",
      "done-5",
      "done-4",
      "done-3",
    ]);
    expect(result.recent[1]).toEqual(
      expect.objectContaining({ status: "failed", message: "Network error" }),
    );
    expect(result.recent[0].status).toBe("saved");
  });

  it("handles incomplete history without leaking invalid progress values", () => {
    const result = normalizeQueueHistory({
      queue: [
        { id: "high", percent: 150 },
        { url: "https://example.test/video", percent: -12 },
      ],
      pending: null,
      done: "not-an-array",
    });

    expect(result.active).toEqual([
      expect.objectContaining({ id: "high", title: "high", progress: 100 }),
      expect.objectContaining({
        title: "https://example.test/video",
        progress: 0,
      }),
    ]);
    expect(result.recent).toEqual([]);
  });
});
