package middleware

import (
	"log"
	"net/http"

	"github.com/go-chi/cors"
)

func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	log.Printf("[CORS] Allowed origins: %v", allowedOrigins)
	
	// 空の場合はすべて許可（開発用）
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"*"}
	}
	
	return cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Requested-With"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
		Debug:            false, // 本番ではfalse
	})
}
