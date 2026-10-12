/** The agent transcript pane: what each tool call line says it was aimed at. */
import { expect, test } from "claude-code/testing";
import { target } from "../../src/mod/pane-agent.ts";

test("a tool call reads as its command, path, pattern, URL or query, one line", () => {
  expect(target({ command: "cargo test\n--all" })).toBe("cargo test");
  expect(target({ file_path: "src/mod/sky.ts", content: "x" })).toBe("src/mod/sky.ts");
  expect(target({ pattern: "TODO", path: "" })).toBe("TODO");
  expect(target({ url: "https://example.com" })).toBe("https://example.com");
  expect(target({})).toBe("");
  expect(target(undefined)).toBe("");
});
