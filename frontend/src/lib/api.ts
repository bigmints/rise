export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && path !== "/api/session") {
    window.location.replace("/login");
    throw new ApiError(401, "Session expired");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export function registerPwa() {
  if (import.meta.env.DEV) return;
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
    });
  }
}
