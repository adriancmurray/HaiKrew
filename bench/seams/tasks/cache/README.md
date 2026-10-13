# cache: store, eviction policy, stats

Goal: a byte-budgeted key/value cache. The `Entry`, `Policy`, `Stats` and `Snapshot` types and the
`sizeOf` helper live in `entry.ts`. The store holds entries and evicts through a policy, the policy
picks victims, and stats count hits, misses and evictions.
