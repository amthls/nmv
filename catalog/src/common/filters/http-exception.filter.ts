import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InputError } from '../../utils/validation';

/**
 * One error shape for the whole API: {success: false, message}. Catches errors of Nest routes and of the legacy
 * Express routers mounted on the same app (their next(err)), and answers unknown routes like the old 404 handler.
 * 5xx details are masked in production by maskServerErrors (middlewares/security.ts).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) return;

    if (err instanceof NotFoundException && /^Cannot [A-Z]+ /.test(err.message)) {
      return res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
    }
    if (err instanceof InputError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    if (err instanceof HttpException) {
      // guards throw the exact body the old middleware sent ({success:false,message}, {ok:false}...)
      const body = err.getResponse();
      const exact = typeof body === 'object' && body !== null && ('success' in body || 'ok' in body);
      return res.status(err.getStatus()).json(exact ? body : { success: false, message: err.message });
    }
    console.error('[Express Global Error]', err);
    res.status(err?.status || 500).json({
      success: false,
      message: err?.message || 'Lỗi hệ thống máy chủ nội bộ',
    });
  }
}
