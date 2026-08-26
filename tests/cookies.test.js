import { describe, it, expect } from "vitest";
import { toNetscapeCookieString } from "../src/cookies.js";

describe("toNetscapeCookieString", () => {
  it("converts browser cookies to Netscape format", () => {
    const cookies = [
      {
        domain: ".youtube.com",
        httpOnly: false,
        path: "/",
        secure: true,
        expirationDate: 1735689600,
        name: "PREF",
        value: "tz=America.Los_Angeles",
      },
    ];
    const result = toNetscapeCookieString(cookies);
    const lines = result.trim().split("\n");
    expect(lines[0]).toBe("# Netscape HTTP Cookie File");
    expect(lines[1]).toContain(".youtube.com");
    expect(lines[1]).toContain("PREF");
    expect(lines[1]).toContain("tz=America.Los_Angeles");
  });

  it("handles multiple cookies", () => {
    const cookies = [
      { domain: ".youtube.com", httpOnly: true, path: "/", secure: true, expirationDate: 0, name: "A", value: "1" },
      { domain: ".youtube.com", httpOnly: false, path: "/", secure: false, expirationDate: 0, name: "B", value: "2" },
    ];
    const result = toNetscapeCookieString(cookies);
    const dataLines = result.trim().split("\n").filter((l) => !l.startsWith("# "));
    expect(dataLines).toHaveLength(2);
  });

  it("returns header only for empty array", () => {
    const result = toNetscapeCookieString([]);
    expect(result.trim()).toBe("# Netscape HTTP Cookie File");
  });
});
