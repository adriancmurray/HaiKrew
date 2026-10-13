# Retry failed GETs

`createClient(fetcher)` gives up on the first failure. Give it an optional second argument
`{ retries?, sleep? }`: `retries` (default 0) is how many times a failed `get` is retried, and
`sleep(ms)` is an injectable async delay (default: a real timer). Retry on thrown network errors
and 5xx responses, waiting 100ms, 200ms, 400ms... between attempts. When retries run out, throw
the last error. Existing callers pass no options.
