import { Injectable } from '@nestjs/common';
import { TagsRepository } from './tags.repository';

/** Tags and their categories (genres, themes...) used by stories and the explore filters. */
@Injectable()
export class TagsService {
  constructor(private readonly repo: TagsRepository) {}

  list() {
    return this.repo.listByCategory();
  }
}
