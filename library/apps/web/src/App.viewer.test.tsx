import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens a catalog asset in the in-app viewer instead of navigating to raw bytes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "asset-1",
            title: "Museum Tour",
            media_type: "video",
            status: "available",
            files: [{ id: 1, relative_path: "Museum Tour.webm", size: 2048 }],
          },
        ],
        total: 1,
      }),
    }),
  );

  render(<App apiBase="http://catalog.test" />);
  fireEvent.click(await screen.findByRole("button", { name: "View Museum Tour" }));

  expect(screen.getByRole("dialog", { name: "Museum Tour" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
});
