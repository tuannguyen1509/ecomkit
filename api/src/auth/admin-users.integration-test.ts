import assert from "node:assert/strict";
import { prisma } from "@ecomkit/database";
import { AdminUsersService, assertLastActiveAdminSafety } from "./admin-users.service.js";
import { AuthService } from "./auth.service.js";

const prefix = "stage12_admin_test_";
const password = "Stage12AdminPass!";
const changedPassword = "Stage12ChangedPass!";
const auth = new AuthService();
const users = new AdminUsersService(auth);

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { errorCode?: string } }).response?.errorCode
    : undefined;
}

async function rejectsWithCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => errorCode(error) === code);
}

async function run(): Promise<void> {
  await prisma.session.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
  try {
    const admin = await users.create({ username: `${prefix}admin`, displayName: "Admin", password, role: "ADMIN" });
    const secondAdmin = await users.create({ username: `${prefix}admin_two`, displayName: "Admin Two", password, role: "ADMIN" });
    const user = await users.create({ username: `${prefix}user`, displayName: "User", password, role: "USER" });
    assert.equal(user.isActive, true);
    assert.equal("passwordHash" in user, false, "safe user response must omit hashes");
    assert.equal(JSON.stringify(user).includes(password), false, "safe user response must omit plaintext passwords");
    await rejectsWithCode(() => users.create({ username: ` ${prefix.toUpperCase()}USER `, displayName: "Duplicate", password, role: "USER" }), "USERNAME_ALREADY_EXISTS");

    const listed = await users.list();
    assert.equal(listed.filter((item) => item.username.startsWith(prefix)).length, 3);
    assert.equal(listed.some((item) => "passwordHash" in item), false);
    await rejectsWithCode(() => users.update(admin.id, "missing-user", { displayName: "Missing" }), "USER_NOT_FOUND");
    await rejectsWithCode(() => users.resetPassword("missing-user", { newPassword: changedPassword }), "USER_NOT_FOUND");
    assert.equal((await users.update(admin.id, user.id, { displayName: "Updated User" })).displayName, "Updated User");

    const oldRoleSession = await auth.login(user.username, password);
    await users.update(admin.id, user.id, { role: "ADMIN" });
    assert.equal(await auth.getSessionByRawToken(oldRoleSession.token), null, "role change must revoke sessions");
    assert.equal((await auth.login(user.username, password)).user.role, "ADMIN");

    const activeSession = await auth.login(user.username, password);
    await users.update(admin.id, user.id, { isActive: false });
    assert.equal(await auth.getSessionByRawToken(activeSession.token), null, "deactivation must revoke sessions");
    await rejectsWithCode(() => auth.login(user.username, password), "AUTH_INVALID_CREDENTIALS");
    await users.update(admin.id, user.id, { isActive: true });
    assert.equal((await auth.login(user.username, password)).user.id, user.id);

    const resetSession = await auth.login(user.username, password);
    await users.resetPassword(user.id, { newPassword: changedPassword });
    assert.equal(await auth.getSessionByRawToken(resetSession.token), null, "password reset must revoke sessions");
    await rejectsWithCode(() => auth.login(user.username, password), "AUTH_INVALID_CREDENTIALS");
    assert.equal((await auth.login(user.username, changedPassword)).user.id, user.id);

    await rejectsWithCode(() => users.update(admin.id, admin.id, { isActive: false }), "CANNOT_DEACTIVATE_SELF");
    await rejectsWithCode(() => users.update(admin.id, admin.id, { role: "USER" }), "CANNOT_CHANGE_OWN_ROLE");

    assert.throws(() => assertLastActiveAdminSafety({ role: "ADMIN", isActive: true }, { isActive: false }, 1), (error: unknown) => errorCode(error) === "LAST_ACTIVE_ADMIN_REQUIRED");
    assert.throws(() => assertLastActiveAdminSafety({ role: "ADMIN", isActive: true }, { role: "USER" }, 1), (error: unknown) => errorCode(error) === "LAST_ACTIVE_ADMIN_REQUIRED");
    assert.doesNotThrow(() => assertLastActiveAdminSafety({ role: "ADMIN", isActive: true }, { isActive: false }, 2));
    console.log("admin users integration test passed");
  } finally {
    await prisma.session.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "admin users integration test failed");
  process.exitCode = 1;
});
