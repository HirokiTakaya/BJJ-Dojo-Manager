package tuition

import "errors"

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrBadRequest   = errors.New("bad request")
	ErrNotReady     = errors.New("connect account not ready")
)

func IsErrNotFound(err error) bool     { return errors.Is(err, ErrNotFound) }
func IsErrUnauthorized(err error) bool { return errors.Is(err, ErrUnauthorized) }
func IsErrBadRequest(err error) bool   { return errors.Is(err, ErrBadRequest) }
func IsErrNotReady(err error) bool     { return errors.Is(err, ErrNotReady) }
