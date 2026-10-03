/** Calls the ERP API through this app's /api rewrite, with the session cookie. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Allowed with a supervisor's approval: ask for one and send again. */
    public approvalRequired = false,
  ) {
    super(message);
  }
}

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

/** The POS server could not be reached: no network, a gateway error, or a 500 without our JSON
 * (the Next.js proxy answering for a server that is down). Safe to send again later, because a
 * sale carries its own id. */
export function isUnreachable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.status === 0 || e.status === 502 || e.status === 504 || (e.status === 500 && e.message === SERVER_ERROR);
}

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function api<T>(path: string, init?: Omit<RequestInit, "body"> & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      body: json === undefined ? undefined : JSON.stringify(json),
      headers: { "content-type": "application/json", ...rest.headers },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    // Session expired or ended elsewhere. Outside React, so a full load to the login page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError(401, "Your session has ended. Please log in again.");
  }
  if (!res.ok) {
    let message = res.status >= 500 ? SERVER_ERROR : res.statusText;
    let approvalRequired = false;
    try {
      const body = await res.json();
      approvalRequired = body.approval_required === true;
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail))
        message = body.detail
          .map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(-1)[0] ?? ""}: ${d.msg}`.replace(/^: /, ""))
          .join("; ");
    } catch {}
    throw new ApiError(res.status, message, approvalRequired);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const get = <T>(path: string, query?: Query) => api<T>(withQuery(path, query));
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
