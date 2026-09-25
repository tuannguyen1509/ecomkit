import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@ecomkit/database";
import { AuthService } from "./auth.service.js";

const prefix = "stage12_auth_test_";
const password = "Stage12AuthPass!";
const authService = new AuthService();

async function run(): Promise<void> {
  await prisma.session.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });

  try {
    await assert.rejects(() => authService.hashPassword("too-short"), /Password must be at least 10 characters/);
    const firstHash = await authService.hashPassword(password);
    const secondHash = await authService.hashPassword(password);
    assert.notEqual(firstHash, secondHash, "random salts must create distinct password hashes");
    assert.equal(firstHash.includes(password), false, "stored hash must not include plaintext password");
    assert.equal(await authService.verifyPassword(password, firstHash), true);
    assert.equal(await authService.verifyPassword("wrong password", firstHash), false);
    assert.equal(await authService.verifyPassword(password, "malformed"), false);

    const user = await prisma.user.create({
      data: {
        username: `${prefix}user`,
        displayName: "Stage 12 Technical User",
        passwordHash: firstHash,
        role: "USER"
      }
    });

    const login = await authService.login(user.username.toUpperCase(), password);
    assert.equal(login.user.role, "USER", "login must normalize username and retain DB role");
    assert.equal(login.token.length >= 43, true, "session token must be generated from 32 random bytes");

    const tokenHash = createHash("sha256").update(login.token).digest("hex");
    const session = await prisma.session.findUnique({ where: { tokenHash } });
    assert.ok(session, "login must create a database session");
    assert.notEqual(session.tokenHash, login.token, "database must store only token hash");
    assert.equal(JSON.stringify(session).includes(login.token), false, "raw token must not be persisted");
    assert.equal((await authService.getSessionByRawToken(login.token))?.user.id, user.id);

    await authService.invalidateSession(login.token);
    assert.equal(await authService.getSessionByRawToken(login.token), null, "logout must invalidate the session");

    const expiredToken = randomBytes(32).toString("base64url");
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createHash("sha256").update(expiredToken).digest("hex"),
        expiresAt: new Date(Date.now() - 1_000)
      }
    });
    assert.equal(await authService.getSessionByRawToken(expiredToken), null, "expired session must not authorize");

    const inactiveLogin = await authService.login(user.username, password);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal(await authService.getSessionByRawToken(inactiveLogin.token), null, "inactive user must lose existing session authorization");

    await assert.rejects(() => authService.login(user.username, password), /Invalid username or password/);
    await assert.rejects(() => authService.login(`${prefix}missing`, password), /Invalid username or password/);

    console.log("auth integration test passed");
  } finally {
    await prisma.session.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "auth integration test failed");
  process.exitCode = 1;
});
