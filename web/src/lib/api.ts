export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, credentials: "include", cache: init.cache ?? "no-store" });
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("ecomkit:unauthorized"));
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw Object.assign(new Error("API request failed"), { status: response.status, body: await response.json().catch(() => null) });
  return response.json() as Promise<T>;
}
