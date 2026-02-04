package stats

import "time"

// DojoStats represents statistics for a dojo
type DojoStats struct {
	Members    MemberStats     `json:"members"`
	Sessions   SessionStats    `json:"sessions"`
	Attendance AttendanceStats `json:"attendance"`
}

type MemberStats struct {
	Total            int            `json:"total"`
	Active           int            `json:"active"`
	Pending          int            `json:"pending"`
	RoleDistribution map[string]int `json:"roleDistribution"`
}

type SessionStats struct {
	Active int `json:"active"`
}

type AttendanceStats struct {
	ThisMonth MonthlyAttendance `json:"thisMonth"`
}

type MonthlyAttendance struct {
	Total   int    `json:"total"`
	Present int    `json:"present"`
	Absent  int    `json:"absent"`
	Late    int    `json:"late"`
	Rate    string `json:"rate"`
}

// MemberStatsResult represents statistics for a single member
type MemberStatsResult struct {
	Member           MemberInfo              `json:"member"`
	Attendance       MemberAttendanceStats   `json:"attendance"`
	RecentPromotions []map[string]interface{} `json:"recentPromotions"`
}

type MemberInfo struct {
	BeltRank        string    `json:"beltRank"`
	Stripes         int       `json:"stripes"`
	JoinedAt        time.Time `json:"joinedAt"`
	DaysSinceJoined int       `json:"daysSinceJoined"`
}

type MemberAttendanceStats struct {
	Total     int                   `json:"total"`
	Present   int                   `json:"present"`
	Late      int                   `json:"late"`
	Absent    int                   `json:"absent"`
	Rate      string                `json:"rate"`
	ThisMonth MemberThisMonthStats  `json:"thisMonth"`
}

type MemberThisMonthStats struct {
	Total   int    `json:"total"`
	Present int    `json:"present"`
	Rate    string `json:"rate"`
}

// AttendanceStatsResult represents attendance statistics
type AttendanceStatsResult struct {
	Period    string       `json:"period"`
	StartDate string       `json:"startDate"`
	EndDate   string       `json:"endDate"`
	Summary   StatsSummary `json:"summary"`
	Daily     []DailyStats `json:"daily"`
}

type StatsSummary struct {
	Total   int    `json:"total"`
	Present int    `json:"present"`
	Absent  int    `json:"absent"`
	Late    int    `json:"late"`
	Rate    string `json:"rate"`
}

type DailyStats struct {
	Date    string `json:"date"`
	Present int    `json:"present"`
	Absent  int    `json:"absent"`
	Late    int    `json:"late"`
	Total   int    `json:"total"`
	Rate    string `json:"rate"`
}
