package profile

import "errors"

var (
	ErrUnauthorized        = errors.New("unauthorized")
	ErrNotFound            = errors.New("not found")
	ErrBadRequest          = errors.New("bad request")
	ErrTooManyUpdates      = errors.New("too many updates")
	ErrCannotDeactivateSelf = errors.New("cannot deactivate yourself")
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

func IsErrTooManyUpdates(err error) bool {
	return errors.Is(err, ErrTooManyUpdates)
}
