package members

import "errors"

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrNotFound     = errors.New("not found")
	ErrBadRequest   = errors.New("bad request")
	ErrForbidden    = errors.New("forbidden")
)

func IsErrUnauthorized(err error) bool {
	return errors.Is(err, ErrUnauthorized)
}

func IsErrNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}

func IsErrBadRequest(err error) bool {
	return errors.Is(err, ErrBadRequest)
}

func IsErrForbidden(err error) bool {
	return errors.Is(err, ErrForbidden)
}
