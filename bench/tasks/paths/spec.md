# normalizePath

Add a pure posix `normalizePath(p)` to `paths.ts` (no trailing slash, `""` gives `"."`) and
use it in `safeJoin` instead of `posix.resolve`.
