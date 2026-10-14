import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';

/** /health and /ready. */
@Module({ controllers: [SystemController] })
export class SystemModule {}
