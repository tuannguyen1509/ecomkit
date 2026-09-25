import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "./auth.decorators.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { AuthService, type SafeUser } from "./auth.service.js";

const SESSION_COOKIE = "ecomkit_session";

function sessionToken(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(`${SESSION_COOKIE}=`.length);
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private sessionCookieOptions(): { httpOnly: true; sameSite: "lax"; path: "/"; secure: boolean; maxAge: number } {
    return {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: this.authService.sessionTtlHours() * 60 * 60 * 1000
    };
  }

  @Post("login")
  @HttpCode(200)
  @Public()
  async login(@Body() body: { username?: string; password?: string }, @Res({ passthrough: true }) response: Response): Promise<{ user: SafeUser }> {
    const result = await this.authService.login(body.username ?? "", body.password ?? "");
    response.cookie(SESSION_COOKIE, result.token, this.sessionCookieOptions());
    return { user: result.user };
  }

  @Get("me")
  async me(@Req() request: AuthenticatedRequest): Promise<SafeUser> {
    if (!request.authUser) throw new UnauthorizedException({ errorCode: "AUTH_REQUIRED", message: "Authentication required." });
    return request.authUser;
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    await this.authService.invalidateSession(sessionToken(request));
    response.clearCookie(SESSION_COOKIE, this.sessionCookieOptions());
    return { ok: true };
  }
}
