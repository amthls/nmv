import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { InputError } from '../utils/errors';

const UPLOAD_ERRORS: Record<string, string> = {
  LIMIT_FILE_SIZE: 'Có ảnh nặng quá 25 MB. Hãy giảm dung lượng ảnh rồi tải lại.',
  LIMIT_FILE_COUNT: 'Gửi quá nhiều ảnh trong một lần.',
  LIMIT_UNEXPECTED_FILE: 'Trường tải lên không hợp lệ.',
  LIMIT_PART_COUNT: 'Yêu cầu tải lên có quá nhiều phần.',
};

/** One error shape for the whole API, as the old Express handlers: {success:false,message}. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (err instanceof NotFoundException && /^Cannot [A-Z]+ /.test(err.message)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy.' });
    }
    // Upload problems are for the client to fix: answer 400 with a message they can act on
    if (err?.name === 'MulterError' || /^Chỉ chấp nhận/.test(err?.message || '')) {
      return res.status(400).json({ success: false, message: UPLOAD_ERRORS[err.code] || err.message });
    }
    if (err instanceof InputError) return res.status(err.status).json({ success: false, message: err.message });
    if (err instanceof HttpException) {
      // guards throw the exact body the old middleware sent
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'object' && body !== null && 'success' in body ? body : { success: false, message: err.message });
    }
    this.unexpected(err, res);
  }

  /** What an unexpected error answers: the message of the old global handler. */
  protected unexpected(err: any, res: Response) {
    console.error('[media] request failed:', err?.stack || err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }
}

/** Upload handlers answered an unexpected error with 500 and its own message. */
@Catch()
export class ExposeMessageFilter extends HttpExceptionFilter {
  protected unexpected(err: any, res: Response) {
    console.error('[media] request error:', err?.stack || err);
    res.status(500).json({ success: false, message: err?.message });
  }
}
