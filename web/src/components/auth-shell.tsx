"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../lib/api";
import styles from "./auth-shell.module.css";

export type CurrentUser = { id: string; username: string; displayName: string; role: "ADMIN" | "USER" };
const UserContext = createContext<CurrentUser | null>(null);
export const useCurrentUser = () => useContext(UserContext);

const navigation = [
  ["/", "Tổng quan"], ["/batches/new", "Xử lý đơn hàng"], ["/history", "Lịch sử"]
] as const;

export function AuthShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const loginRoute = pathname === "/login";
  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/auth/me");
      if (response.ok) setUser(await response.json() as CurrentUser);
      else setUser(null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const unauthorized = () => { setUser(null); router.replace("/login"); };
    const authenticated = () => { setLoading(true); void load(); };
    window.addEventListener("ecomkit:unauthorized", unauthorized);
    window.addEventListener("ecomkit:authenticated", authenticated);
    return () => { window.removeEventListener("ecomkit:unauthorized", unauthorized); window.removeEventListener("ecomkit:authenticated", authenticated); };
  }, [load, router]);
  useEffect(() => {
    if (!loading && !user && !loginRoute) router.replace("/login");
    if (!loading && user && loginRoute) router.replace("/");
  }, [loading, user, loginRoute, router]);
  if (loading) return <main className={styles.loading}>Đang kiểm tra phiên đăng nhập...</main>;
  if (loginRoute) return <>{children}</>;
  if (!user) return <main className={styles.loading}>Đang chuyển tới trang đăng nhập...</main>;
  const logout = async () => { await apiFetch("/auth/logout", { method: "POST" }); setUser(null); router.replace("/login"); };
  return <UserContext.Provider value={user}><div className={styles.shell}>
    <aside className={styles.sidebar}><Link className={styles.brand} href="/">Ecomkit<br /><span>Vui Khỏe</span></Link>
      <nav aria-label="Điều hướng chính">{navigation.map(([href, label]) => <Link key={href} className={pathname === href ? styles.active : ""} href={href}>{label}</Link>)}{user.role === "ADMIN" && <Link className={pathname.startsWith("/admin") ? styles.active : ""} href="/admin/users">Quản lý tài khoản</Link>}</nav>
      <button type="button" onClick={() => void logout()}>Đăng xuất</button>
    </aside>
    <section className={styles.workspace}><header className={styles.header}><div><strong>{user.displayName || user.username}</strong><span>{user.role === "ADMIN" ? "Quản trị viên" : "Người dùng"}</span></div><button type="button" onClick={() => void logout()}>Đăng xuất</button></header><div className={styles.content}>{children}</div></section>
  </div></UserContext.Provider>;
}
