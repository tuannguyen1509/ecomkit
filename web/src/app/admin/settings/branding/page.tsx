"use client";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo, useBranding } from "../../../../components/branding";
import { useCurrentUser } from "../../../../components/auth-shell";
import {
  Alert,
  Button,
  Card,
  Field,
  PageHeader,
  SectionHeader,
} from "../../../../components/ui/ui";
import { apiFetch } from "../../../../lib/api";
import styles from "./branding.module.css";
export default function BrandingPage() {
  const user = useCurrentUser(),
    router = useRouter(),
    { branding, reload } = useBranding();
  const [name, setName] = useState(branding.name),
    [subtitle, setSubtitle] = useState(branding.subtitle),
    [logo, setLogo] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{
      tone: "success" | "danger";
      text: string;
    } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setName(branding.name);
      setSubtitle(branding.subtitle);
    }, 0);
    return () => clearTimeout(timer);
  }, [branding]);
  useEffect(() => {
    if (user && user.role !== "ADMIN") router.replace("/");
  }, [user, router]);
  if (user?.role !== "ADMIN") return null;
  const safeError = async (response: Response) => {
    const body = (await response.json().catch(() => null)) as {
      errorCode?: string;
    } | null;
    return body?.errorCode ?? "BRANDING_UPDATE_FAILED";
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiFetch("/admin/settings/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, subtitle }),
      });
      if (!response.ok) throw new Error(await safeError(response));
      if (logo) {
        const form = new FormData();
        form.append("logo", logo);
        const upload = await apiFetch("/admin/settings/branding/logo", {
          method: "POST",
          body: form,
        });
        if (!upload.ok) throw new Error(await safeError(upload));
      }
      await reload();
      setLogo(null);
      setMessage({ tone: "success", text: "Đã lưu thương hiệu hệ thống." });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "BRANDING_UPDATE_FAILED",
      });
    } finally {
      setBusy(false);
    }
  };
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setLogo(file);
  };
  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Cài đặt hệ thống"
        title="Thương hiệu hệ thống"
        description="Quản lý logo và tên hiển thị thống nhất trên trang đăng nhập và thanh điều hướng."
      />
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Card className={styles.card}>
        <SectionHeader
          title="Nhận diện Ecomkit"
          description="PNG, JPG hoặc WEBP; tối đa 2 MB. SVG chưa được hỗ trợ vì yêu cầu an toàn nội dung."
        />
        <form onSubmit={save}>
          <div className={styles.preview}>
            <BrandLogo
              className={styles.logo}
              fallbackClassName={styles.fallback}
            />
            <div>
              <strong>{branding.name}</strong>
              <span>{branding.subtitle}</span>
            </div>
          </div>
          <Field
            label="Logo"
            helper="Ảnh được kiểm tra định dạng và lưu bằng tên an toàn do server tạo."
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={pick}
            />
          </Field>
          <Field label="Tên hệ thống">
            <input
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Tên phụ">
            <input
              value={subtitle}
              maxLength={120}
              onChange={(event) => setSubtitle(event.target.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" loading={busy}>
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
