package session

import (
	"errors"
)

var (
	ErrBadRequest   = errors.New("bad request")
	ErrUnauthorized = errors.New("unauthorized")
	ErrNotFound     = errors.New("not found")
)

func IsErrBadRequest(err error) bool {
	return errors.Is(err, ErrBadRequest)
}

func IsErrUnauthorized(err error) bool {
	return errors.Is(err, ErrUnauthorized)
}

func IsErrNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}