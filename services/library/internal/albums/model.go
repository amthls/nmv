package albums

const (
	maxAlbumsPerUser   = 100
	maxStoriesPerAlbum = 1000
)

// viewable is an album the viewer may open.
type viewable struct {
	ownerID, name, shareToken string
	public                    bool
}

// copyTarget is the album a copy lands in.
type copyTarget struct {
	id, name string
}

// CopyResult is what POST /albums/{id}/copy reports.
type CopyResult struct {
	AlbumID, AlbumName string
	Added              int64
}

// summaryColumns: the album card. excludeStory (a $n placeholder) leaves that story out of the cover preview, so
// "other albums with this story" previews what else is inside. Owner fields are added by withOwners.
func summaryColumns(excludeStory string) string {
	ex := ""
	if excludeStory != "" {
		ex = " AND s.id <> " + excludeStory
	}
	return `a.id, a.code, a.name, a.description, a.is_public, a.copied_from, a.created_at, a.updated_at, a.user_id AS owner_id,
	  (SELECT count(*)::int FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
	    WHERE x.album_id = a.id AND s.approval_status = 'approved') AS story_count,
	  (SELECT count(*)::int FROM album_saves sv WHERE sv.album_id = a.id) AS save_count,
	  COALESCE((
	    SELECT json_agg(p) FROM (
	      SELECT s.id, s.slug, s.title, s.cover_image_url
	      FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
	      WHERE x.album_id = a.id AND s.approval_status = 'approved'` + ex + `
	      ORDER BY x.added_at DESC LIMIT 4
	    ) p
	  ), '[]'::json) AS preview`
}
