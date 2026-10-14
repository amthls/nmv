import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../guards/auth.guard';

/** The id of the signed-in user set by AuthGuard / OptionalAuthGuard (undefined for a guest). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<AuthedRequest>().userId);
