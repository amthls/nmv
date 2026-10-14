import fs from 'fs';
import zlib from 'zlib';
import { once } from 'events';

/**
 * Minimal streaming ZIP writer. Every entry is written with its sizes and CRC in the local header
 * (no data descriptors, no extra fields), which is exactly what the EPUB container format asks of
 * the leading `mimetype` entry and what every unzip tool accepts. Entries are added one at a time,
 * so memory stays at one entry however big the archive gets.
 */

const crc32: (data: Uint8Array) => number = (zlib as any).crc32;

interface CentralEntry {
  name: Buffer;
  crc: number;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  utf8: boolean;
}

const MAX_ZIP32 = 0xffffffff;

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipWriter {
  private out: fs.WriteStream;
  private offset = 0;
  private entries: CentralEntry[] = [];
  private stamp = dosDateTime(new Date());
  private failed: Error | null = null;

  constructor(filePath: string) {
    this.out = fs.createWriteStream(filePath);
    this.out.on('error', (e) => { this.failed = e; });
  }

  private async write(buf: Buffer) {
    if (this.failed) throw this.failed;
    this.offset += buf.length;
    if (!this.out.write(buf)) await once(this.out, 'drain');
  }

  /** compress: deflate (text) or store (already-compressed images, the EPUB mimetype). */
  async add(name: string, data: Buffer | string, compress = true) {
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const body = compress ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const method = compress ? 8 : 0;
    const nameBuf = Buffer.from(name, 'utf8');
    const utf8 = /[^\x20-\x7e]/.test(name);
    const crc = crc32(raw) >>> 0;
    if (this.offset + body.length + 200 > MAX_ZIP32) throw new Error('Tệp tải xuống quá lớn (vượt 4 GB). Hãy chọn ít chương hơn.');

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0
    header.writeUInt16LE(utf8 ? 0x0800 : 0, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // no extra field

    this.entries.push({ name: nameBuf, crc, method, compressedSize: body.length, size: raw.length, offset: this.offset, utf8 });
    await this.write(header);
    await this.write(nameBuf);
    await this.write(body);
  }

  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(0x0314, 4); // made by: UNIX, 2.0 (so the mode below is honoured)
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(e.utf8 ? 0x0800 : 0, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(0, 30);
      h.writeUInt16LE(0, 32);
      h.writeUInt16LE(0, 34);
      h.writeUInt16LE(0, 36);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
      h.writeUInt32LE(e.offset, 42);
      await this.write(h);
      await this.write(e.name);
    }
    const size = this.offset - start;
    if (this.entries.length > 0xffff) throw new Error('Quá nhiều tệp trong một gói tải xuống.');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    await new Promise<void>((resolve, reject) => this.out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (this.failed) throw this.failed;
  }

  destroy() {
    this.out.destroy();
  }
}
