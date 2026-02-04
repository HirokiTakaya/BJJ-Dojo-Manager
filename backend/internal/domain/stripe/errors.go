package stripe

import "errors"

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrBadRequest   = errors.New("bad request")
	ErrLimitReached = errors.New("plan limit reached")
)

func IsErrNotFound(err error) bool     { return errors.Is(err, ErrNotFound) }
func IsErrUnauthorized(err error) bool { return errors.Is(err, ErrUnauthorized) }
func IsErrBadRequest(err error) bool   { return errors.Is(err, ErrBadRequest) }
func IsErrLimitReached(err error) bool { return errors.Is(err, ErrLimitReached) }
