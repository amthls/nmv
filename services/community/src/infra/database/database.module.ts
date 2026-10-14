import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

/** Postgres for every module (global: no need to import it). */
@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DatabaseModule {}
