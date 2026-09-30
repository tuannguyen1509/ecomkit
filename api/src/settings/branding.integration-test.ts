import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma, UserRole } from "@ecomkit/database";
import { BrandingAdminController } from "./branding.controller.js";
import { BrandingService } from "./branding.service.js";

const root = await mkdtemp(join(tmpdir(), "ecomkit-branding-"));
process.env.UPLOAD_STORAGE_ROOT = root;
const user = await prisma.user.create({
  data: {
    username: `branding-${Date.now()}`,
    displayName: "Branding test",
    passwordHash: "test",
    role: UserRole.ADMIN,
  },
});
try {
  await prisma.systemSetting.deleteMany({ where: { key: "branding" } });
  const service = new BrandingService();
  assert.deepEqual(await service.get(), {
    name: "Ecomkit",
    subtitle: "Vui Khỏe",
    logoUrl: null,
    updatedAt: null,
  });
  const updated = await service.update(user.id, {
    name: "Ecomkit Test",
    subtitle: "Vui Khỏe Test",
  });
  assert.equal(updated.name, "Ecomkit Test");
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const withLogo = await service.upload(user.id, {
    fieldname: "logo",
    originalname: "logo.png",
    encoding: "7bit",
    mimetype: "image/png",
    size: png.length,
    buffer: png,
    destination: "",
    filename: "",
    path: "",
    stream: null as never,
  });
  assert.equal(withLogo.logoUrl, "/branding/logo");
  const row = await prisma.systemSetting.findUniqueOrThrow({
    where: { key: "branding" },
  });
  assert.equal((row.value as { name: string }).name, "Ecomkit Test");
  assert.equal(
    JSON.stringify(row.value).includes("logo.png"),
    false,
    "untrusted original filename persisted",
  );
  await assert.rejects(
    () =>
      service.upload(user.id, {
        fieldname: "logo",
        originalname: "bad.exe",
        encoding: "7bit",
        mimetype: "image/png",
        size: 3,
        buffer: Buffer.from("MZ"),
        destination: "",
        filename: "",
        path: "",
        stream: null as never,
      }),
    /Logo must be/,
  );
  const roles = Reflect.getMetadata(
    "ecomkit:roles",
    BrandingAdminController,
  ) as UserRole[];
  assert.deepEqual(roles, [UserRole.ADMIN]);
  console.log("Branding settings integration tests passed");
} finally {
  await prisma.systemSetting.deleteMany({ where: { key: "branding" } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
}
