import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { prisma } from "@ecomkit/database";
import { ALLOW_INTERNAL_WORKER_KEY, IS_PUBLIC_KEY, ROLES_KEY } from "./auth.decorators.js";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { RolesGuard } from "./roles.guard.js";

const prefix = "stage12_guard_test_";
const password = "Stage12GuardPass!";
const authService = new AuthService();

function context(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

function reflector(metadata: Record<string, unknown>) {
  return { getAllAndOverride: (key: string) => metadata[key] } as any;
}

async function rejectsUnauthorized(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401);
}

async function run(): Promise<void> {
  const priorWorkerKey = process.env.WORKER_INTERNAL_API_KEY;
  process.env.WORKER_INTERNAL_API_KEY = "stage12-focused-worker-key";
  await prisma.session.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });

  try {
    const user = await prisma.user.create({ data: { username: `${prefix}user`, displayName: "Guard User", passwordHash: await authService.hashPassword(password), role: "USER" } });
    const admin = await prisma.user.create({ data: { username: `${prefix}admin`, displayName: "Guard Admin", passwordHash: await authService.hashPassword(password), role: "ADMIN" } });
    const publicGuard = new AuthGuard(reflector({ [IS_PUBLIC_KEY]: true }), authService);
    assert.equal(await publicGuard.canActivate(context({})), true, "public route must bypass authentication");

    const login = await authService.login(user.username, password);
    const request = { headers: { cookie: `ecomkit_session=${login.token}` } } as unknown as AuthenticatedRequest;
    const sessionGuard = new AuthGuard(reflector({}), authService);
    assert.equal(await sessionGuard.canActivate(context(request)), true, "valid session must authorize");
    assert.deepEqual(Object.keys(request.authUser ?? {}).sort(), ["displayName", "id", "role", "username"]);
    await rejectsUnauthorized(() => sessionGuard.canActivate(context({ headers: {} } as AuthenticatedRequest)));

    const expiredToken = randomBytes(32).toString("base64url");
    await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(expiredToken).digest("hex"), expiresAt: new Date(Date.now() - 1_000) } });
    await rejectsUnauthorized(() => sessionGuard.canActivate(context({ headers: { cookie: `ecomkit_session=${expiredToken}` } } as unknown as AuthenticatedRequest)));

    const inactiveLogin = await authService.login(user.username, password);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await rejectsUnauthorized(() => sessionGuard.canActivate(context({ headers: { cookie: `ecomkit_session=${inactiveLogin.token}` } } as unknown as AuthenticatedRequest)));

    const workerGuard = new AuthGuard(reflector({ [ALLOW_INTERNAL_WORKER_KEY]: true }), authService);
    const workerRequest = { headers: { "x-ecomkit-worker-key": process.env.WORKER_INTERNAL_API_KEY } } as unknown as AuthenticatedRequest;
    assert.equal(await workerGuard.canActivate(context(workerRequest)), true, "valid Worker key must authorize internal route");
    assert.equal(workerRequest.isInternalWorker, true);
    await rejectsUnauthorized(() => workerGuard.canActivate(context({ headers: { "x-ecomkit-worker-key": "wrong" } } as unknown as AuthenticatedRequest)));
    await rejectsUnauthorized(() => workerGuard.canActivate(context({ headers: {} } as AuthenticatedRequest)));
    await rejectsUnauthorized(() => sessionGuard.canActivate(context({ headers: { "x-ecomkit-worker-key": process.env.WORKER_INTERNAL_API_KEY } } as unknown as AuthenticatedRequest)));

    const roleGuard = new RolesGuard(reflector({ [ROLES_KEY]: ["ADMIN"] }));
    assert.equal(roleGuard.canActivate(context({ authUser: authService.safeUser(admin) })), true);
    assert.throws(() => roleGuard.canActivate(context({ authUser: authService.safeUser({ ...user, role: "USER" }) })), (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403);
    assert.throws(() => roleGuard.canActivate(context({})), (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401);
    assert.equal(new RolesGuard(reflector({})).canActivate(context({ authUser: authService.safeUser(admin) })), true);
    console.log("auth guards integration test passed");
  } finally {
    if (priorWorkerKey === undefined) delete process.env.WORKER_INTERNAL_API_KEY;
    else process.env.WORKER_INTERNAL_API_KEY = priorWorkerKey;
    await prisma.session.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "auth guard integration test failed");
  process.exitCode = 1;
});
