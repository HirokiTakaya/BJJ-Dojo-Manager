package http

import (
	"encoding/json"
	"net/http"
)

type APIError struct {
	Message string `json:"message"`
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Fail(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, APIError{Message: msg})
}
