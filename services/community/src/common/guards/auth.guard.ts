import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { AuthedRequest, internalAuthOK, userFromHeaders } from '../utils/auth';

/** requireAuth: a caller with valid signed X-User-* headers (req.user), else 401. */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.user = userFromHeaders(req) || undefined;
    if (!req.user) throw new HttpException({ success: false, message: 'Bạn chưa đăng nhập.' }, 401);
    return true;
  }
}

/** optionalAuth: req.user when signed in, a guest otherwise; never refuses. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.user = userFromHeaders(req) || undefined;
    return true;
  }
}

/** Calls to /internal/*: a valid X-Internal-Auth signed with INTERNAL_KEY_COMMUNITY, else 401 {success:false}. */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!internalAuthOK(req.get('x-internal-auth'))) throw new HttpException({ success: false }, 401);
    return true;
  }
}
