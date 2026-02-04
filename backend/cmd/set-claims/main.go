package main

import (
	"context"
	"flag"
	"fmt"
	"log"

	firebase "firebase.google.com/go/v4"
)

func main() {
	uid := flag.String("uid", "", "target firebase uid")
	flag.Parse()
	if *uid == "" {
		log.Fatal("uid is required: -uid=xxxxx")
	}

	ctx := context.Background()
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		log.Fatalf("firebase.NewApp: %v", err)
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("app.Auth: %v", err)
	}

	claims := map[string]interface{}{
		"roles": []string{"staff"},
		"staff": true,
	}

	if err := authClient.SetCustomUserClaims(ctx, *uid, claims); err != nil {
		log.Fatalf("SetCustomUserClaims: %v", err)
	}

	fmt.Println("ok: staff claims set for", *uid)
}
