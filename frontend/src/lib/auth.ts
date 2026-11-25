import { api, ApiError, NetworkError } from "../api";
import { cacheClear } from "./cache";

export const session: { username: string | null } = { username: null };

export type MeResult = "ok" | "unauthorized" | "offline";

export async function fetchMe(): Promise<MeResult> {
  try {
    const me = await api.get<{ username: string }>("/auth/me", { timeoutMs: 6000 });
    session.username = me.username;
    return "ok";
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return "unauthorized";
    if (e instanceof NetworkError || e instanceof ApiError) return "offline";
    throw e;
  }
}

export async function login(username: string, password: string, remember: boolean): Promise<void> {
  const res = await api.post<{ username: string }>("/auth/login", { username, password, remember });
  session.username = res.username;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } finally {
    cacheClear();
    session.username = null;
  }
}
