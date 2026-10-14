package dm

import (
	"net/http"

	"nmv/messaging/internal/platform/httpx"
)

// Handler serves the direct-message routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Inbox: GET /messages?label=&q=
func (h *Handler) Inbox(w http.ResponseWriter, r *http.Request, me string) {
	q := r.URL.Query()
	inbox, err := h.svc.Inbox(r.Context(), me, q.Get("label"), q.Get("q"))
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"conversations": inbox.Conversations, "unread_count": inbox.UnreadCount})
}

// Thread: GET /messages/{username}
func (h *Handler) Thread(w http.ResponseWriter, r *http.Request, me string) {
	t, err := h.svc.Thread(r.Context(), me, r.PathValue("username"))
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"partner": t.Partner, "messages": t.Messages, "pinned": t.Pinned, "label_ids": t.LabelIDs,
		"blocked_by_me": t.BlockedByMe, "can_message": t.CanMessage})
}

// Send: POST /messages/{username} {message}
func (h *Handler) Send(w http.ResponseWriter, r *http.Request, me string) {
	var b sendRequest
	httpx.ReadJSON(w, r, &b)
	msg, err := h.svc.Send(r.Context(), me, r.PathValue("username"), b.Message)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": msg})
}

// InternalSend: POST /internal/dm {from, to, message, draft_id}
func (h *Handler) InternalSend(w http.ResponseWriter, r *http.Request) {
	var b internalDMRequest
	if httpx.ReadJSON(w, r, &b) != nil {
		httpx.Fail(w, 400, "from, to, message")
		return
	}
	msg, err := h.svc.SendInternal(r.Context(), b)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": msg})
}

// Blocked: GET /internal/blocked?a=&b= (either way: they can't message each other)
func (h *Handler) Blocked(w http.ResponseWriter, r *http.Request) {
	a, b := r.URL.Query().Get("a"), r.URL.Query().Get("b")
	if !httpx.IsUUID(a) || !httpx.IsUUID(b) {
		httpx.Fail(w, 400, "a, b")
		return
	}
	blocked, err := h.svc.Blocked(r.Context(), a, b)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"blocked": blocked})
}

// Labels: GET /messages/labels
func (h *Handler) Labels(w http.ResponseWriter, r *http.Request, me string) {
	labels, err := h.svc.Labels(r.Context(), me)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"labels": labels})
}

// CreateLabel: POST /messages/labels
func (h *Handler) CreateLabel(w http.ResponseWriter, r *http.Request, me string) {
	var b labelBody
	httpx.ReadJSON(w, r, &b)
	label, err := h.svc.CreateLabel(r.Context(), me, b)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": label})
}

// UpdateLabel: PATCH /messages/labels/{id}
func (h *Handler) UpdateLabel(w http.ResponseWriter, r *http.Request, me string) {
	var b labelBody
	httpx.ReadJSON(w, r, &b)
	label, err := h.svc.UpdateLabel(r.Context(), me, r.PathValue("id"), b)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, label)
}

// DeleteLabel: DELETE /messages/labels/{id}
func (h *Handler) DeleteLabel(w http.ResponseWriter, r *http.Request, me string) {
	if err := h.svc.DeleteLabel(r.Context(), me, r.PathValue("id")); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa nhãn."})
}

// SetLabels: PUT /messages/{username}/labels {label_ids}
func (h *Handler) SetLabels(w http.ResponseWriter, r *http.Request, me string) {
	var b setLabelsRequest
	if httpx.ReadJSON(w, r, &b) != nil || b.LabelIDs == nil || len(b.LabelIDs) > maxLabels {
		httpx.Fail(w, 400, "Danh sách nhãn không hợp lệ.")
		return
	}
	ids, err := h.svc.SetLabels(r.Context(), me, r.PathValue("username"), b.LabelIDs)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"label_ids": ids})
}

// Block: POST (block) or DELETE (unblock) /messages/{username}/block
func (h *Handler) Block(block bool) httpx.UserFunc {
	return func(w http.ResponseWriter, r *http.Request, me string) {
		msg, err := h.svc.SetBlock(r.Context(), me, r.PathValue("username"), block)
		if err != nil {
			httpx.Answer(w, r, err)
			return
		}
		httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": msg})
	}
}

// Pin: POST (pin) or DELETE (unpin) /messages/{username}/pins/{messageId}
func (h *Handler) Pin(pin bool) httpx.UserFunc {
	return func(w http.ResponseWriter, r *http.Request, me string) {
		data, err := h.svc.SetPin(r.Context(), me, r.PathValue("username"), r.PathValue("messageId"), pin)
		if err != nil {
			httpx.Answer(w, r, err)
			return
		}
		msg := "Đã bỏ ghim."
		if pin {
			msg = "Đã ghim tin nhắn."
		}
		httpx.OKMsg(w, msg, data)
	}
}
