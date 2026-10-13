export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type Fetcher = (url: string) => Promise<{ status: number; body: string }>;
export type ClientOptions = { retries?: number; sleep?: (ms: number) => Promise<void> };

export function createClient(fetcher: Fetcher, opts: ClientOptions = {}) {
  const retries = opts.retries ?? 0;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async get(url: string): Promise<string> {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetcher(url);
          if (res.status >= 400) throw new HttpError(res.status, `GET ${url} -> ${res.status}`);
          return res.body;
        } catch (e) {
          const retryable = !(e instanceof HttpError) || e.status >= 500;
          if (!retryable || attempt >= retries) throw e;
          await sleep(100 * 2 ** attempt);
        }
      }
    },
  };
}
