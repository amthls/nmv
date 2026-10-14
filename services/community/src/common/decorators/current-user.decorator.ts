import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../utils/auth';

/** The signed-in user set by AuthGuard / OptionalAuthGuard (undefined for a guest). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<AuthedRequest>().user);
