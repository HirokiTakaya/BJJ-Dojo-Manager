package dojo

import "errors"

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrNotFound     = errors.New("not found")
	ErrBadRequest   = errors.New("bad request")
)

func IsErrUnauthorized(err error) bool { return errors.Is(err, ErrUnauthorized) }
func IsErrNotFound(err error) bool     { return errors.Is(err, ErrNotFound) }
func IsErrBadRequest(err error) bool   { return errors.Is(err, ErrBadRequest) }
