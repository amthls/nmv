import { Injectable } from '@nestjs/common';
import { callCommunity } from '../../services/communityClient';
import { callLibrary } from '../../services/libraryClient';
import { InputError } from '../../utils/validation';
import { CodesRepository } from './codes.repository';
import { parseCode } from './parse-code';

/** Smart codes: a short printed code → the page it opens. Hidden things answer 404 like unknown codes. */
@Injectable()
export class CodesService {
  constructor(private readonly repo: CodesRepository) {}

  /** `user` is the signed-in user (if any); returns { type, path } or throws the 404. */
  async resolve(rawCode: string, user?: { id: string; roles?: string[] }) {
    const parsed = parseCode(String(rawCode).slice(0, 60));
    const roles = user?.roles || [];
    const isStaff = roles.includes('admin') || roles.includes('mod');
    const me = user?.id || null;
    let path: string | null = null;

    if (parsed && Number.isSafeInteger(parsed.no)) {
      switch (parsed.kind) {
        case 'user':
          path = await this.repo.user(parsed.no, isStaff);
          break;
        case 'group':
          path = await this.repo.group(parsed.no);
          break;
        case 'story':
          path = await this.repo.story(parsed.no);
          break;
        case 'chapter':
          path = await this.repo.chapter(parsed.no, parsed.chapter);
          break;
        case 'post':
        case 'report': { // community's (Plan/community.md)
          const r = await callCommunity('GET', `/internal/codes/${parsed.kind}/${parsed.no}?staff=${isStaff ? 1 : 0}${me ? `&me=${me}` : ''}`);
          path = r.status === 200 ? r.json.data.path : null;
          break;
        }
        case 'album': { // the library service's; private albums only for their owner (a code carries no share key)
          const r = await callLibrary('GET', `/internal/codes/album/${parsed.no}${me ? `?me=${me}` : ''}`);
          path = r.status === 200 ? r.json.data.path : null;
          break;
        }
      }
    }

    if (!path) throw new InputError('Không tìm thấy mã này.', 404);
    return { type: parsed!.kind, path };
  }
}
