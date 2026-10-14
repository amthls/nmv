import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';

/** Reports on comments, posts and stories; staff review. */
@Module({ controllers: [ReportsController] })
export class ReportsModule {}
