"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field } from "../../components/ui/ui";
import { apiFetch } from "../../lib/api";
import { BrandLogo, useBranding } from "../../components/branding";
import styles from "./login.module.css";
export default function LoginPage() {
  const router = useRouter();
  const { branding } = useBranding();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Tên đăng nhập hoặc mật khẩu không đúng."
            : response.status === 429
              ? "Bạn thao tác quá nhanh. Vui lòng thử lại sau."
              : "Không thể đăng nhập. Vui lòng thử lại.",
        );
        return;
      }
      window.dispatchEvent(new Event("ecomkit:authenticated"));
      router.replace("/");
    } catch {
      setError("Không thể kết nối tới hệ thống. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className={styles.page}>
      <section className={styles.brandPanel}>
        <div>
          <BrandLogo className={styles.logo} fallbackClassName={styles.mark} />
          <h1>{branding.name}</h1>
          <p>{branding.subtitle}</p>
        </div>
        <blockquote>
          Quản lý xử lý và đối chiếu đơn hàng trong một không gian làm việc rõ
          ràng.
        </blockquote>
      </section>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.mobileBrand}>
          <BrandLogo className={styles.logo} fallbackClassName={styles.mark} />
          <strong>
            {branding.name} · {branding.subtitle}
          </strong>
        </div>
        <header>
          <p>CHÀO MỪNG TRỞ LẠI</p>
          <h2>Đăng nhập</h2>
          <span>Sử dụng tài khoản nội bộ được cấp để tiếp tục.</span>
        </header>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Tên đăng nhập">
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Mật khẩu">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Button loading={loading}>Đăng nhập</Button>
        <small>
          Hệ thống nội bộ {branding.name} · Không có đăng ký công khai
        </small>
      </form>
    </main>
  );
}
