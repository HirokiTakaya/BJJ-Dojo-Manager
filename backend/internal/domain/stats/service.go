package stats

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Service struct {
	client *firestore.Client
}

func NewService(client *firestore.Client) *Service {
	return &Service{client: client}
}

// GetDojoStats gets statistics for a dojo
func (s *Service) GetDojoStats(ctx context.Context, dojoID string) (*DojoStats, error) {
	if dojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	// Get members
	membersIter := s.client.Collection("dojos").Doc(dojoID).Collection("members").Documents(ctx)
	
	totalMembers := 0
	activeMembers := 0
	pendingMembers := 0
	roleDistribution := make(map[string]int)

	for {
		doc, err := membersIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get members: %w", err)
		}

		totalMembers++
		data := doc.Data()
		status, _ := data["status"].(string)
		if status == "active" || status == "approved" {
			activeMembers++
		} else if status == "pending" {
			pendingMembers++
		}

		role, _ := data["roleInDojo"].(string)
		if role == "" {
			role = "student"
		}
		roleDistribution[role]++
	}

	// Get active sessions
	sessionsIter := s.client.Collection("dojos").Doc(dojoID).Collection("sessions").
		Where("isActive", "==", true).Documents(ctx)
	
	activeSessions := 0
	for {
		_, err := sessionsIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		activeSessions++
	}

	// Get this month's attendance
	now := time.Now()
	firstDayOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	
	attendanceIter := s.client.Collection("dojos").Doc(dojoID).Collection("attendance").
		Where("createdAt", ">=", firstDayOfMonth).Documents(ctx)

	presentCount := 0
	absentCount := 0
	lateCount := 0

	for {
		doc, err := attendanceIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}

		data := doc.Data()
		status, _ := data["status"].(string)
		switch status {
		case "present":
			presentCount++
		case "absent":
			absentCount++
		case "late":
			lateCount++
		}
	}

	totalAttendance := presentCount + absentCount + lateCount
	var rate string
	if totalAttendance > 0 {
		rate = fmt.Sprintf("%.1f", float64(presentCount+lateCount)/float64(totalAttendance)*100)
	} else {
		rate = "0"
	}

	return &DojoStats{
		Members: MemberStats{
			Total:            totalMembers,
			Active:           activeMembers,
			Pending:          pendingMembers,
			RoleDistribution: roleDistribution,
		},
		Sessions: SessionStats{
			Active: activeSessions,
		},
		Attendance: AttendanceStats{
			ThisMonth: MonthlyAttendance{
				Total:   totalAttendance,
				Present: presentCount,
				Absent:  absentCount,
				Late:    lateCount,
				Rate:    rate,
			},
		},
	}, nil
}

// GetMemberStats gets statistics for a member
func (s *Service) GetMemberStats(ctx context.Context, dojoID, memberUID string) (*MemberStatsResult, error) {
	if dojoID == "" || memberUID == "" {
		return nil, fmt.Errorf("%w: dojoId and memberUid are required", ErrBadRequest)
	}

	// Get member info
	memberDoc, err := s.client.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: member not found", ErrNotFound)
	}

	memberData := memberDoc.Data()
	beltRank, _ := memberData["beltRank"].(string)
	if beltRank == "" {
		beltRank = "white"
	}
	stripes, _ := memberData["stripes"].(int64)

	var joinedAt time.Time
	if ja, ok := memberData["joinedAt"].(time.Time); ok {
		joinedAt = ja
	} else if ca, ok := memberData["createdAt"].(time.Time); ok {
		joinedAt = ca
	} else {
		joinedAt = time.Now()
	}

	now := time.Now()
	daysSinceJoined := int(now.Sub(joinedAt).Hours() / 24)

	// Get all attendance
	attendanceIter := s.client.Collection("dojos").Doc(dojoID).Collection("attendance").
		Where("memberUid", "==", memberUID).Documents(ctx)

	totalClasses := 0
	presentCount := 0
	lateCount := 0
	absentCount := 0

	firstDayOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	thisMonthTotal := 0
	thisMonthPresent := 0

	for {
		doc, err := attendanceIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}

		totalClasses++
		data := doc.Data()
		status, _ := data["status"].(string)

		switch status {
		case "present":
			presentCount++
		case "late":
			lateCount++
		case "absent":
			absentCount++
		}

		// Check if this month
		if createdAt, ok := data["createdAt"].(time.Time); ok && createdAt.After(firstDayOfMonth) {
			thisMonthTotal++
			if status == "present" || status == "late" {
				thisMonthPresent++
			}
		}
	}

	var rate string
	if totalClasses > 0 {
		rate = fmt.Sprintf("%.1f", float64(presentCount+lateCount)/float64(totalClasses)*100)
	} else {
		rate = "0"
	}

	var thisMonthRate string
	if thisMonthTotal > 0 {
		thisMonthRate = fmt.Sprintf("%.1f", float64(thisMonthPresent)/float64(thisMonthTotal)*100)
	} else {
		thisMonthRate = "0"
	}

	// Get recent promotions
	historyIter := s.client.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).
		Collection("rankHistory").OrderBy("createdAt", firestore.Desc).Limit(5).Documents(ctx)

	var recentPromotions []map[string]interface{}
	for {
		doc, err := historyIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		recentPromotions = append(recentPromotions, doc.Data())
	}

	return &MemberStatsResult{
		Member: MemberInfo{
			BeltRank:        beltRank,
			Stripes:         int(stripes),
			JoinedAt:        joinedAt,
			DaysSinceJoined: daysSinceJoined,
		},
		Attendance: MemberAttendanceStats{
			Total:   totalClasses,
			Present: presentCount,
			Late:    lateCount,
			Absent:  absentCount,
			Rate:    rate,
			ThisMonth: MemberThisMonthStats{
				Total:   thisMonthTotal,
				Present: thisMonthPresent,
				Rate:    thisMonthRate,
			},
		},
		RecentPromotions: recentPromotions,
	}, nil
}

// GetAttendanceStats gets attendance statistics
func (s *Service) GetAttendanceStats(ctx context.Context, dojoID, period, sessionID string) (*AttendanceStatsResult, error) {
	if dojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	now := time.Now()
	var startDate time.Time

	switch period {
	case "day":
		startDate = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "week":
		startDate = now.AddDate(0, 0, -7)
	default:
		period = "month"
		startDate = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}

	query := s.client.Collection("dojos").Doc(dojoID).Collection("attendance").
		Where("createdAt", ">=", startDate)

	if sessionID != "" {
		query = query.Where("sessionId", "==", sessionID)
	}

	iter := query.Documents(ctx)

	dailyStats := make(map[string]*DailyStats)

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}

		data := doc.Data()
		var createdAt time.Time
		if ca, ok := data["createdAt"].(time.Time); ok {
			createdAt = ca
		} else {
			continue
		}

		dateKey := createdAt.Format("2006-01-02")
		if dailyStats[dateKey] == nil {
			dailyStats[dateKey] = &DailyStats{Date: dateKey}
		}

		dailyStats[dateKey].Total++
		status, _ := data["status"].(string)
		switch status {
		case "present":
			dailyStats[dateKey].Present++
		case "absent":
			dailyStats[dateKey].Absent++
		case "late":
			dailyStats[dateKey].Late++
		}
	}

	// Sort dates
	var dates []string
	for date := range dailyStats {
		dates = append(dates, date)
	}
	sort.Strings(dates)

	var chartData []DailyStats
	totalPresent := 0
	totalAbsent := 0
	totalLate := 0
	totalRecords := 0

	for _, date := range dates {
		ds := dailyStats[date]
		if ds.Total > 0 {
			ds.Rate = fmt.Sprintf("%.1f", float64(ds.Present+ds.Late)/float64(ds.Total)*100)
		} else {
			ds.Rate = "0"
		}
		chartData = append(chartData, *ds)

		totalPresent += ds.Present
		totalAbsent += ds.Absent
		totalLate += ds.Late
		totalRecords += ds.Total
	}

	var summaryRate string
	if totalRecords > 0 {
		summaryRate = fmt.Sprintf("%.1f", float64(totalPresent+totalLate)/float64(totalRecords)*100)
	} else {
		summaryRate = "0"
	}

	return &AttendanceStatsResult{
		Period:    period,
		StartDate: startDate.Format(time.RFC3339),
		EndDate:   now.Format(time.RFC3339),
		Summary: StatsSummary{
			Total:   totalRecords,
			Present: totalPresent,
			Absent:  totalAbsent,
			Late:    totalLate,
			Rate:    summaryRate,
		},
		Daily: chartData,
	}, nil
}

func formatFloat(f float64) string {
	return strconv.FormatFloat(f, 'f', 1, 64)
}
