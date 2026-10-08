/**
 * The slice of the mods API (`$`) the mod modules use, typed structurally so these files stay plain
 * TypeScript with no Node.js imports. Also the shapes of hook events and of the `next` callback.
 */
export type Input = Record<string, unknown>;

/** Passes an event on to the next mod or to Claude Code, returning that reply. */
export type Next = (e: Input) => unknown;

/** The mods API methods the hooks module uses: the environment, files, the store and the plugin root. */
export type Api = {
  env: { get(name: string): Promise<string | undefined> };
  fs: {
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
  };
  store: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  plugin: { root: string };
};

/** True for a plain JSON object (not null, not an array). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
