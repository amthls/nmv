import { CanActivate, ExecutionContext } from '@nestjs/common';
import type { RequestHandler } from 'express';

/**
 * Runs existing Express middleware (cacheJson, rate limiters) as a guard, so it keeps its place after the
 * auth guard, as in the old routes: @UseGuards(AuthGuard, Mw(joinRequestLimiter)).
 * Middleware that answers by itself (429, cache HIT) ends the request: the guard returns false and the
 * exception filter sees the response already sent and does nothing.
 */
export function Mw(...middleware: RequestHandler[]): CanActivate {
  return {
    async canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const res = ctx.switchToHttp().getResponse();
      for (const mw of middleware) {
        let passed = false;
        let failure: unknown;
        await new Promise<void>((resolve) => {
          const next = (err?: unknown) => {
            passed = !err;
            failure = err;
            resolve();
          };
          Promise.resolve(mw(req, res, next)).then(() => {
            if (res.headersSent) resolve();
          }, (err) => next(err));
          res.once('finish', () => resolve());
        });
        if (failure) throw failure;
        if (!passed) return false;
      }
      return true;
    },
  };
}
