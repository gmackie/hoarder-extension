import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetViewer, type Asset } from "./AssetViewer";

afterEach(cleanup);

const video: Asset = {
  id: "video-1",
  title: "Museum Tour",
  media_type: "video",
  status: "available",
  thumbnail_url: "/api/assets/video-1/thumbnail",
  files: [{ id: 1, relative_path: "Museum Tour.mkv", size: 2048 }],
};

describe("AssetViewer", () => {
  it("keeps video inspection in the app and makes downloading explicit", () => {
    const onClose = vi.fn();
    render(<AssetViewer apiBase="http://catalog.test" asset={video} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Museum Tour" })).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute(
      "src",
      "http://catalog.test/api/assets/video-1/stream",
    );
    expect(document.querySelector("video")).toHaveAttribute(
      "poster",
      "http://catalog.test/api/assets/video-1/thumbnail",
    );
    expect(screen.getByRole("link", { name: "Download original" })).toHaveAttribute(
      "download",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders saved images as the primary content", () => {
    const image: Asset = {
      ...video,
      id: "image-1",
      title: "Saved reference",
      media_type: "image",
      files: [{ id: 2, relative_path: "Saved reference.png", size: 1024 }],
    };

    render(<AssetViewer apiBase="" asset={image} onClose={() => {}} />);

    expect(screen.getByRole("img", { name: "Saved reference" })).toHaveAttribute(
      "src",
      "/api/assets/image-1/stream",
    );
  });
});
