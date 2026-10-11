import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/novel_platform?schema=public',
});

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFileSafe(src: string, dest: string) {
  if (fs.existsSync(src)) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

async function importFromDocmep() {
  console.log('📦 Đang quét dữ liệu cào từ C:\\Users\\Admin\\Documents\\docmep\\output...');

  const docmepPath = 'C:\\Users\\Admin\\Documents\\docmep\\output';
  const rootUploadsPath = path.resolve(__dirname, '../../uploads');
  const frontendUploadsPath = path.resolve(__dirname, '../../frontend/public/uploads');

  ensureDir(rootUploadsPath);
  ensureDir(frontendUploadsPath);

  if (!fs.existsSync(docmepPath)) {
    console.log(`⚠️ Không tìm thấy thư mục docmep tại: ${docmepPath}`);
    return;
  }

  const client = await pool.connect();

  try {
    // 0. Update comment_target_type enum to include 'story' if not present
    await client.query(`
      DO $$
      BEGIN
        ALTER TYPE comment_target_type ADD VALUE IF NOT EXISTS 'story';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    const adminUser = await client.query("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
    const nekoUser = await client.query("SELECT id FROM users WHERE username = 'neko_trans' LIMIT 1");
    const nekoGroup = await client.query("SELECT id FROM translation_groups WHERE slug = 'neko-translation' LIMIT 1");

    const adminId = adminUser.rows[0]?.id;
    const uploaderId = nekoUser.rows[0]?.id || adminId;
    const groupId = nekoGroup.rows[0]?.id || null;

    const items = fs.readdirSync(docmepPath);

    for (const item of items) {
      const storyDir = path.join(docmepPath, item);
      const metadataPath = path.join(storyDir, 'story_metadata.json');

      if (fs.existsSync(metadataPath)) {
        console.log(`\n📖 Đang xử lý bộ truyện: ${item}`);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

        const title = metadata.title || item;
        const slug = 'vi-da-tro-thanh-ke-thu-cua-oshi';
        const synopsis = metadata.summary || '';
        const authorName = metadata.author || 'Chưa rõ';

        // 1. Sao chép và lưu trữ file ảnh bìa (Cover Image)
        let coverUrl = '/uploads/stories/vi-da-tro-thanh-ke-thu-cua-oshi/cover.webp';
        const srcCoverPath = path.join(storyDir, 'cover.webp');
        if (fs.existsSync(srcCoverPath)) {
          const destCoverRoot = path.join(rootUploadsPath, `stories/${slug}/cover.webp`);
          const destCoverFrontend = path.join(frontendUploadsPath, `stories/${slug}/cover.webp`);
          copyFileSafe(srcCoverPath, destCoverRoot);
          copyFileSafe(srcCoverPath, destCoverFrontend);
          console.log(`📸 Đã lưu ảnh bìa vào: /uploads/stories/${slug}/cover.webp`);
        } else if (metadata.cover_image?.original_url) {
          coverUrl = metadata.cover_image.original_url;
        }

        // 2. Insert Story vào Database (chỉ lưu đường dẫn ảnh)
        const storyRes = await client.query(`
          INSERT INTO stories (
            id, title, slug, synopsis, cover_image_url,
            story_type, status, approval_status, approved_by, approved_at,
            uploader_id, group_id, original_language, translated_language,
            author_name, total_views, total_favorites, rating_avg, rating_count,
            last_chapter_at
          ) VALUES (
            '20000000-0000-0000-0000-000000000001', $1, $2, $3, $4,
            'novel', 'ongoing', 'approved', $5, NOW(),
            $6, $7, 'ja', 'vi',
            $8, 128500, 14200, 9.8, 420,
            NOW()
          ) ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            synopsis = EXCLUDED.synopsis,
            cover_image_url = EXCLUDED.cover_image_url
          RETURNING id;
        `, [title, slug, synopsis, coverUrl, adminId, uploaderId, groupId, authorName]);

        const storyId = storyRes.rows[0].id;

        // 3. Gán thể loại (genres / tags)
        if (metadata.genres && Array.isArray(metadata.genres)) {
          for (const genre of metadata.genres) {
            const genreSlug = genre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const tagRes = await client.query('SELECT id FROM tags WHERE slug = $1 OR name ILIKE $2 LIMIT 1', [genreSlug, genre]);
            if (tagRes.rows.length > 0) {
              await client.query(`
                INSERT INTO story_tags (story_id, tag_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING;
              `, [storyId, tagRes.rows[0].id]);
            }
          }
        }

        // 4. Xử lý volumes và chapters
        if (metadata.volumes && Array.isArray(metadata.volumes)) {
          let chapterNum = 1;

          for (const vol of metadata.volumes) {
            const volTitle = vol.volume_title || `Tập ${vol.volume_order}`;
            const volOrder = vol.volume_order || 1;

            const volRes = await client.query(`
              INSERT INTO volumes (story_id, title, volume_number)
              VALUES ($1, $2, $3)
              ON CONFLICT (story_id, volume_number) DO UPDATE SET title = EXCLUDED.title
              RETURNING id;
            `, [storyId, volTitle, volOrder]);

            const volumeId = volRes.rows[0].id;

            if (vol.chapters && Array.isArray(vol.chapters)) {
              for (const ch of vol.chapters) {
                const chTitle = ch.title || `Chương ${chapterNum}`;
                const chSlug = `chuong-${chapterNum}-${slugify(chTitle)}`;

                // Tìm nội dung chương nếu có file JSON
                let content = '';
                let wordCount = ch.word_count || 0;
                let notes = null;

                let chJsonPath = ch.json_relative_path ? path.join(docmepPath, ch.json_relative_path) : null;
                if (!chJsonPath || !fs.existsSync(chJsonPath)) {
                  const directPath = path.join(storyDir, volTitle, `${chTitle}.json`);
                  if (fs.existsSync(directPath)) chJsonPath = directPath;
                }

                const imageList: string[] = [];

                if (chJsonPath && fs.existsSync(chJsonPath)) {
                  try {
                    const chData = JSON.parse(fs.readFileSync(chJsonPath, 'utf8'));
                    content = chData.content || '';
                    wordCount = chData.word_count || wordCount;
                    if (chData.notes) notes = JSON.stringify(chData.notes);

                    // SAO CHÉP TẤT CẢ FILE ẢNH VÀO THƯ MỤC UPLOADS DỰ ÁN
                    if (chData.images && Array.isArray(chData.images) && chData.images.length > 0) {
                      console.log(`🖼️ Đang sao chép ${chData.images.length} ảnh của chương "${chTitle}" vào uploads/...`);

                      for (let i = 0; i < chData.images.length; i++) {
                        const img = chData.images[i];
                        const fileName = img.file_name || `img_${String(i + 1).padStart(3, '0')}.webp`;
                        const relUploadPath = `stories/${slug}/vol-${volOrder}/${chSlug}/${fileName}`;
                        const localUploadUrl = `/uploads/${relUploadPath}`;

                        // Tìm file nguồn cục bộ
                        let srcImgPath = img.local_path;
                        if (!srcImgPath || !fs.existsSync(srcImgPath)) {
                          srcImgPath = path.join(storyDir, volTitle, 'images', chTitle, fileName);
                        }

                        if (fs.existsSync(srcImgPath)) {
                          copyFileSafe(srcImgPath, path.join(rootUploadsPath, relUploadPath));
                          copyFileSafe(srcImgPath, path.join(frontendUploadsPath, relUploadPath));
                          imageList.push(localUploadUrl);
                        } else {
                          // Fallback URL online nếu không tìm thấy file local
                          imageList.push(img.original_url);
                        }
                      }

                      const imageMarkdown = imageList
                        .map((imgUrl: string, idx: number) => `![Minh Họa ${idx + 1}](${imgUrl})`)
                        .join('\n\n');

                      if (!content || content.trim().length === 0) {
                        content = imageMarkdown;
                      } else {
                        content = imageMarkdown + '\n\n' + content;
                      }
                    }
                  } catch (e) {}
                }

                const chapterRes = await client.query(`
                  INSERT INTO chapters (
                    story_id, volume_id, title, chapter_number, slug,
                    content, word_count, is_published, approval_status,
                    uploader_id, group_id, translator_notes, total_views
                  ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, true, 'approved',
                    $8, $9, $10, $11
                  ) ON CONFLICT (story_id, chapter_number) DO UPDATE SET
                    title = EXCLUDED.title,
                    slug = EXCLUDED.slug,
                    content = EXCLUDED.content,
                    word_count = EXCLUDED.word_count
                  RETURNING id;
                `, [
                  storyId, volumeId, chTitle, chapterNum, chSlug,
                  content, wordCount, uploaderId, groupId, notes,
                  Math.floor(Math.random() * 20000 + 5000)
                ]);

                const insertedChapterId = chapterRes.rows[0].id;

                // Thêm vào chapter_pages nếu có ảnh
                if (imageList.length > 0) {
                  await client.query('DELETE FROM chapter_pages WHERE chapter_id = $1', [insertedChapterId]);
                  for (let p = 0; p < imageList.length; p++) {
                    await client.query(`
                      INSERT INTO chapter_pages (chapter_id, page_number, image_url, width, height)
                      VALUES ($1, $2, $3, 1200, 1800)
                      ON CONFLICT (chapter_id, page_number) DO UPDATE SET image_url = EXCLUDED.image_url;
                    `, [insertedChapterId, p + 1, imageList[p]]);
                  }
                }

                chapterNum++;
              }
            }
          }
        }

        console.log(`✅ Đã lưu toàn bộ file ảnh vào uploads/ và cập nhật liên kết trong Database cho: ${title}`);
      }
    }

    client.release();
    await pool.end();
  } catch (err: any) {
    console.error('❌ Lỗi khi import dữ liệu docmep:', err.message);
  }
}

importFromDocmep();
