package utils

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var wsRe = regexp.MustCompile(`\s+`)
var nonSlug = regexp.MustCompile(`[^a-z0-9\-]+`)
var multiDash = regexp.MustCompile(`\-+`)

// ErrInvalidTimeFormat is returned when time parsing fails
var ErrInvalidTimeFormat = errors.New("invalid time format")

func NormalizeNameLower(s string) string {
	s = strings.TrimSpace(s)
	s = wsRe.ReplaceAllString(s, " ")
	return strings.ToLower(s)
}

func Slugify(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	t := norm.NFKD.String(name)
	b := make([]rune, 0, len(t))
	for _, r := range t {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b = append(b, unicode.ToLower(r))
			continue
		}
		if unicode.IsSpace(r) || r == '-' || r == '_' {
			b = append(b, '-')
			continue
		}
	}
	out := string(b)
	out = nonSlug.ReplaceAllString(out, "-")
	out = multiDash.ReplaceAllString(out, "-")
	out = strings.Trim(out, "-")
	return out
}

func KeywordsFromName(nameLower, slug string) []string {
	if nameLower == "" {
		return nil
	}
	parts := strings.Fields(nameLower)
	kw := make([]string, 0, len(parts)+2)
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		kw = append(kw, s)
	}
	for _, p := range parts {
		add(p)
	}
	add(nameLower)
	if slug != "" {
		add(strings.ReplaceAll(slug, "-", " "))
		add(slug)
	}
	return kw
}

// NormalizeToken creates a search token from a string
func NormalizeToken(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ToLower(s)
	s = wsRe.ReplaceAllString(s, " ")
	return s
}

// SearchTokens generates search tokens from multiple strings
func SearchTokens(strs ...string) []string {
	tokens := make([]string, 0)
	seen := make(map[string]bool)
	for _, s := range strs {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		lower := strings.ToLower(s)
		if !seen[lower] {
			tokens = append(tokens, lower)
			seen[lower] = true
		}
		for _, word := range strings.Fields(lower) {
			if !seen[word] && len(word) >= 2 {
				tokens = append(tokens, word)
				seen[word] = true
			}
		}
	}
	return tokens
}

// TrimMax trims a string to a maximum length
func TrimMax(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// ParseTime parses a time string in RFC3339 or other common formats
func ParseTime(s string) (time.Time, error) {
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, ErrInvalidTimeFormat
}