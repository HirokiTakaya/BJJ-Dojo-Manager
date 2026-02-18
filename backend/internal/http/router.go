package http

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"dojo-manager/backend/internal/config"
	"dojo-manager/backend/internal/domain/attendance"
	"dojo-manager/backend/internal/domain/dojo"
	"dojo-manager/backend/internal/domain/members"
	"dojo-manager/backend/internal/domain/notifications"
	"dojo-manager/backend/internal/domain/profile"
	"dojo-manager/backend/internal/domain/ranks"
	"dojo-manager/backend/internal/domain/retention"
	"dojo-manager/backend/internal/domain/session"
	"dojo-manager/backend/internal/domain/stats"
	stripedom "dojo-manager/backend/internal/domain/stripe"
	"dojo-manager/backend/internal/domain/user"
	"dojo-manager/backend/internal/middleware"

	"firebase.google.com/go/v4/auth"
	"github.com/go-chi/chi/v5"
)

type RouterDeps struct {
	Cfg              config.Config
	AuthClient       *auth.Client
	FirestoreClient  *firestore.Client
	UserRepo         *user.Repo
	DojoSvc          *dojo.Service
	DojoRepo         *dojo.Repo
	SessionSvc       *session.Service
	AttendanceSvc    *attendance.Service
	RanksSvc         *ranks.Service
	StatsSvc         *stats.Service
	NotificationsSvc *notifications.Service
	MembersSvc       *members.Service
	ProfileSvc       *profile.Service
	StripeSvc        *stripedom.Service
	RetentionSvc     *retention.Service
}

func NewRouter(d RouterDeps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.CORS(d.Cfg.AllowedOrigins))
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		WriteJSON(w, 200, map[string]any{"ok": true, "ts": time.Now().UTC().Format(time.RFC3339)})
	})

	// ===== Stripe Webhook (no auth required) =====
	if d.StripeSvc != nil {
		r.Post("/v1/stripe/webhook", d.StripeSvc.HandleWebhook)
	}

	// Protected routes
	r.Group(func(pr chi.Router) {
		pr.Use(middleware.WithAuth(d.AuthClient))

		pr.Get("/v1/me", func(w http.ResponseWriter, r *http.Request) {
			au, _ := middleware.GetAuthUser(r.Context())
			WriteJSON(w, 200, map[string]any{
				"uid":    au.UID,
				"email":  au.Email,
				"claims": au.Claims,
			})
		})

		// ===== Auth: Reset email verified (for per-login verification) =====
		pr.Post("/v1/auth/reset-email-verified", func(w http.ResponseWriter, r *http.Request) {
			au, _ := middleware.GetAuthUser(r.Context())
			if au.UID == "" {
				Fail(w, 401, "unauthorized")
				return
			}

			if d.AuthClient == nil {
				Fail(w, 500, "auth client is not configured")
				return
			}

			// Admin SDK で emailVerified を false にリセット
			params := (&auth.UserToUpdate{}).EmailVerified(false)
			_, err := d.AuthClient.UpdateUser(r.Context(), au.UID, params)
			if err != nil {
				Fail(w, 500, "failed to reset email verification: "+err.Error())
				return
			}

			WriteJSON(w, 200, map[string]any{"success": true})
		})

		// ===== Dojo routes =====
		pr.Post("/v1/dojos", func(w http.ResponseWriter, r *http.Request) {
			au, _ := middleware.GetAuthUser(r.Context())

			var in dojo.CreateDojoInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				Fail(w, 400, "invalid json")
				return
			}
			in.Trim()

			out, err := d.DojoSvc.CreateDojo(r.Context(), au.UID, in)
			if err != nil {
				status, msg := mapDojoError(err)
				Fail(w, status, msg)
				return
			}
			WriteJSON(w, 201, out)
		})

		pr.Get("/v1/dojos/search", func(w http.ResponseWriter, r *http.Request) {
			q := strings.TrimSpace(r.URL.Query().Get("q"))
			limit := int64(20)
			out, err := d.DojoSvc.SearchDojos(r.Context(), q, limit)
			if err != nil {
				status, msg := mapDojoError(err)
				Fail(w, status, msg)
				return
			}
			WriteJSON(w, 200, out)
		})

		pr.Post("/v1/dojos/{dojoId}/joinRequests", func(w http.ResponseWriter, r *http.Request) {
			au, _ := middleware.GetAuthUser(r.Context())
			dojoId := chi.URLParam(r, "dojoId")
			if dojoId == "" {
				Fail(w, 400, "missing dojoId")
				return
			}

			var in dojo.CreateJoinRequestInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				Fail(w, 400, "invalid json")
				return
			}
			in.Trim()

			out, err := d.DojoSvc.CreateJoinRequest(r.Context(), au.UID, dojoId, in)
			if err != nil {
				status, msg := mapDojoError(err)
				Fail(w, status, msg)
				return
			}
			WriteJSON(w, 201, out)
		})

		pr.Post("/v1/dojos/{dojoId}/joinRequests/{studentUid}/approve", func(w http.ResponseWriter, r *http.Request) {
			au, _ := middleware.GetAuthUser(r.Context())
			dojoId := chi.URLParam(r, "dojoId")
			studentUid := chi.URLParam(r, "studentUid")
			if dojoId == "" || studentUid == "" {
				Fail(w, 400, "missing dojoId or studentUid")
				return
			}

			// ★ Check plan limit before approving (adds a member)
			if d.StripeSvc != nil {
				if err := d.StripeSvc.CheckPlanLimit(r.Context(), dojoId, "member"); err != nil {
					if stripedom.IsErrLimitReached(err) {
						Fail(w, 402, err.Error())
						return
					}
				}
			}

			out, err := d.DojoSvc.ApproveJoinRequest(r.Context(), au.UID, dojoId, studentUid)
			if err != nil {
				status, msg := mapDojoError(err)
				Fail(w, status, msg)
				return
			}
			WriteJSON(w, 200, out)
		})

		// ===== Session (Class) CRUD routes =====
		if d.SessionSvc != nil {
			// Create session
			pr.Post("/v1/dojos/{dojoId}/sessions", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				// ★ Check plan limit before creating class
				if d.StripeSvc != nil {
					if err := d.StripeSvc.CheckPlanLimit(r.Context(), dojoId, "class"); err != nil {
						if stripedom.IsErrLimitReached(err) {
							Fail(w, 402, err.Error())
							return
						}
					}
				}

				var in session.CreateSessionInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.Trim()

				out, err := d.SessionSvc.Create(r.Context(), au.UID, dojoId, in)
				if err != nil {
					status, msg := mapSessionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 201, out)
			})

			// List sessions
			pr.Get("/v1/dojos/{dojoId}/sessions", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				// Parse query params
				var input session.ListSessionsInput
				if dayStr := r.URL.Query().Get("dayOfWeek"); dayStr != "" {
					if day, err := strconv.Atoi(dayStr); err == nil {
						input.DayOfWeek = &day
					}
				}
				if r.URL.Query().Get("activeOnly") == "true" {
					input.ActiveOnly = true
				}
				if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
					if limit, err := strconv.ParseInt(limitStr, 10, 64); err == nil {
						input.Limit = limit
					}
				}

				out, err := d.SessionSvc.List(r.Context(), dojoId, input)
				if err != nil {
					status, msg := mapSessionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"sessions": out})
			})

			// Get session
			pr.Get("/v1/dojos/{dojoId}/sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				sessionId := chi.URLParam(r, "sessionId")
				if dojoId == "" || sessionId == "" {
					Fail(w, 400, "missing dojoId or sessionId")
					return
				}

				out, err := d.SessionSvc.Get(r.Context(), dojoId, sessionId)
				if err != nil {
					status, msg := mapSessionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Update session
			pr.Put("/v1/dojos/{dojoId}/sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				sessionId := chi.URLParam(r, "sessionId")
				if dojoId == "" || sessionId == "" {
					Fail(w, 400, "missing dojoId or sessionId")
					return
				}

				var in session.UpdateSessionInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.Trim()

				out, err := d.SessionSvc.Update(r.Context(), au.UID, dojoId, sessionId, in)
				if err != nil {
					status, msg := mapSessionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Delete session
			pr.Delete("/v1/dojos/{dojoId}/sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				sessionId := chi.URLParam(r, "sessionId")
				if dojoId == "" || sessionId == "" {
					Fail(w, 400, "missing dojoId or sessionId")
					return
				}

				err := d.SessionSvc.Delete(r.Context(), au.UID, dojoId, sessionId)
				if err != nil {
					status, msg := mapSessionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"ok": true, "deleted": sessionId})
			})
		}

		// ===== Attendance routes =====
		if d.AttendanceSvc != nil {
			// List attendance
			pr.Get("/v1/dojos/{dojoId}/attendance", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				input := attendance.ListAttendanceInput{
					DojoID:            dojoId,
					SessionInstanceID: r.URL.Query().Get("sessionInstanceId"),
					MemberUID:         r.URL.Query().Get("memberUid"),
				}
				if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
					if limit, err := strconv.Atoi(limitStr); err == nil {
						input.Limit = limit
					}
				}

				out, err := d.AttendanceSvc.List(r.Context(), input)
				if err != nil {
					status, msg := mapAttendanceError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"attendance": out})
			})

			// Record attendance
			pr.Post("/v1/dojos/{dojoId}/attendance", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				var in attendance.RecordAttendanceInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId
				in.Trim()

				out, err := d.AttendanceSvc.Record(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapAttendanceError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 201, out)
			})

			// Update attendance
			pr.Put("/v1/dojos/{dojoId}/attendance/{attendanceId}", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				attendanceId := chi.URLParam(r, "attendanceId")
				if dojoId == "" || attendanceId == "" {
					Fail(w, 400, "missing dojoId or attendanceId")
					return
				}

				var in attendance.UpdateAttendanceInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId
				in.ID = attendanceId
				in.Trim()

				out, err := d.AttendanceSvc.Update(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapAttendanceError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Bulk attendance
			pr.Post("/v1/dojos/{dojoId}/attendance/bulk", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				var in attendance.BulkAttendanceInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId

				results, err := d.AttendanceSvc.BulkRecord(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapAttendanceError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true, "processed": len(results), "results": results})
			})
		}

		// ===== Ranks routes =====
		if d.RanksSvc != nil {
			// Update member rank
			pr.Post("/v1/dojos/{dojoId}/members/{memberUid}/rank", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				var in ranks.UpdateMemberRankInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId
				in.MemberUID = memberUid
				in.Trim()

				out, err := d.RanksSvc.UpdateMemberRank(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapRanksError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Add stripe
			pr.Post("/v1/dojos/{dojoId}/members/{memberUid}/stripe", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				var in ranks.AddStripeInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId
				in.MemberUID = memberUid
				in.Trim()

				out, err := d.RanksSvc.AddStripe(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapRanksError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Get rank history
			pr.Get("/v1/dojos/{dojoId}/members/{memberUid}/rankHistory", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				out, err := d.RanksSvc.GetRankHistory(r.Context(), dojoId, memberUid)
				if err != nil {
					status, msg := mapRanksError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"history": out})
			})

			// Get belt distribution
			pr.Get("/v1/dojos/{dojoId}/beltDistribution", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				out, err := d.RanksSvc.GetBeltDistribution(r.Context(), dojoId)
				if err != nil {
					status, msg := mapRanksError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})
		}

		// ===== Stats routes =====
		if d.StatsSvc != nil {
			// Get dojo stats
			pr.Get("/v1/dojos/{dojoId}/stats", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				out, err := d.StatsSvc.GetDojoStats(r.Context(), dojoId)
				if err != nil {
					status, msg := mapStatsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Get member stats
			pr.Get("/v1/dojos/{dojoId}/members/{memberUid}/stats", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				out, err := d.StatsSvc.GetMemberStats(r.Context(), dojoId, memberUid)
				if err != nil {
					status, msg := mapStatsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Get attendance stats
			pr.Get("/v1/dojos/{dojoId}/attendanceStats", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				period := r.URL.Query().Get("period")
				sessionId := r.URL.Query().Get("sessionId")

				out, err := d.StatsSvc.GetAttendanceStats(r.Context(), dojoId, period, sessionId)
				if err != nil {
					status, msg := mapStatsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})
		}

		// ===== Notifications routes =====
		if d.NotificationsSvc != nil {
			// Get notifications
			pr.Get("/v1/notifications", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				unreadOnly := r.URL.Query().Get("unreadOnly") == "true"
				limit := 50
				if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
					if l, err := strconv.Atoi(limitStr); err == nil {
						limit = l
					}
				}

				out, err := d.NotificationsSvc.GetNotifications(r.Context(), au.UID, unreadOnly, limit)
				if err != nil {
					status, msg := mapNotificationsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Mark notification as read
			pr.Post("/v1/notifications/markRead", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())

				var in notifications.MarkReadInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}

				count, err := d.NotificationsSvc.MarkRead(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapNotificationsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true, "marked": count})
			})

			// Create notification (staff only)
			pr.Post("/v1/notifications", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				if !middleware.IsStaff(au.Claims) {
					Fail(w, 403, "staff permission required")
					return
				}

				var in notifications.CreateNotificationInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.Trim()

				// ★ Check plan limit before creating announcement (if dojoId provided)
				if in.DojoID != "" && d.StripeSvc != nil {
					if err := d.StripeSvc.CheckPlanLimit(r.Context(), in.DojoID, "announcement"); err != nil {
						if stripedom.IsErrLimitReached(err) {
							Fail(w, 402, err.Error())
							return
						}
					}
				}

				id, err := d.NotificationsSvc.CreateNotification(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapNotificationsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 201, map[string]any{"success": true, "id": id})
			})

			// Send bulk notification (staff only)
			pr.Post("/v1/notifications/bulk", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				if !middleware.IsStaff(au.Claims) {
					Fail(w, 403, "staff permission required")
					return
				}

				var in notifications.SendBulkNotificationInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.Trim()

				// ★ Check plan limit before sending bulk announcement
				if d.StripeSvc != nil {
					if err := d.StripeSvc.CheckPlanLimit(r.Context(), in.DojoID, "announcement"); err != nil {
						if stripedom.IsErrLimitReached(err) {
							Fail(w, 402, err.Error())
							return
						}
					}
				}

				count, err := d.NotificationsSvc.SendBulkNotification(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapNotificationsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true, "sent": count})
			})

			// Delete notification
			pr.Delete("/v1/notifications/{notificationId}", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				notificationId := chi.URLParam(r, "notificationId")
				if notificationId == "" {
					Fail(w, 400, "missing notificationId")
					return
				}

				err := d.NotificationsSvc.DeleteNotification(r.Context(), au.UID, notificationId)
				if err != nil {
					status, msg := mapNotificationsError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true})
			})
		}

		// ===== Members routes =====
		if d.MembersSvc != nil {
			// List members
			pr.Get("/v1/dojos/{dojoId}/members", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				if !middleware.IsStaff(au.Claims) {
					Fail(w, 403, "staff permission required to list members")
					return
				}

				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				input := members.ListMembersInput{
					DojoID: dojoId,
					Status: r.URL.Query().Get("status"),
				}
				if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
					if l, err := strconv.Atoi(limitStr); err == nil {
						input.Limit = l
					}
				}

				out, err := d.MembersSvc.ListMembers(r.Context(), input)
				if err != nil {
					status, msg := mapMembersError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"members": out})
			})

			// Add member (staff only)
			pr.Post("/v1/dojos/{dojoId}/members", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				if !middleware.IsStaff(au.Claims) {
					Fail(w, 403, "staff permission required to add members")
					return
				}

				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				// ★ Check plan limit before adding member
				if d.StripeSvc != nil {
					if err := d.StripeSvc.CheckPlanLimit(r.Context(), dojoId, "member"); err != nil {
						if stripedom.IsErrLimitReached(err) {
							Fail(w, 402, err.Error())
							return
						}
					}
				}

				var in members.AddMemberInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId
				in.Trim()

				// ★ Check staff limit if adding staff role
				if in.RoleInDojo == "staff" || in.RoleInDojo == "coach" || in.RoleInDojo == "owner" {
					if d.StripeSvc != nil {
						if err := d.StripeSvc.CheckPlanLimit(r.Context(), dojoId, "staff"); err != nil {
							if stripedom.IsErrLimitReached(err) {
								Fail(w, 402, err.Error())
								return
							}
						}
					}
				}

				out, err := d.MembersSvc.AddMember(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapMembersError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 201, out)
			})

			// Get member
			pr.Get("/v1/dojos/{dojoId}/members/{memberUid}", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				out, err := d.MembersSvc.GetMember(r.Context(), dojoId, memberUid)
				if err != nil {
					status, msg := mapMembersError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Update member
			pr.Put("/v1/dojos/{dojoId}/members/{memberUid}", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				var in members.UpdateMemberInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.DojoID = dojoId
				in.MemberUID = memberUid
				in.Trim()

				// ★ Check staff limit if promoting to staff role
				if in.RoleInDojo != nil {
					newRole := *in.RoleInDojo
					if newRole == "staff" || newRole == "coach" || newRole == "owner" {
						// Get current role to check if this is a promotion
						currentMember, err := d.MembersSvc.GetMember(r.Context(), dojoId, memberUid)
						if err == nil {
							currentRole := currentMember.Member.RoleInDojo
							isCurrentStaff := currentRole == "staff" || currentRole == "coach" || currentRole == "owner"
							if !isCurrentStaff && d.StripeSvc != nil {
								if err := d.StripeSvc.CheckPlanLimit(r.Context(), dojoId, "staff"); err != nil {
									if stripedom.IsErrLimitReached(err) {
										Fail(w, 402, err.Error())
										return
									}
								}
							}
						}
					}
				}

				out, err := d.MembersSvc.UpdateMember(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapMembersError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Delete member
			pr.Delete("/v1/dojos/{dojoId}/members/{memberUid}", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				memberUid := chi.URLParam(r, "memberUid")
				if dojoId == "" || memberUid == "" {
					Fail(w, 400, "missing dojoId or memberUid")
					return
				}

				err := d.MembersSvc.DeleteMember(r.Context(), au.UID, dojoId, memberUid)
				if err != nil {
					status, msg := mapMembersError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"ok": true, "deleted": memberUid})
			})
		}

		// ===== Retention Alerts routes =====
		if d.RetentionSvc != nil {
			// Get retention alerts (staff only)
			pr.Get("/v1/dojos/{dojoId}/retention/alerts", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				out, err := d.RetentionSvc.GetAlerts(r.Context(), au.UID, dojoId)
				if err != nil {
					status, msg := mapRetentionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, out)
			})

			// Get retention settings
			pr.Get("/v1/dojos/{dojoId}/retention/settings", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				settings, err := d.RetentionSvc.GetSettings(r.Context(), dojoId)
				if err != nil {
					status, msg := mapRetentionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, settings)
			})

			// Update retention settings (staff only)
			pr.Put("/v1/dojos/{dojoId}/retention/settings", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				var in retention.UpdateSettingsInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}

				settings, err := d.RetentionSvc.UpdateSettings(r.Context(), au.UID, dojoId, in)
				if err != nil {
					status, msg := mapRetentionError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, settings)
			})
		}

		// ===== Profile routes =====
		if d.ProfileSvc != nil {
			// Get profile
			pr.Get("/v1/profile", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				targetUid := r.URL.Query().Get("uid")
				if targetUid == "" {
					targetUid = au.UID
				}

				// Check permission for other users
				if targetUid != au.UID && !middleware.IsStaff(au.Claims) {
					Fail(w, 403, "permission denied")
					return
				}

				out, err := d.ProfileSvc.GetProfile(r.Context(), targetUid)
				if err != nil {
					status, msg := mapProfileError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"uid": targetUid, "user": out})
			})

			// Update profile
			pr.Put("/v1/profile", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())

				var body struct {
					Updates profile.UpdateProfileInput `json:"updates"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				body.Updates.Trim()

				err := d.ProfileSvc.UpdateProfile(r.Context(), au.UID, body.Updates)
				if err != nil {
					status, msg := mapProfileError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true})
			})

			// Deactivate user (admin only)
			pr.Post("/v1/admin/deactivateUser", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				if !middleware.IsAdmin(au.Claims) {
					Fail(w, 403, "admin privileges required")
					return
				}

				var body struct {
					UserID string `json:"userId"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					Fail(w, 400, "invalid json")
					return
				}

				err := d.ProfileSvc.DeactivateUser(r.Context(), au.UID, body.UserID)
				if err != nil {
					status, msg := mapProfileError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true})
			})

			// Reactivate user (admin only)
			pr.Post("/v1/admin/reactivateUser", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				if !middleware.IsAdmin(au.Claims) {
					Fail(w, 403, "admin privileges required")
					return
				}

				var body struct {
					UserID string `json:"userId"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					Fail(w, 400, "invalid json")
					return
				}

				err := d.ProfileSvc.ReactivateUser(r.Context(), body.UserID)
				if err != nil {
					status, msg := mapProfileError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true})
			})
		}

		// ===== Stripe routes (protected) =====
		if d.StripeSvc != nil {
			// Create checkout session
			pr.Post("/v1/stripe/create-checkout", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())

				var in stripedom.CreateCheckoutInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.Trim()

				url, err := d.StripeSvc.CreateCheckoutSession(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapStripeError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"url": url})
			})

			// Create portal session
			pr.Post("/v1/stripe/create-portal", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())

				var in stripedom.CreatePortalInput
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					Fail(w, 400, "invalid json")
					return
				}
				in.Trim()

				url, err := d.StripeSvc.CreatePortalSession(r.Context(), au.UID, in)
				if err != nil {
					status, msg := mapStripeError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"url": url})
			})

			// Get subscription info
			pr.Get("/v1/dojos/{dojoId}/subscription", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				info, err := d.StripeSvc.GetSubscriptionInfo(r.Context(), dojoId)
				if err != nil {
					status, msg := mapStripeError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, info)
			})

			// Cancel subscription
			pr.Post("/v1/dojos/{dojoId}/subscription/cancel", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				err := d.StripeSvc.CancelSubscription(r.Context(), au.UID, dojoId)
				if err != nil {
					status, msg := mapStripeError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true})
			})

			// Resume subscription
			pr.Post("/v1/dojos/{dojoId}/subscription/resume", func(w http.ResponseWriter, r *http.Request) {
				au, _ := middleware.GetAuthUser(r.Context())
				dojoId := chi.URLParam(r, "dojoId")
				if dojoId == "" {
					Fail(w, 400, "missing dojoId")
					return
				}

				err := d.StripeSvc.ResumeSubscription(r.Context(), au.UID, dojoId)
				if err != nil {
					status, msg := mapStripeError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"success": true})
			})

			// Check plan limit
			pr.Get("/v1/dojos/{dojoId}/plan-limit/{resource}", func(w http.ResponseWriter, r *http.Request) {
				dojoId := chi.URLParam(r, "dojoId")
				resource := chi.URLParam(r, "resource")
				if dojoId == "" || resource == "" {
					Fail(w, 400, "missing dojoId or resource")
					return
				}

				err := d.StripeSvc.CheckPlanLimit(r.Context(), dojoId, resource)
				if err != nil {
					if stripedom.IsErrLimitReached(err) {
						WriteJSON(w, 200, map[string]any{"allowed": false, "error": err.Error()})
						return
					}
					status, msg := mapStripeError(err)
					Fail(w, status, msg)
					return
				}
				WriteJSON(w, 200, map[string]any{"allowed": true})
			})
		}
	})

	return r
}

func mapDojoError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case dojo.IsErrUnauthorized(err):
		return 403, err.Error()
	case dojo.IsErrNotFound(err):
		return 404, err.Error()
	case dojo.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapSessionError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case session.IsErrUnauthorized(err):
		return 403, err.Error()
	case session.IsErrNotFound(err):
		return 404, err.Error()
	case session.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapAttendanceError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case attendance.IsErrUnauthorized(err):
		return 403, err.Error()
	case attendance.IsErrNotFound(err):
		return 404, err.Error()
	case attendance.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapRanksError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case ranks.IsErrUnauthorized(err):
		return 403, err.Error()
	case ranks.IsErrNotFound(err):
		return 404, err.Error()
	case ranks.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapStatsError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case stats.IsErrUnauthorized(err):
		return 403, err.Error()
	case stats.IsErrNotFound(err):
		return 404, err.Error()
	case stats.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapNotificationsError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case notifications.IsErrUnauthorized(err):
		return 403, err.Error()
	case notifications.IsErrNotFound(err):
		return 404, err.Error()
	case notifications.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapMembersError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case members.IsErrUnauthorized(err):
		return 403, err.Error()
	case members.IsErrNotFound(err):
		return 404, err.Error()
	case members.IsErrBadRequest(err):
		return 400, err.Error()
	case members.IsErrForbidden(err):
		return 403, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapProfileError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case profile.IsErrUnauthorized(err):
		return 403, err.Error()
	case profile.IsErrNotFound(err):
		return 404, err.Error()
	case profile.IsErrBadRequest(err):
		return 400, err.Error()
	case profile.IsErrTooManyUpdates(err):
		return 429, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapStripeError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case stripedom.IsErrUnauthorized(err):
		return 403, err.Error()
	case stripedom.IsErrNotFound(err):
		return 404, err.Error()
	case stripedom.IsErrBadRequest(err):
		return 400, err.Error()
	case stripedom.IsErrLimitReached(err):
		return 402, err.Error()
	default:
		return 500, err.Error()
	}
}

func mapRetentionError(err error) (int, string) {
	if err == nil {
		return 500, "unknown error"
	}
	switch {
	case retention.IsErrUnauthorized(err):
		return 403, err.Error()
	case retention.IsErrNotFound(err):
		return 404, err.Error()
	case retention.IsErrBadRequest(err):
		return 400, err.Error()
	default:
		return 500, err.Error()
	}
}
