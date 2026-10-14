import { sanitizeRichText } from '../../../utils/richText';
import { optionalText, optionalUrl } from '../../../utils/validation';

export const GROUP_ROLES = ['leader', 'mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member'];
export const MANAGER_ROLES = ['leader', 'mod'];
export const WORKFLOW_STEPS = ['raw', 'translate', 'edit', 'proofread'];
export const MERGER_ROLES = ['mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member']; // CHECK in migration 028

/** Group text/link fields shared by create and update (undefined = not sent, null = clear). */
export function readGroupFields(body: any) {
  const name = optionalText(body.name, 100, 'Tên nhóm');
  return {
    name,
    description: body.description === undefined ? undefined : sanitizeRichText(body.description) || null,
    rules: body.rules === undefined ? undefined : sanitizeRichText(body.rules) || null,
    avatar_url: optionalUrl(body.avatar_url, 'Ảnh đại diện nhóm'),
    banner_url: optionalUrl(body.banner_url, 'Ảnh bìa nhóm'),
    // Rendered as clickable links: only http(s) is allowed (blocks javascript: URLs)
    website_url: optionalUrl(body.website_url, 'Website'),
    discord_url: optionalUrl(body.discord_url, 'Discord'),
  };
}
