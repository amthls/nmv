import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/novel_platform?schema=public',
});

async function seedStories() {
  console.log('🌱 Đang khởi tạo dữ liệu truyện mẫu...');

  try {
    const client = await pool.connect();

    // 1. Lấy user id & group id
    const adminUser = await client.query("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
    const nekoUser = await client.query("SELECT id FROM users WHERE username = 'neko_trans' LIMIT 1");
    const kitsuneUser = await client.query("SELECT id FROM users WHERE username = 'kitsune_group' LIMIT 1");
    const tanukiUser = await client.query("SELECT id FROM users WHERE username = 'tanuki_san' LIMIT 1");
    const minhUser = await client.query("SELECT id FROM users WHERE username = 'author_minh' LIMIT 1");

    const nekoGroup = await client.query("SELECT id FROM translation_groups WHERE slug = 'neko-translation' LIMIT 1");
    const kitsuneGroup = await client.query("SELECT id FROM translation_groups WHERE slug = 'kitsune-scanlation' LIMIT 1");
    const moonlitGroup = await client.query("SELECT id FROM translation_groups WHERE slug = 'moonlit-translations' LIMIT 1");

    const adminId = adminUser.rows[0].id;
    const nekoId = nekoUser.rows[0].id;
    const kitsuneId = kitsuneUser.rows[0].id;
    const tanukiId = tanukiUser.rows[0].id;
    const minhId = minhUser.rows[0].id;

    const nekoGroupId = nekoGroup.rows[0].id;
    const kitsuneGroupId = kitsuneGroup.rows[0].id;
    const moonlitGroupId = moonlitGroup.rows[0].id;

    // 2. Danh sách truyện mẫu
    const stories = [
      {
        id: '20000000-0000-0000-0000-000000000001',
        title: 'Vì Đã Trở Thành Kẻ Thù Của Oshi',
        slug: 'vi-da-tro-thanh-ke-thu-cua-oshi',
        original_title: 'Oshi no Teki ni Natta node',
        synopsis: 'Những con người sở hữu năng lực vượt xa sự hiểu biết của khoa học tự nhiên bắt đầu xuất hiện dưới tên gọi Thiên Bẩm - Lux. Lux được ban phát cho hầu hết phụ nữ, nhưng lại khước từ gần như toàn bộ đàn ông, biến thế giới thành nơi phụ nữ nắm giữ vị thế độc tôn. Nhân vật chính Ibusuki Ibuki đầu thai vào thế giới này và phải đối đầu với chính thần tượng Oshi Soehi Hinata...',
        cover_image_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
        banner_image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1200&auto=format&fit=crop&q=80',
        story_type: 'novel',
        status: 'ongoing',
        approval_status: 'approved',
        uploader_id: nekoId,
        group_id: nekoGroupId,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Ibusuki Ibuki',
        year_published: 2024,
        total_chapters: 28,
        total_volumes: 2,
        total_views: 128500,
        total_favorites: 14200,
        total_bookmarks: 5820,
        total_comments: 842,
        rating_avg: 9.8,
        rating_count: 420,
        tags: ['romance', 'school-life', 'supernatural', 'light-novel', 'shounen', 'fantasy'],
        volumes: [
          {
            number: 1,
            title: 'Tập 1: Khởi Đầu Cùng Hương Vị Cà Phê',
            chapters: [
              { number: 1, title: 'Chương 1 - Khởi Đầu Cùng Hương Vị Cà Phê', slug: 'chuong-1-khoi-dau-cung-huong-vi-ca-phe', word_count: 2419, views: 24500 },
              { number: 2, title: 'Chương 2 - Ánh Sáng Lux và Bóng Tối Ambra', slug: 'chuong-2-anh-sang-lux-va-bong-toi-ambra', word_count: 2850, views: 19800 },
              { number: 3, title: 'Chương 3 - Cuộc Gặp Gỡ Ở Café Manhattan', slug: 'chuong-3-cuoc-gap-go-o-cafe-manhattan', word_count: 3100, views: 16400 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000002',
        title: 'Solo Leveling: Tôi Thăng Cấp Một Mình',
        slug: 'solo-leveling-toi-thang-cap-mot-minh',
        original_title: 'Na Honjaman Rebeleop',
        synopsis: '10 năm trước, sau khi "Cánh cổng" kết nối thế giới thực với thế giới quái vật mở ra, một số người bình thường đã nhận được sức mạnh thức tỉnh để săn lùng quái vật bên trong cánh cổng. Họ được gọi là "Thợ săn". Sung Jin-Woo là một thợ săn hạng E yếu ớt nhất, suýt chết trong Hầm ngục kép...',
        cover_image_url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80',
        banner_image_url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=1200&auto=format&fit=crop&q=80',
        story_type: 'manga',
        status: 'completed',
        approval_status: 'approved',
        uploader_id: kitsuneId,
        group_id: kitsuneGroupId,
        original_language: 'ko',
        translated_language: 'vi',
        author_name: 'Chugong',
        artist_name: 'DUBU (REDICE Studio)',
        year_published: 2018,
        total_chapters: 200,
        total_volumes: 8,
        total_views: 950200,
        total_favorites: 85400,
        total_bookmarks: 41200,
        total_comments: 4520,
        rating_avg: 9.9,
        rating_count: 1580,
        tags: ['action', 'fantasy', 'op-mc', 'manhwa', 'monsters', 'system', 'shounen'],
        volumes: [
          {
            number: 1,
            title: 'Mùa 1: Thức Tỉnh',
            chapters: [
              { number: 1, title: 'Chapter 1: Thợ săn yếu nhất nhân loại', slug: 'chapter-1-tho-san-yeu-nhat-nhan-loai', word_count: 0, views: 120000 },
              { number: 2, title: 'Chapter 2: Đền thờ Cartenon', slug: 'chapter-2-den-tho-cartenon', word_count: 0, views: 98000 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000003',
        title: 'Mushoku Tensei: Thất Nghiệp Tái Sinh',
        slug: 'mushoku-tensei-that-nghiep-tai-sinh',
        original_title: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
        synopsis: 'Một gã NEET 34 tuổi bị đuổi khỏi nhà sau cái chết của cha mẹ. Sau khi cứu một nhóm học sinh khỏi chiếc xe tải đang lao tới, hắn bị tông chết và tái sinh vào một thế giới phép thuật dưới thân phận một đứa trẻ tên Rudeus Greyrat...',
        cover_image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
        story_type: 'novel',
        status: 'completed',
        approval_status: 'approved',
        uploader_id: tanukiId,
        group_id: null,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Rifujin na Magonote',
        year_published: 2014,
        total_chapters: 260,
        total_volumes: 26,
        total_views: 780000,
        total_favorites: 62000,
        total_bookmarks: 35000,
        total_comments: 3100,
        rating_avg: 9.7,
        rating_count: 980,
        tags: ['isekai', 'fantasy', 'adventure', 'magic', 'drama', 'reincarnation', 'light-novel', 'seinen'],
        volumes: [
          {
            number: 1,
            title: 'Tập 1: Tuổi Thơ',
            chapters: [
              { number: 1, title: 'Chương 1 - Tái Sinh Vào Thế Giới Khác', slug: 'chuong-1-tai-sinh-vao-the-gioi-khac', word_count: 4200, views: 85000 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000004',
        title: 'Sousou no Frieren: Pháp Sư Tiễn Táng',
        slug: 'sousou-no-frieren-phap-su-tien-tang',
        original_title: 'Sousou no Frieren',
        synopsis: 'Câu chuyện kể về pháp sư yêu tinh Frieren, thành viên của tổ đội anh hùng đã đánh bại Ma Vương sau cuộc hành trình 10 năm. Với tuổi thọ hàng ngàn năm, cô bắt đầu chuyến hành trình mới để thấu hiểu con người sau khi anh hùng Himmel qua đời...',
        cover_image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
        story_type: 'manga',
        status: 'ongoing',
        approval_status: 'approved',
        uploader_id: kitsuneId,
        group_id: kitsuneGroupId,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Kanehito Yamada',
        artist_name: 'Tsukasa Abe',
        year_published: 2020,
        total_chapters: 135,
        total_volumes: 12,
        total_views: 640000,
        total_favorites: 54000,
        total_bookmarks: 28000,
        total_comments: 2900,
        rating_avg: 9.9,
        rating_count: 1200,
        tags: ['fantasy', 'adventure', 'drama', 'slice-of-life', 'magic', 'shounen', 'manga-format'],
        volumes: [
          {
            number: 1,
            title: 'Volume 1: Kết Thúc Của Chuyến Phiêu Lưu',
            chapters: [
              { number: 1, title: 'Chapter 1: Kết thúc của cuộc hành trình', slug: 'chapter-1-ket-thuc-cua-cuoc-hanh-trinh', word_count: 0, views: 92000 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000005',
        title: 'Tensei Shitara Slime Datta Ken',
        slug: 'tensei-shitara-slime-datta-ken',
        original_title: 'That Time I Got Reincarnated as a Slime',
        synopsis: 'Satoru Mikami, 37 tuổi, bị đâm chết trên đường phố Tokyo và tái sinh tại một thế giới huyền ảo dưới hình dạng một con Slime có khả năng hấp thụ kỹ năng mang tên Rimuru Tempest...',
        cover_image_url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
        story_type: 'novel',
        status: 'ongoing',
        approval_status: 'approved',
        uploader_id: nekoId,
        group_id: nekoGroupId,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Fuse',
        year_published: 2013,
        total_chapters: 210,
        total_volumes: 21,
        total_views: 520000,
        total_favorites: 48000,
        total_bookmarks: 21000,
        total_comments: 2200,
        rating_avg: 9.6,
        rating_count: 750,
        tags: ['isekai', 'fantasy', 'comedy', 'op-mc', 'monsters', 'magic', 'light-novel'],
        volumes: [
          {
            number: 1,
            title: 'Tập 1: Quái Vật Slime',
            chapters: [
              { number: 1, title: 'Chương 1 - Bắt đầu cuộc sống Slime', slug: 'chuong-1-bat-dau-cuoc-song-slime', word_count: 3600, views: 60000 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000006',
        title: 'Dược Sư Tự Sự (Kusuriya no Hitorigoto)',
        slug: 'duoc-su-tu-su-kusuriya-no-hitorigoto',
        original_title: 'The Apothecary Diaries',
        synopsis: 'Maomao, một thiếu nữ có kiến thức sâu rộng về độc dược và y thuật, bị bắt cóc và bán vào Hậu Cung làm cung nữ. Khi các hoàng tử hoàng nữ liên tục lâm bệnh bí ẩn, tài năng suy luận của cô đã thu hút sự chú ý của tổng quản Jinshi...',
        cover_image_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80',
        story_type: 'novel',
        status: 'ongoing',
        approval_status: 'approved',
        uploader_id: minhId,
        group_id: moonlitGroupId,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Natsu Hyuuga',
        year_published: 2014,
        total_chapters: 85,
        total_volumes: 14,
        total_views: 430000,
        total_favorites: 39000,
        total_bookmarks: 18500,
        total_comments: 1850,
        rating_avg: 9.8,
        rating_count: 820,
        tags: ['mystery', 'historical', 'drama', 'psychological', 'seinen', 'light-novel'],
        volumes: [
          {
            number: 1,
            title: 'Tập 1: Bí Ẩn Trong Hậu Cung',
            chapters: [
              { number: 1, title: 'Chương 1 - Lời Nguyền Hậu Cung', slug: 'chuong-1-loi-nguyen-hau-cung', word_count: 3800, views: 45000 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000007',
        title: 'Chainsaw Man: Người Cưa',
        slug: 'chainsaw-man-nguoi-cua',
        original_title: 'Chainsaw Man',
        synopsis: 'Denji là một thanh niên nghèo khổ sống bằng nghề săn quỷ cùng chú quỷ cưa Pochita để trả nợ cho người cha quá cố. Sau khi bị phản bội và sát hại, Denji hòa làm một với Pochita và hồi sinh thành Người Cưa...',
        cover_image_url: 'https://images.unsplash.com/photo-1569701813229-33284b643e3c?w=800&auto=format&fit=crop&q=80',
        story_type: 'manga',
        status: 'ongoing',
        approval_status: 'approved',
        uploader_id: kitsuneId,
        group_id: kitsuneGroupId,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Tatsuki Fujimoto',
        artist_name: 'Tatsuki Fujimoto',
        year_published: 2018,
        total_chapters: 175,
        total_volumes: 16,
        total_views: 890000,
        total_favorites: 72000,
        total_bookmarks: 39000,
        total_comments: 4200,
        rating_avg: 9.7,
        rating_count: 1400,
        tags: ['action', 'horror', 'supernatural', 'gore', 'shounen', 'manga-format'],
        volumes: [
          {
            number: 1,
            title: 'Part 1: Public Safety Arc',
            chapters: [
              { number: 1, title: 'Chapter 1: Chó và Cưa', slug: 'chapter-1-cho-va-cua', word_count: 0, views: 110000 }
            ]
          }
        ]
      },
      {
        id: '20000000-0000-0000-0000-000000000008',
        title: 'Spy x Family: Gia Đình Điệp Viên',
        slug: 'spy-x-family-gia-dinh-diep-vien',
        original_title: 'SPY×FAMILY',
        synopsis: 'Để thực hiện nhiệm vụ bảo vệ hòa bình thế giới mang tên Chiến dịch Strix, điệp viên hàng đầu Twilight với thân phận bác sĩ Loid Forger phải lập một gia đình giả. Anh nhận nuôi Anya - một cô bé có khả năng đọc suy nghĩ, và kết hôn với Yor - một nữ sát thủ ngầm...',
        cover_image_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
        story_type: 'manga',
        status: 'ongoing',
        approval_status: 'approved',
        uploader_id: kitsuneId,
        group_id: kitsuneGroupId,
        original_language: 'ja',
        translated_language: 'vi',
        author_name: 'Tatsuya Endo',
        artist_name: 'Tatsuya Endo',
        year_published: 2019,
        total_chapters: 105,
        total_volumes: 13,
        total_views: 610000,
        total_favorites: 68000,
        total_bookmarks: 31000,
        total_comments: 2400,
        rating_avg: 9.8,
        rating_count: 1150,
        tags: ['comedy', 'action', 'school-life', 'slice-of-life', 'shounen', 'manga-format'],
        volumes: [
          {
            number: 1,
            title: 'Mission 1: Operation Strix',
            chapters: [
              { number: 1, title: 'Mission 1: Nhiệm vụ mở màn', slug: 'mission-1-nhiem-vu-mo-man', word_count: 0, views: 80000 }
            ]
          }
        ]
      }
    ];

    for (const story of stories) {
      // Insert story
      await client.query(`
        INSERT INTO stories (
          id, title, slug, original_title, synopsis, cover_image_url, banner_image_url,
          story_type, status, approval_status, approved_by, approved_at,
          uploader_id, group_id, original_language, translated_language,
          author_name, artist_name, year_published, total_chapters, total_volumes,
          total_views, total_favorites, total_bookmarks, total_comments, rating_avg, rating_count,
          last_chapter_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::story_type, $9::story_status, $10::approval_status, $11, NOW(),
          $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26,
          NOW()
        ) ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          synopsis = EXCLUDED.synopsis,
          total_views = EXCLUDED.total_views,
          rating_avg = EXCLUDED.rating_avg;
      `, [
        story.id, story.title, story.slug, story.original_title, story.synopsis,
        story.cover_image_url, story.banner_image_url || null,
        story.story_type, story.status, story.approval_status, adminId,
        story.uploader_id, story.group_id, story.original_language, story.translated_language,
        story.author_name, story.artist_name || null, story.year_published,
        story.total_chapters, story.total_volumes,
        story.total_views, story.total_favorites, story.total_bookmarks, story.total_comments,
        story.rating_avg, story.rating_count
      ]);

      // Gán tags
      for (const tagSlug of story.tags) {
        const tagRes = await client.query('SELECT id FROM tags WHERE slug = $1', [tagSlug]);
        if (tagRes.rows.length > 0) {
          await client.query(`
            INSERT INTO story_tags (story_id, tag_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING;
          `, [story.id, tagRes.rows[0].id]);
        }
      }

      // Insert volumes & chapters
      for (const vol of story.volumes) {
        const volRes = await client.query(`
          INSERT INTO volumes (story_id, title, volume_number)
          VALUES ($1, $2, $3)
          ON CONFLICT (story_id, volume_number) DO UPDATE SET title = EXCLUDED.title
          RETURNING id;
        `, [story.id, vol.title, vol.number]);

        const volumeId = volRes.rows[0].id;

        for (const ch of vol.chapters) {
          await client.query(`
            INSERT INTO chapters (
              story_id, volume_id, title, chapter_number, slug,
              word_count, is_published, approval_status, uploader_id, group_id, total_views
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, true, 'approved', $7, $8, $9
            ) ON CONFLICT (story_id, chapter_number) DO NOTHING;
          `, [
            story.id, volumeId, ch.title, ch.number, ch.slug,
            ch.word_count, story.uploader_id, story.group_id, ch.views
          ]);
        }
      }
    }

    console.log(`✅ Seed thành công ${stories.length} bộ truyện mẫu (Light Novel & Manga)!`);
    client.release();
    await pool.end();
  } catch (error: any) {
    console.error('❌ Lỗi seed stories:', error.message);
    process.exit(1);
  }
}

seedStories();
