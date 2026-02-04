package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dojo-manager/backend/internal/config"
	"dojo-manager/backend/internal/domain/attendance"
	"dojo-manager/backend/internal/domain/dojo"
	"dojo-manager/backend/internal/domain/members"
	"dojo-manager/backend/internal/domain/notifications"
	"dojo-manager/backend/internal/domain/profile"
	"dojo-manager/backend/internal/domain/ranks"
	"dojo-manager/backend/internal/domain/session"
	"dojo-manager/backend/internal/domain/stats"
	stripedom "dojo-manager/backend/internal/domain/stripe"
	"dojo-manager/backend/internal/domain/user"
	"dojo-manager/backend/internal/firebase"
	apihttp "dojo-manager/backend/internal/http"
)

func main() {
	ctx := context.Background()
	cfg := config.Load()

	app, err := firebase.NewApp(ctx, cfg)
	if err != nil {
		log.Fatalf("firebase app init failed: %v", err)
	}

	authClient, err := firebase.NewAuthClient(ctx, app)
	if err != nil {
		log.Fatalf("firebase auth client init failed: %v", err)
	}

	fs, err := firebase.NewFirestore(ctx, app)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer fs.Close()

	// Repositories
	userRepo := user.NewRepo(fs.Client)
	dojoRepo := dojo.NewRepo(fs.Client)
	sessionRepo := session.NewRepo(fs.Client)
	attendanceRepo := attendance.NewRepo(fs.Client)
	ranksRepo := ranks.NewRepo(fs.Client)

	// Services
	dojoSvc := dojo.NewService(dojoRepo, userRepo)
	sessionSvc := session.NewService(sessionRepo, dojoRepo)
	attendanceSvc := attendance.NewService(attendanceRepo, dojoRepo)
	ranksSvc := ranks.NewService(ranksRepo, dojoRepo)
	statsSvc := stats.NewService(fs.Client)
	notificationsSvc := notifications.NewService(fs.Client)
	membersSvc := members.NewService(fs.Client, dojoRepo)
	profileSvc := profile.NewService(fs.Client, authClient)

	// Stripe service (optional - only if configured)
	var stripeSvc *stripedom.Service
	stripeCfg := stripedom.LoadConfig()
	if stripeCfg.SecretKey != "" {
		stripeSvc = stripedom.NewService(fs.Client, stripeCfg)
		log.Println("Stripe service initialized")

		// ★ Inject Stripe service into other services for plan limit checks
		sessionSvc.SetStripeService(stripeSvc)
		membersSvc.SetStripeService(stripeSvc)
		notificationsSvc.SetStripeService(stripeSvc)
	} else {
		log.Println("STRIPE_SECRET_KEY not set, Stripe features disabled")
	}

	router := apihttp.NewRouter(apihttp.RouterDeps{
		Cfg:              cfg,
		AuthClient:       authClient,
		FirestoreClient:  fs.Client,
		UserRepo:         userRepo,
		DojoSvc:          dojoSvc,
		DojoRepo:         dojoRepo,
		SessionSvc:       sessionSvc,
		AttendanceSvc:    attendanceSvc,
		RanksSvc:         ranksSvc,
		StatsSvc:         statsSvc,
		NotificationsSvc: notificationsSvc,
		MembersSvc:       membersSvc,
		ProfileSvc:       profileSvc,
		StripeSvc:        stripeSvc,
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 20 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// graceful shutdown
	go func() {
		log.Printf("API listening on :%s (project=%s)", cfg.Port, cfg.ProjectID)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 2)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctxShutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	log.Println("shutting down...")
	_ = srv.Shutdown(ctxShutdown)
}
