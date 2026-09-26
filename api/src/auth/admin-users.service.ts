import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma, type UserRole } from "@ecomkit/database";
import { AuthService } from "./auth.service.js";
import type { CreateAdminUserDto, ResetAdminUserPasswordDto, UpdateAdminUserDto } from "./admin-users.dto.js";

const safeUserSelect = {
  id: true, username: true, displayName: true, role: true, isActive: true, createdAt: true, updatedAt: true
} satisfies Prisma.UserSelect;

export type AdminManagedUser = Prisma.UserGetPayload<{ select: typeof safeUserSelect }>;

export function assertLastActiveAdminSafety(
  user: { role: UserRole; isActive: boolean },
  input: Pick<UpdateAdminUserDto, "role" | "isActive">,
  activeAdminCount: number
): void {
  const removesActiveAdmin = user.role === "ADMIN" && user.isActive && (input.role === "USER" || input.isActive === false);
  if (removesActiveAdmin && activeAdminCount <= 1) {
    throw new ConflictException({ errorCode: "LAST_ACTIVE_ADMIN_REQUIRED", message: "At least one active ADMIN is required." });
  }
}

@Injectable()
export class AdminUsersService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async list(): Promise<AdminManagedUser[]> {
    return prisma.user.findMany({ select: safeUserSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }

  async create(input: CreateAdminUserDto): Promise<AdminManagedUser> {
    const username = this.authService.normalizeUsername(input.username);
    if (!username) throw new BadRequestException({ errorCode: "USERNAME_INVALID", message: "Username is required." });
    try {
      return await prisma.user.create({
        data: {
          username,
          displayName: input.displayName.trim(),
          passwordHash: await this.authService.hashPassword(input.password),
          role: input.role,
          isActive: true
        },
        select: safeUserSelect
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({ errorCode: "USERNAME_ALREADY_EXISTS", message: "Username already exists." });
      }
      throw error;
    }
  }

  async update(actorId: string, userId: string, input: UpdateAdminUserDto): Promise<AdminManagedUser> {
    if (input.displayName === undefined && input.role === undefined && input.isActive === undefined) {
      throw new BadRequestException({ errorCode: "USER_UPDATE_EMPTY", message: "At least one user field is required." });
    }
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException({ errorCode: "USER_NOT_FOUND", message: "User was not found." });
      if (actorId === user.id && input.isActive === false) {
        throw new ConflictException({ errorCode: "CANNOT_DEACTIVATE_SELF", message: "An administrator cannot deactivate their own account." });
      }
      if (actorId === user.id && input.role !== undefined && input.role !== user.role) {
        throw new ConflictException({ errorCode: "CANNOT_CHANGE_OWN_ROLE", message: "An administrator cannot change their own role." });
      }
      if (user.role === "ADMIN" && user.isActive && (input.role === "USER" || input.isActive === false)) {
        const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
        assertLastActiveAdminSafety(user, input, activeAdmins);
      }
      const roleChanged = input.role !== undefined && input.role !== user.role;
      const deactivated = input.isActive === false && user.isActive;
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
        },
        select: safeUserSelect
      });
      if (roleChanged || deactivated) await this.authService.revokeAllSessions(user.id, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async resetPassword(userId: string, input: ResetAdminUserPasswordDto): Promise<{ ok: true }> {
    const passwordHash = await this.authService.hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new NotFoundException({ errorCode: "USER_NOT_FOUND", message: "User was not found." });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.authService.revokeAllSessions(user.id, tx);
    });
    return { ok: true };
  }
}
