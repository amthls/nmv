import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { AuthenticatedRequest, internalAuthOK, identityFromHeaders, loadUser } from '../../middlewares/auth.middleware';

/**
 * Who is calling, the Nest way. Same rules and messages as requireAuth / optionalAuth / requireRole and the
 * /internal checks in middlewares/auth.middleware.ts (they share loadUser and the signature checks).
 */

const fail = (status: number, body: Record<string, unknown>) => new HttpException(body, status);

/** requireAuth: a signed-in, not banned/deleted user (req.user), else 401/403. */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    let found;
    try {
      found = await loadUser(req);
    } catch (error: any) {
      console.error('Auth middleware error:', error);
      throw fail(500, { success: false, message: 'Lỗi xác thực hệ thống: ' + error.message });
    }
    if (found.blocked) throw fail(403, { success: false, message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.' });
    if (!found.user) throw fail(401, { success: false, message: 'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.' });
    req.user = found.user;
    return true;
  }
}

/** optionalAuth: req.user when signed in, a guest otherwise; never refuses. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      const { user } = await loadUser(req);
      if (user) req.user = user;
    } catch (err: any) {
      console.warn('optionalAuth:', err.message);
    }
    return true;
  }
}

/** requireRole(...roles), after AuthGuard: admin or one of the roles. */
export function RolesGuard(...roles: string[]): CanActivate {
  return {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
      if (!req.user) throw fail(401, { success: false, message: 'Bạn chưa đăng nhập.' });
      const userRoles = req.user.roles || [];
      if (userRoles.includes('admin') || roles.some((role) => userRoles.includes(role))) return true;
      throw fail(403, { success: false, message: 'Bạn không có quyền thực hiện hành động này. Yêu cầu quyền: ' + roles.join(', ') });
    },
  };
}

/** Service-to-service routes (/internal/*): a valid X-Internal-Auth signed with INTERNAL_KEY_CATALOG, else 401 {success:false}. */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!internalAuthOK(req.get('x-internal-auth'))) throw fail(401, { success: false });
    return true;
  }
}

/** Calls from identity carrying the gateway-style signed X-User-* headers, else 401 {ok:false}. */
@Injectable()
export class IdentityHeaderGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!identityFromHeaders(req.headers)) throw fail(401, { ok: false });
    return true;
  }
}
