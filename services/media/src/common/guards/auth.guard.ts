import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { userFromHeaders } from '../utils/auth';

export type AuthedRequest = Request & { userId?: string };

/** requireAuth: a caller with valid signed X-User-* headers (req.userId), else 401. */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.userId = userFromHeaders(req) || undefined;
    if (!req.userId) throw new HttpException({ success: false, message: 'Bạn chưa đăng nhập.' }, 401);
    return true;
  }
}

/** optionalAuth: req.userId when signed in, a guest otherwise; never refuses. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.userId = userFromHeaders(req) || undefined;
    return true;
  }
}
