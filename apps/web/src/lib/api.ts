export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

const buildUrl = (path: string, query?: Query) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
};

export const request = async <T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> => {
  const res = await fetch(buildUrl(path, query), {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = data.issues as ApiError['issues'];
    const detail = issues?.length ? `: ${issues.map((i) => `${i.path.replace(/^\//, '')} ${i.message}`).join(', ')}` : '';
    throw new ApiError(res.status, data.error ?? 'ERROR', `${data.message ?? 'Error'}${detail}`, issues);
  }
  return data as T;
};

/** Sends files as multipart/form-data. */
const upload = async <T>(path: string, file: File | File[]): Promise<T> => {
  const form = new FormData();
  for (const f of Array.isArray(file) ? file : [file]) form.append(Array.isArray(file) ? 'files' : 'file', f);
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? 'Error');
  return data as T;
};

export const api = {
  upload,
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body: unknown = {}, query?: Query) => request<T>('POST', path, body, query),
  put: <T>(path: string, body: unknown, query?: Query) => request<T>('PUT', path, body, query),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string, query?: Query) => request<T>('DELETE', path, undefined, query),
};
