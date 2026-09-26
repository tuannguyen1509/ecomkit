"use client";

import Link from "next/link";
import { useCurrentUser } from "../components/auth-shell";
import styles from "./home.module.css";

export default function HomePage() {
  const user = useCurrentUser();
  return <main className={styles.page}>
    <p className={styles.kicker}>Ecomkit - Vui Khỏe</p>
    <h1>Chào {user?.displayName || user?.username}</h1>
    <p className={styles.intro}>Bắt đầu một phiên xử lý mới, theo dõi lịch sử hoặc kiểm tra kết quả đối chiếu.</p>
    <section className={styles.cards}>
      <Link href="/batches/new"><strong>Xử lý đơn hàng</strong><span>Tạo Batch, tải Excel/PDF và theo dõi xử lý.</span></Link>
      <Link href="/history"><strong>Lịch sử xử lý</strong><span>Xem lại kết quả, cảnh báo và lỗi theo Batch.</span></Link>
      {user?.role === "ADMIN" && <Link href="/admin/users"><strong>Quản lý tài khoản</strong><span>Tạo, cập nhật, vô hiệu hóa và đặt lại mật khẩu.</span></Link>}
    </section>
  </main>;
}
