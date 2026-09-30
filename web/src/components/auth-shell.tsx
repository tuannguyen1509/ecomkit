"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../lib/api";
import { BrandLogo, useBranding } from "./branding";
import styles from "./auth-shell.module.css";
export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER";
};
const UserContext = createContext<CurrentUser | null>(null);
export const useCurrentUser = () => useContext(UserContext);
type IconName =
  "home" | "process" | "store" | "history" | "users" | "settings" | "logout";
function Icon({ name }: { name: IconName }) {
  const c = {
    width: 19,
    height: 19,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "home")
    return (
      <svg {...c}>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </svg>
    );
  if (name === "process")
    return (
      <svg {...c}>
        <path d="M4 5h16v14H4z" />
        <path d="M8 9h8M8 13h5" />
      </svg>
    );
  if (name === "store")
    return (
      <svg {...c}>
        <path d="M4 10v10h16V10M3 10l2-6h14l2 6" />
        <path d="M8 20v-6h8v6" />
      </svg>
    );
  if (name === "history")
    return (
      <svg {...c}>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </svg>
    );
  if (name === "users")
    return (
      <svg {...c}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c2.7.3 4 2.2 4 5" />
      </svg>
    );
  if (name === "settings")
    return (
      <svg {...c}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
      </svg>
    );
  return (
    <svg {...c}>
      <path d="M10 5H4v14h6M14 8l4 4-4 4M8 12h10" />
    </svg>
  );
}
const base = [
  { href: "/", label: "Tổng quan", icon: "home" },
  { href: "/batches/new", label: "Xử lý đơn hàng", icon: "process" },
  { href: "/history", label: "Lịch sử", icon: "history" },
] as const;
const titles: Record<string, string> = {
  "/": "Tổng quan",
  "/batches/new": "Xử lý đơn hàng",
  "/batches/": "Chi tiết Batch",
  "/history": "Lịch sử xử lý",
  "/marketplaces": "Marketplace",
  "/admin/users": "Quản lý tài khoản",
  "/admin/settings/branding": "Thương hiệu hệ thống",
};
export function AuthShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    { branding } = useBranding();
  const [user, setUser] = useState<CurrentUser | null>(null),
    [loading, setLoading] = useState(true),
    login = pathname === "/login";
  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/auth/me");
      setUser(response.ok ? ((await response.json()) as CurrentUser) : null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const unauthorized = () => {
        setUser(null);
        router.replace("/login");
      },
      authenticated = () => {
        setLoading(true);
        void load();
      };
    window.addEventListener("ecomkit:unauthorized", unauthorized);
    window.addEventListener("ecomkit:authenticated", authenticated);
    return () => {
      window.removeEventListener("ecomkit:unauthorized", unauthorized);
      window.removeEventListener("ecomkit:authenticated", authenticated);
    };
  }, [load, router]);
  useEffect(() => {
    if (!loading && !user && !login) router.replace("/login");
    if (!loading && user && login) router.replace("/");
  }, [loading, user, login, router]);
  if (loading)
    return (
      <main className={styles.loading}>
        <span className={styles.loader} />
        <p>Đang kiểm tra phiên đăng nhập...</p>
      </main>
    );
  if (login) return <>{children}</>;
  if (!user)
    return (
      <main className={styles.loading}>Đang chuyển tới trang đăng nhập...</main>
    );
  const nav =
    user.role === "ADMIN"
      ? [
          base[0],
          base[1],
          {
            href: "/marketplaces",
            label: "Marketplace",
            icon: "store" as const,
          },
          base[2],
          {
            href: "/admin/users",
            label: "Quản lý tài khoản",
            icon: "users" as const,
          },
          {
            href: "/admin/settings/branding",
            label: "Cài đặt hệ thống",
            icon: "settings" as const,
          },
        ]
      : base;
  const active = (href: string) =>
      href === "/" ? pathname === "/" : pathname.startsWith(href),
    pageTitle =
      Object.entries(titles).find(([path]) =>
        path === "/" ? pathname === "/" : pathname.startsWith(path),
      )?.[1] ?? branding.name;
  const logout = async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    setUser(null);
    router.replace("/login");
  };
  return (
    <UserContext.Provider value={user}>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link
            className={styles.brand}
            href="/"
            aria-label={`${branding.name} ${branding.subtitle}`}
          >
            <BrandLogo
              className={styles.brandLogo}
              fallbackClassName={styles.brandMark}
            />
            <span>
              <strong>{branding.name}</strong>
              <small>{branding.subtitle}</small>
            </span>
          </Link>
          <p className={styles.navLabel}>Không gian làm việc</p>
          <nav aria-label="Điều hướng chính">
            {nav.map((item) => (
              <Link
                key={item.href}
                className={active(item.href) ? styles.active : ""}
                href={item.href}
                aria-current={active(item.href) ? "page" : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className={styles.account}>
            <span className={styles.avatar}>
              {(user.displayName || user.username).slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.displayName || user.username}</strong>
              <small>
                {user.role === "ADMIN" ? "Quản trị viên" : "Người dùng"}
              </small>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Đăng xuất"
            >
              <Icon name="logout" />
            </button>
          </div>
        </aside>
        <section className={styles.workspace}>
          <header className={styles.header}>
            <div>
              <span>Không gian làm việc</span>
              <strong>{pageTitle}</strong>
            </div>
            <div className={styles.headerUser}>
              <span className={styles.headerAvatar}>
                {(user.displayName || user.username).slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{user.displayName || user.username}</strong>
                <small>{user.role}</small>
              </div>
            </div>
          </header>
          <div className={styles.content}>{children}</div>
        </section>
      </div>
    </UserContext.Provider>
  );
}
