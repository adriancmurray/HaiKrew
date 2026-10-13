export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type Fetcher = (url: string) => Promise<{ status: number; body: string }>;

export function createClient(fetcher: Fetcher) {
  return {
    async get(url: string): Promise<string> {
      const res = await fetcher(url);
      if (res.status >= 400) throw new HttpError(res.status, `GET ${url} -> ${res.status}`);
      return res.body;
    },
  };
}
