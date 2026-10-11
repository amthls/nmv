import { Request, Response } from 'express';
import { readFile } from 'fs/promises';

/** GET /admin/backup-status : status.json written by the backup container (mounted read-only). */
export const getBackupStatus = async (_req: Request, res: Response) => {
  try {
    const data = JSON.parse(await readFile('/app/backup-status/status.json', 'utf8'));
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: null }); // no backup has run yet, or the container isn't set up
  }
};
