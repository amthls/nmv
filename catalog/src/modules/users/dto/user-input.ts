import { InputError, optionalEnum, optionalText, optionalUrl } from '../../../utils/validation';

const THEMES = ['dark', 'light', 'midnight', 'sepia'] as const;

/** Optional number within [min, max]; undefined when not sent. */
function optionalNumber(value: unknown, min: number, max: number, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} phải từ ${min} đến ${max}.`);
  return n;
}

/** PUT /profile/me body → the columns to change, as [column, value] (only fields that were sent). */
export function parseProfileInput(body: any): [string, unknown][] {
  body = body || {};
  // Only fields that were sent change; '' or null clears bio/avatar/banner
  const displayName = optionalText(body.display_name, 100, 'Tên hiển thị');
  if (body.display_name !== undefined && !displayName) throw new InputError('Tên hiển thị không được để trống.');
  const bio = optionalText(body.bio, 2000, 'Giới thiệu');
  return [
    ['display_name', displayName],
    ['bio', bio],
    ['avatar_url', optionalUrl(body.avatar_url, 'Ảnh đại diện')],
    ['banner_url', optionalUrl(body.banner_url, 'Ảnh bìa')],
  ];
}

/** PUT /profile/me/settings body → the settings to change, as [column, value]. */
export function parseSettingsInput(body: any): [string, unknown][] {
  body = body || {};
  const primaryColor = optionalText(body.primary_color, 7, 'Màu chủ đạo');
  if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) throw new InputError('Màu chủ đạo phải có dạng #RRGGBB.');
  const fontSize = optionalNumber(body.font_size, 10, 40, 'Cỡ chữ');
  const lineHeight = optionalNumber(body.line_height, 1, 3, 'Giãn dòng');

  // Only the settings that were sent change; the rest keep their saved value
  return [
    ['theme', optionalEnum(body.theme, THEMES, 'Giao diện')],
    ['primary_color', primaryColor || undefined],
    ['font_family', optionalText(body.font_family, 100, 'Phông chữ') || undefined],
    ['font_size', fontSize === undefined ? undefined : Math.round(fontSize)],
    ['line_height', lineHeight === undefined ? undefined : Math.round(lineHeight * 10) / 10],
    ['reading_mode', optionalText(body.reading_mode, 20, 'Chế độ đọc') || undefined],
  ];
}
