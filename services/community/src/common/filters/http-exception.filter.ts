import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

/** One error shape for the whole API, as the old Express handlers: {success:false,message}. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (err instanceof NotFoundException && /^Cannot [A-Z]+ /.test(err.message)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy.' });
    }
    if (err instanceof HttpException) {
      // guards throw the exact body the old middleware sent
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'object' && body !== null && 'success' in body ? body : { success: false, message: err.message });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Nội dung quá lớn.' });
    console.error('[community] request failed:', err?.stack || err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }
}
