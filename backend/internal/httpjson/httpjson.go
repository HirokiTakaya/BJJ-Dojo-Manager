package httpjson

import (
	"encoding/json"
	"net/http"
)

func Write(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Read(r *http.Request, dst interface{}) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func Error(w http.ResponseWriter, status int, msg string) {
	Write(w, status, map[string]interface{}{"error": msg})
}
