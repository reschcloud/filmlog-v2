export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class NetworkError extends Error {
  constructor(message = "Keine Verbindung zum Server.") {
    super(message);
    this.name = "NetworkError";
  }
}

export interface RequestOptions {
  timeoutMs?: number;
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn;
}

function extractError(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.error === "string" && d.error) return d.error;
    if (typeof d.detail === "string" && d.detail) return d.detail;
    if (Array.isArray(d.detail)) {
      const msgs = d.detail
        .map((x) => (x && typeof x === "object" && "msg" in x ? String((x as { msg: unknown }).msg) : ""))
        .filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    }
  }
  return `Fehler ${status}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-Filmlog"] = "1";
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let timer: number | undefined;
  if (opts.timeoutMs) {
    const ctrl = new AbortController();
    init.signal = ctrl.signal;
    timer = window.setTimeout(() => ctrl.abort(), opts.timeoutMs);
  }

  let res: Response;
  let text: string;
  try {
    res = await fetch(path, init);
    text = await res.text();
  } catch {
    throw new NetworkError();
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) unauthorizedHandler?.();
    throw new ApiError(res.status, extractError(data, res.status));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, body ?? {}, opts),
  postForm: <T>(path: string, form: FormData) => request<T>("POST", path, form),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Fehler, bei denen der Server (vorübergehend) nicht erreichbar ist. */
export function isOfflineError(e: unknown): boolean {
  return (
    e instanceof NetworkError ||
    (e instanceof ApiError && (e.status === 502 || e.status === 503 || e.status === 504))
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Unbekannter Fehler";
}
