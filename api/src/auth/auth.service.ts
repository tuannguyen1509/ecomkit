import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma, type UserRole } from "@ecomkit/database";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 10;
const DEFAULT_SESSION_TTL_HOURS = 12;

export type SafeUser = { id: string; username: string; displayName: string; role: UserRole };

@Injectable()
export class AuthService {
  normalizeUsername(username: string): string { return username.trim().toLowerCase(); }

  sessionTtlHours(): number {
    const configured = Number(process.env.AUTH_SESSION_TTL_HOURS ?? DEFAULT_SESSION_TTL_HOURS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_TTL_HOURS;
  }

  async hashPassword(password: string): Promise<string> {
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw new BadRequestException({ errorCode: "AUTH_PASSWORD_INVALID", message: "Password must be at least 10 characters." });
    }
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
  }

  async verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    try {
      const [algorithm, saltText, keyText] = encodedHash.split("$");
      if (algorithm !== "scrypt" || !saltText || !keyText) return false;
      const expected = Buffer.from(keyText, "base64url");
      const actual = (await scrypt(password, Buffer.from(saltText, "base64url"), expected.length)) as Buffer;
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch { return false; }
  }

  safeUser(user: { id: string; username: string; displayName: string; role: UserRole }): SafeUser {
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  }

  async login(username: string, password: string): Promise<{ token: string; user: SafeUser }> {
    const user = await prisma.user.findUnique({ where: { username: this.normalizeUsername(username) } });
    const passwordMatches = user ? await this.verifyPassword(password, user.passwordHash) : false;
    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException({ errorCode: "AUTH_INVALID_CREDENTIALS", message: "Invalid username or password." });
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await prisma.session.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + this.sessionTtlHours() * 60 * 60 * 1000) } });
    return { token, user: this.safeUser(user) };
  }

  async getSessionByRawToken(token?: string): Promise<{ user: SafeUser; tokenHash: string } | null> {
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
      if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    return { user: this.safeUser(session.user), tokenHash };
  }

  async invalidateSession(token?: string): Promise<void> {
    if (!token) return;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await prisma.session.deleteMany({ where: { tokenHash } });
  }

  async bootstrapFirstAdmin(): Promise<boolean> {
    if (await prisma.user.findFirst({ where: { role: "ADMIN" } })) return false;
    const username = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "";
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
    const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME ?? username;
    if (!username || !password) throw new Error("BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD are required.");
    await prisma.user.create({ data: { username: this.normalizeUsername(username), displayName, passwordHash: await this.hashPassword(password), role: "ADMIN" } });
    return true;
  }
}
