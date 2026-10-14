// Package albums: named story lists, moved from the backend's album.controller.ts with the same JSON. A story may sit in
// any number of a user's albums. Private albums open only for the owner or with the share link (?key=token); public
// ones also show up under the stories they contain. Others can save an album (live) or copy its stories into their own.
package albums

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"nmv/library/internal/platform/catalog"
	"nmv/library/internal/platform/httpx"
)

// ProfileSource gives the owners' names and avatars (the backend's profiles).
type ProfileSource interface {
	Profiles(ctx context.Context, ids []string) (map[string]catalog.Profile, error)
}

// Service holds the album rules.
type Service struct {
	repo     *Repository
	profiles ProfileSource
}

// NewService wires the album service.
func NewService(repo *Repository, profiles ProfileSource) *Service {
	return &Service{repo: repo, profiles: profiles}
}

// withOwners adds owner_username, owner_name, owner_avatar (from the backend) and drops albums whose owner is banned
// or deleted when activeOnly.
func (s *Service) withOwners(ctx context.Context, rows []map[string]any, activeOnly bool) ([]map[string]any, error) {
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r["owner_id"].(string))
	}
	people, err := s.profiles.Profiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("owner profiles: %w", err)
	}
	out := rows[:0]
	for _, r := range rows {
		p, known := people[r["owner_id"].(string)]
		if activeOnly && (!known || p.IsBanned || p.Deleted) {
			continue
		}
		r["owner_username"], r["owner_name"], r["owner_avatar"] = nil, nil, nil
		if known {
			r["owner_username"], r["owner_name"], r["owner_avatar"] = p.Username, p.DisplayName, p.AvatarURL
		}
		out = append(out, r)
	}
	return out, nil
}

// text: the body field as the backend's optionalText read it. sent = the field was there.
func text(body map[string]any, key string, max int, label string) (val *string, sent bool, err error) {
	raw, sent := body[key]
	if !sent || raw == nil {
		return nil, sent, nil
	}
	str, isStr := raw.(string)
	if !isStr {
		return nil, true, httpx.Bad(label + " không hợp lệ.")
	}
	str = strings.TrimSpace(str)
	if len([]rune(str)) > max {
		return nil, true, httpx.Bad(fmt.Sprintf("%s tối đa %d ký tự.", label, max))
	}
	if str == "" {
		return nil, true, nil
	}
	return &str, true, nil
}

// ownAlbum: an album the user owns, or 404 (never reveals someone else's private album).
func (s *Service) ownAlbum(ctx context.Context, albumID, me string) (name string, err error) {
	if !httpx.IsUUID(albumID) {
		return "", httpx.NotFound("Album không tồn tại.")
	}
	name, err = s.repo.ownName(ctx, albumID, me)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.NotFound("Album không tồn tại hoặc không thuộc về bạn.")
	}
	if err != nil {
		return "", fmt.Errorf("find album: %w", err)
	}
	return name, nil
}

// viewableAlbum: an album the viewer may open: owner, public album, or private album with the right share key.
func (s *Service) viewableAlbum(ctx context.Context, albumID, me string, key any) (*viewable, error) {
	if !httpx.IsUUID(albumID) {
		return nil, httpx.NotFound("Album không tồn tại.")
	}
	v, err := s.repo.viewableRow(ctx, albumID)
	k, _ := key.(string)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !(v.ownerID == me || v.public || (k != "" && k == v.shareToken))) {
		return nil, httpx.NotFound("Album không tồn tại hoặc là album riêng tư.")
	}
	if err != nil {
		return nil, fmt.Errorf("find album: %w", err)
	}
	return &v, nil
}

// ownerCodeNo: the account number in the AL- code (null if the backend doesn't know it yet).
func (s *Service) ownerCodeNo(ctx context.Context, me string) (*int64, error) {
	people, err := s.profiles.Profiles(ctx, []string{me})
	if err != nil {
		return nil, fmt.Errorf("owner profile: %w", err)
	}
	return people[me].CodeNo, nil
}

// checkRoom is a 400 when the person already has the most albums allowed.
func (s *Service) checkRoom(ctx context.Context, me string) error {
	n, err := s.repo.count(ctx, me)
	if err != nil {
		return fmt.Errorf("count albums: %w", err)
	}
	if n >= maxAlbumsPerUser {
		return httpx.Bad(fmt.Sprintf("Mỗi tài khoản tạo tối đa %d album.", maxAlbumsPerUser))
	}
	return nil
}

// Mine: my albums; with story each one says whether it holds that story.
func (s *Service) Mine(ctx context.Context, me, story string) ([]map[string]any, error) {
	if !httpx.IsUUID(story) {
		story = ""
	}
	rows, err := s.repo.mine(ctx, me, story)
	if err != nil {
		return nil, fmt.Errorf("list my albums: %w", err)
	}
	return s.withOwners(ctx, rows, false)
}

// Saved: other people's albums I saved, still viewable to me (saved through a share link: while it matches).
func (s *Service) Saved(ctx context.Context, me string) ([]map[string]any, error) {
	rows, err := s.repo.saved(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("list saved albums: %w", err)
	}
	return s.withOwners(ctx, rows, false)
}

// ByStory: mine = my albums holding the story; others = public albums of active users holding it, random order,
// those holding more than this story first.
func (s *Service) ByStory(ctx context.Context, me, story string, limit int) (map[string]any, error) {
	if !httpx.IsUUID(story) {
		return nil, httpx.NotFound("Truyện không tồn tại.")
	}
	if limit < 1 {
		limit = 12
	}
	limit = min(limit, 30)
	mine := []map[string]any{}
	var err error
	if me != "" {
		mine, err = s.repo.mineWithStory(ctx, me, story)
		if err != nil {
			return nil, fmt.Errorf("list my albums with story: %w", err)
		}
		if mine, err = s.withOwners(ctx, mine, false); err != nil {
			return nil, err
		}
	}
	// a few extra: albums of banned/deleted owners are dropped after asking the backend
	others, err := s.repo.othersWithStory(ctx, story, me, limit*3)
	if err != nil {
		return nil, fmt.Errorf("list public albums with story: %w", err)
	}
	if others, err = s.withOwners(ctx, others, true); err != nil {
		return nil, err
	}
	if len(others) > limit {
		others = others[:limit]
	}
	return map[string]any{"mine": mine, "others": others}, nil
}

// Get: the album page with its stories.
func (s *Service) Get(ctx context.Context, id, me string, key any) (map[string]any, error) {
	if _, err := s.viewableAlbum(ctx, id, me, key); err != nil {
		return nil, err
	}
	rows, err := s.repo.page(ctx, id, me)
	if err != nil {
		return nil, fmt.Errorf("read album: %w", err)
	}
	if rows, err = s.withOwners(ctx, rows, false); err != nil {
		return nil, err
	}
	album := rows[0]
	album["is_owner"] = album["owner_id"] == me
	if album["is_owner"] != true {
		delete(album, "share_token") // only the owner may hand out the link
	}
	if album["copied_from_public"] != true {
		album["copied_from"], album["copied_from_name"] = nil, nil // don't link to a private source album
	}
	delete(album, "copied_from_public")
	stories, err := s.repo.stories(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("read album stories: %w", err)
	}
	album["stories"] = stories
	return album, nil
}

// Create: {name, description?, is_public?, story_id?}
func (s *Service) Create(ctx context.Context, me string, body map[string]any) (map[string]any, error) {
	name, _, err := text(body, "name", 100, "Tên album")
	if err == nil && name == nil {
		err = httpx.Bad("Tên album không được để trống.")
	}
	if err != nil {
		return nil, err
	}
	desc, _, err := text(body, "description", 500, "Mô tả")
	if err != nil {
		return nil, err
	}
	story, _ := body["story_id"].(string)
	if body["story_id"] != nil && !httpx.IsUUID(story) {
		return nil, httpx.Bad("Truyện không hợp lệ.")
	}
	if err := s.checkRoom(ctx, me); err != nil {
		return nil, err
	}
	codeNo, err := s.ownerCodeNo(ctx, me)
	if err != nil {
		return nil, err
	}
	album, err := s.repo.create(ctx, me, codeNo, *name, desc, body["is_public"] == true, story)
	if err != nil {
		return nil, fmt.Errorf("create album: %w", err)
	}
	album["has_story"] = story != ""
	return album, nil
}

// Update: {name?, description?, is_public?}
func (s *Service) Update(ctx context.Context, me, id string, body func() (map[string]any, error)) (map[string]any, error) {
	if _, err := s.ownAlbum(ctx, id, me); err != nil {
		return nil, err
	}
	b, err := body()
	if err != nil {
		return nil, err
	}
	name, nameSent, err := text(b, "name", 100, "Tên album")
	if err == nil && nameSent && name == nil {
		err = httpx.Bad("Tên album không được để trống.")
	}
	if err != nil {
		return nil, err
	}
	desc, descSent, err := text(b, "description", 500, "Mô tả")
	if err != nil {
		return nil, err
	}
	var public *bool
	if v, sent := b["is_public"]; sent {
		p := v == true
		public = &p
	}
	rows, err := s.repo.update(ctx, id, name, descSent, desc, public)
	if err != nil {
		return nil, fmt.Errorf("update album: %w", err)
	}
	return rows[0], nil
}

// SetAllVisibility: every album of mine public, or every one private. Returns how many changed.
func (s *Service) SetAllVisibility(ctx context.Context, me string, body map[string]any) (changed int64, public bool, err error) {
	public, isBool := body["is_public"].(bool)
	if !isBool {
		return 0, false, httpx.Bad("Thiếu chế độ công khai/riêng tư.")
	}
	changed, err = s.repo.setAllVisibility(ctx, me, public)
	if err != nil {
		return 0, false, fmt.Errorf("set albums visibility: %w", err)
	}
	return changed, public, nil
}

// Delete removes an album of mine.
func (s *Service) Delete(ctx context.Context, me, id string) error {
	if _, err := s.ownAlbum(ctx, id, me); err != nil {
		return err
	}
	if err := s.repo.remove(ctx, id); err != nil {
		return fmt.Errorf("delete album: %w", err)
	}
	return nil
}

// ResetShareLink: a new share key; old private links stop working.
func (s *Service) ResetShareLink(ctx context.Context, me, id string) (map[string]any, error) {
	if _, err := s.ownAlbum(ctx, id, me); err != nil {
		return nil, err
	}
	rows, err := s.repo.resetShareToken(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("reset share link: %w", err)
	}
	return rows[0], nil
}

// AddStory puts a story into an album of mine; returns the album's name.
func (s *Service) AddStory(ctx context.Context, me, id string, body map[string]any) (string, error) {
	story, _ := body["story_id"].(string)
	if !httpx.IsUUID(story) {
		return "", httpx.Bad("Truyện không hợp lệ.")
	}
	name, err := s.ownAlbum(ctx, id, me)
	if err != nil {
		return "", err
	}
	n, err := s.repo.storyCount(ctx, id)
	if err != nil {
		return "", fmt.Errorf("count album stories: %w", err)
	}
	if n >= maxStoriesPerAlbum {
		return "", httpx.Bad(fmt.Sprintf("Mỗi album chứa tối đa %d truyện.", maxStoriesPerAlbum))
	}
	exists, err := s.repo.storyExists(ctx, story)
	if err != nil {
		return "", fmt.Errorf("check story: %w", err)
	}
	if !exists {
		return "", httpx.NotFound("Truyện hoặc chương không tồn tại.")
	}
	if err := s.repo.addStory(ctx, id, story); err != nil {
		return "", fmt.Errorf("add story to album: %w", err)
	}
	if err := s.repo.touch(ctx, id); err != nil {
		return "", fmt.Errorf("touch album: %w", err)
	}
	return name, nil
}

// RemoveStory takes a story out of an album of mine; returns the album's name.
func (s *Service) RemoveStory(ctx context.Context, me, id, story string) (string, error) {
	if !httpx.IsUUID(story) {
		return "", httpx.Bad("Truyện không hợp lệ.")
	}
	name, err := s.ownAlbum(ctx, id, me)
	if err != nil {
		return "", err
	}
	if err := s.repo.removeStory(ctx, id, story); err != nil {
		return "", fmt.Errorf("remove story from album: %w", err)
	}
	if err := s.repo.touch(ctx, id); err != nil {
		return "", fmt.Errorf("touch album: %w", err)
	}
	return name, nil
}

// ToggleSave saves / unsaves someone else's album. Returns true when it was saved (false = unsaved).
func (s *Service) ToggleSave(ctx context.Context, me, id string, body map[string]any) (saved bool, err error) {
	album, err := s.viewableAlbum(ctx, id, me, body["key"])
	if err != nil {
		return false, err
	}
	if album.ownerID == me {
		return false, httpx.Bad("Đây là album của bạn.")
	}
	had, err := s.repo.deleteSave(ctx, me, id)
	if err != nil {
		return false, fmt.Errorf("unsave album: %w", err)
	}
	if had {
		return false, nil
	}
	var token *string
	if !album.public {
		token = &album.shareToken
	}
	if err := s.repo.addSave(ctx, me, id, token); err != nil {
		return false, fmt.Errorf("save album: %w", err)
	}
	return true, nil
}

// Copy copies the album's stories into one of my albums (target_album_id) or a new one.
func (s *Service) Copy(ctx context.Context, me, id string, body map[string]any) (*CopyResult, error) {
	source, err := s.viewableAlbum(ctx, id, me, body["key"])
	if err != nil {
		return nil, err
	}
	targetID, _ := body["target_album_id"].(string)
	var target copyTarget
	if targetID != "" {
		if !httpx.IsUUID(targetID) {
			return nil, httpx.Bad("Album đích không hợp lệ.")
		}
		if targetID == id {
			return nil, httpx.Bad("Không thể sao chép album vào chính nó.")
		}
		name, err := s.ownAlbum(ctx, targetID, me)
		if err != nil {
			return nil, err
		}
		target.id, target.name = targetID, name
	} else if err := s.checkRoom(ctx, me); err != nil {
		return nil, err
	}
	name, _, err := text(body, "name", 100, "Tên album")
	if err != nil {
		return nil, err
	}
	codeNo, err := s.ownerCodeNo(ctx, me)
	if err != nil {
		return nil, err
	}
	newName := source.name
	if name != nil {
		newName = *name
	}
	target, added, err := s.repo.copyStories(ctx, me, codeNo, id, newName, target)
	if err != nil {
		return nil, fmt.Errorf("copy album: %w", err)
	}
	return &CopyResult{AlbumID: target.id, AlbumName: target.name, Added: added}, nil
}
