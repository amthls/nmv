import { Body, Controller, HttpCode, Post, Res, UploadedFile, UploadedFiles, UseFilters, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExposeMessageFilter } from '../../common/filters/http-exception.filter';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { mangaUploadLimiter, uploadLimiter } from '../../common/utils/auth';
import { uploadImages, uploadMangaPageFiles } from './multer';
import { UploadService } from './upload.service';

/** multer (same limits, field names and messages as before) runs as a guard after auth and the rate limit, as in the old routes. */
@Controller('upload')
@UseFilters(ExposeMessageFilter)
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post('images') @HttpCode(200) @UseGuards(AuthGuard, Mw(uploadLimiter, uploadImages.array('images', 10) as any))
  images(@UploadedFiles() files: Express.Multer.File[]) { return this.upload.multipleImages(files || []); }

  @Post('image') @HttpCode(200) @UseGuards(AuthGuard, Mw(uploadLimiter, uploadImages.single('image') as any))
  image(@UploadedFile() file?: Express.Multer.File) { return this.upload.singleImage(file); }

  @Post('manga-pages') @UseGuards(AuthGuard, Mw(mangaUploadLimiter, uploadMangaPageFiles.array('pages', 20) as any))
  async mangaPages(
    @CurrentUser() userId: string,
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.upload.mangaPages(userId, body, files || []);
    res.status(result.success ? 200 : 400); // all pages bad = 400, with the per-page errors in data
    return result;
  }
}
