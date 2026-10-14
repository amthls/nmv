import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { clientDbError } from '../utils/db-errors';
import { InputError } from '../utils/validation';

/** One error shape for the whole API, as the old Express handlers: {success:false,message}. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (err instanceof NotFoundException && /^Cannot [A-Z]+ /.test(err.message)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy.' });
    }
    if (err instanceof InputError) return res.status(err.status).json({ success: false, message: err.message });
    if (err instanceof HttpException) {
      // guards throw the exact body the old middleware sent
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'object' && body !== null && 'success' in body ? body : { success: false, message: err.message });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Nội dung quá lớn.' });
    this.unexpected(err, res);
  }

  /** What an unexpected error answers: the old global handler's message. */
  protected unexpected(err: any, res: Response) {
    console.error('[community] request failed:', err?.stack || err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }
}

/** Posts, comments, reports, moderation: an unexpected error answers 500 with its own message (as their handlers did). */
@Catch()
export class ExposeMessageFilter extends HttpExceptionFilter {
  protected unexpected(err: any, res: Response) {
    console.error('[community] request error:', err?.stack || err);
    res.status(500).json({ success: false, message: err?.message });
  }
}

/** Posts: a database error caused by client input (bad uuid, unknown story...) answers 4xx first. */
@Catch()
export class ClientDbErrorFilter extends HttpExceptionFilter {
  protected unexpected(err: any, res: Response) {
    const clientErr = clientDbError(err);
    if (clientErr) return void res.status(clientErr.status).json({ success: false, message: clientErr.message });
    console.error('[community] request error:', err?.stack || err);
    res.status(500).json({ success: false, message: err?.message });
  }
}
