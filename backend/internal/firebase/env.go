package firebase

import "os"

func optionEnv(key string) string {
	return os.Getenv(key)
}
