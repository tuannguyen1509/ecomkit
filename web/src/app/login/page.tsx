"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter(); const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); if (loading) return; setLoading(true); setError(""); try { const response = await apiFetch("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); if (!response.ok) { setError(response.status === 401 ? "Tên đăng nhập hoặc mật khẩu không đúng." : "Không thể đăng nhập. Vui lòng thử lại."); return; } router.replace("/"); } catch { setError("Không thể kết nối tới hệ thống. Vui lòng thử lại."); } finally { setLoading(false); } };
  return <main className={styles.page}><form className={styles.card} onSubmit={submit}><p className={styles.brand}>Ecomkit - Vui Khỏe</p><h1>Đăng nhập</h1><p>Đăng nhập để xử lý và đối chiếu đơn hàng.</p><label>Tên đăng nhập<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label><label>Mật khẩu<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>{error && <p className={styles.error} role="alert">{error}</p>}<button disabled={loading}>{loading ? "Đang đăng nhập..." : "Đăng nhập"}</button></form></main>;
}
