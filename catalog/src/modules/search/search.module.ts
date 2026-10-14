import { Injectable, Module } from '@nestjs/common';
import { indexStory, isSearchEnabled, reindexAllStories, removeStoryFromIndex, searchStoryIds } from './search.client';

/** Elasticsearch behind the story search: ranked ids for a query, indexing. SQL stays the source of truth. */
@Injectable()
export class SearchService {
  enabled = isSearchEnabled;
  rankedIds = searchStoryIds;
  index = indexStory;
  remove = removeStoryFromIndex;
  reindexAll = reindexAllStories;
}

@Module({ providers: [SearchService], exports: [SearchService] })
export class SearchModule {}
