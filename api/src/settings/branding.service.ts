import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, type Prisma } from "@ecomkit/database";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const KEY = "branding";
const DEFAULT = {
  name: "Ecomkit",
  subtitle: "Vui Khỏe",
  logoPath: null as string | null,
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, { extension: string; signatures: number[][] }> = {
  "image/png": {
    extension: ".png",
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  "image/jpeg": { extension: ".jpg", signatures: [[0xff, 0xd8, 0xff]] },
  "image/webp": { extension: ".webp", signatures: [[0x52, 0x49, 0x46, 0x46]] },
};
export type SafeBranding = {
  name: string;
  subtitle: string;
  logoUrl: string | null;
  updatedAt: string | null;
};

function storageRoot(): string {
  return resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage", "branding");
}
function inside(root: string, candidate: string): void {
  if (!candidate.startsWith(`${root}${sep}`))
    throw new BadRequestException({
      errorCode: "BRANDING_LOGO_PATH_INVALID",
      message: "Invalid logo path.",
    });
}
function value(input: unknown): typeof DEFAULT {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return DEFAULT;
  const item = input as Record<string, unknown>;
  return {
    name:
      typeof item.name === "string" && item.name.trim()
        ? item.name
        : DEFAULT.name,
    subtitle:
      typeof item.subtitle === "string" ? item.subtitle : DEFAULT.subtitle,
    logoPath: typeof item.logoPath === "string" ? item.logoPath : null,
  };
}

@Injectable()
export class BrandingService {
  async get(): Promise<SafeBranding> {
    const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
    const branding = value(row?.value);
    return {
      name: branding.name,
      subtitle: branding.subtitle,
      logoUrl: branding.logoPath ? "/branding/logo" : null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
  async update(
    userId: string,
    input: { name: string; subtitle: string },
  ): Promise<SafeBranding> {
    const current = await prisma.systemSetting.findUnique({
      where: { key: KEY },
    });
    const branding = value(current?.value);
    await prisma.systemSetting.upsert({
      where: { key: KEY },
      create: {
        key: KEY,
        value: {
          ...branding,
          name: input.name.trim(),
          subtitle: input.subtitle.trim(),
        } as Prisma.InputJsonValue,
        updatedById: userId,
      },
      update: {
        value: {
          ...branding,
          name: input.name.trim(),
          subtitle: input.subtitle.trim(),
        } as Prisma.InputJsonValue,
        updatedById: userId,
      },
    });
    return this.get();
  }
  async upload(
    userId: string,
    file?: Express.Multer.File,
  ): Promise<SafeBranding> {
    if (!file)
      throw new BadRequestException({
        errorCode: "BRANDING_LOGO_REQUIRED",
        message: "Logo file is required.",
      });
    const type = TYPES[file.mimetype];
    const supplied = extname(file.originalname).toLowerCase();
    if (
      !type ||
      file.size > MAX_LOGO_BYTES ||
      !type.signatures.some((signature) =>
        signature.every((byte, index) => file.buffer[index] === byte),
      ) ||
      !(
        supplied === type.extension ||
        (type.extension === ".jpg" && supplied === ".jpeg")
      )
    )
      throw new BadRequestException({
        errorCode: "BRANDING_LOGO_INVALID",
        message: "Logo must be a valid PNG, JPG, or WEBP file up to 2 MB.",
      });
    if (
      file.mimetype === "image/webp" &&
      file.buffer.toString("ascii", 8, 12) !== "WEBP"
    )
      throw new BadRequestException({
        errorCode: "BRANDING_LOGO_INVALID",
        message: "Invalid WEBP logo.",
      });
    const root = storageRoot();
    await mkdir(root, { recursive: true });
    const filename = `${randomUUID()}${type.extension}`;
    const finalPath = resolve(root, filename);
    inside(root, finalPath);
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, file.buffer);
    await rename(tempPath, finalPath);
    const current = await prisma.systemSetting.findUnique({
      where: { key: KEY },
    });
    const branding = value(current?.value);
    try {
      await prisma.systemSetting.upsert({
        where: { key: KEY },
        create: {
          key: KEY,
          value: { ...branding, logoPath: filename } as Prisma.InputJsonValue,
          updatedById: userId,
        },
        update: {
          value: { ...branding, logoPath: filename } as Prisma.InputJsonValue,
          updatedById: userId,
        },
      });
    } catch (error) {
      await rm(finalPath, { force: true });
      throw error;
    }
    if (branding.logoPath) {
      const oldPath = resolve(root, branding.logoPath);
      inside(root, oldPath);
      await rm(oldPath, { force: true }).catch(() => undefined);
    }
    return this.get();
  }
  async logo(): Promise<{
    stream: ReturnType<typeof createReadStream>;
    mime: string;
  }> {
    const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
    const logoPath = value(row?.value).logoPath;
    if (!logoPath)
      throw new NotFoundException({
        errorCode: "BRANDING_LOGO_NOT_FOUND",
        message: "Logo not configured.",
      });
    const root = storageRoot(),
      path = resolve(root, logoPath);
    inside(root, path);
    const extension = extname(path);
    const mime =
      extension === ".png"
        ? "image/png"
        : extension === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return { stream: createReadStream(path), mime };
  }
}
