"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiBaseUrl, apiFetch } from "../lib/api";
export type Branding = {
  name: string;
  subtitle: string;
  logoUrl: string | null;
  updatedAt: string | null;
};
const fallback: Branding = {
  name: "Ecomkit",
  subtitle: "Vui Khỏe",
  logoUrl: null,
  updatedAt: null,
};
const Context = createContext<{
  branding: Branding;
  reload: () => Promise<void>;
}>({ branding: fallback, reload: async () => undefined });
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(fallback);
  const reload = useCallback(async () => {
    try {
      const response = await apiFetch("/branding");
      if (response.ok) setBranding((await response.json()) as Branding);
    } catch {
      /* retain safe fallback */
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  return (
    <Context.Provider
      value={useMemo(() => ({ branding, reload }), [branding, reload])}
    >
      {children}
    </Context.Provider>
  );
}
export const useBranding = () => useContext(Context);
export function BrandLogo({
  className,
  fallbackClassName,
}: {
  className?: string;
  fallbackClassName?: string;
}) {
  const { branding } = useBranding();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = branding.logoUrl
    ? `${apiBaseUrl}${branding.logoUrl}?v=${encodeURIComponent(branding.updatedAt ?? "")}`
    : null;
  if (!source || failedSource === source)
    return (
      <span className={fallbackClassName}>
        {branding.name.slice(0, 1).toUpperCase() || "E"}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- runtime API asset with a safe fallback.
    <img
      className={className}
      src={source}
      alt=""
      onError={() => setFailedSource(source)}
    />
  );
}
