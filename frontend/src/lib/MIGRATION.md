# Cloud Functions から Go Cloud Run への移行ガイド

## 概要

このlibフォルダは、Firebase Cloud FunctionsとGo Cloud Run両方に対応しています。
環境変数で切り替えることで、既存のロジックを壊さずにGoバックエンドへ移行できます。

## 変更されたファイル

| ファイル | 変更内容 |
|---------|---------|
| `api-client.ts` | Go API設定の追加、`isUsingGoApi()` エクスポート |
| `timetable-api.ts` | RESTful URLパターン対応 |
| `attendance-api.ts` | RESTful URLパターン対応 |
| `members-api.ts` | RESTful URLパターン対応 |
| `ranks-api.ts` | RESTful URLパターン対応 |
| `stats-api.ts` | RESTful URLパターン対応 |
| `notifications-api.ts` | RESTful URLパターン対応 |
| `profile-api.ts` | RESTful URLパターン対応 |
| `dojos-api.ts` | RESTful URLパターン対応 |

## 環境変数

```bash
# .env.local

# Cloud Functions URL (従来)
NEXT_PUBLIC_API_URL=https://us-central1-your-project.cloudfunctions.net

# Go Cloud Run URL (新規)
NEXT_PUBLIC_GO_API_URL=https://dojo-api-xxxxx-an.a.run.app

# Go APIを使用するか ("true" で有効)
NEXT_PUBLIC_USE_GO_API=false
```

## 移行手順

### Step 1: 環境変数を設定

`.env.local` に以下を追加：

```bash
NEXT_PUBLIC_GO_API_URL=https://your-cloud-run-url.a.run.app
NEXT_PUBLIC_USE_GO_API=false  # まだ切り替えない
```

### Step 2: Go Cloud Run をデプロイ

```bash
cd backend
gcloud run deploy dojo-api \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=your-project-id,ALLOWED_ORIGINS=https://your-app.com"
```

### Step 3: テスト環境で検証

```bash
# テスト環境のみGo APIを有効化
NEXT_PUBLIC_USE_GO_API=true npm run dev
```

### Step 4: 本番切り替え

問題なければ本番環境の `.env.production` で：

```bash
NEXT_PUBLIC_USE_GO_API=true
```

## APIエンドポイント対応表

### Sessions (Timetable)

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 一覧 | `GET /sessions?dojoId=xxx` | `GET /v1/dojos/{dojoId}/sessions` |
| 取得 | `GET /sessions?dojoId=xxx&id=yyy` | `GET /v1/dojos/{dojoId}/sessions/{sessionId}` |
| 作成 | `POST /sessions` (body: dojoId) | `POST /v1/dojos/{dojoId}/sessions` |
| 更新 | `PUT /sessions` (body: dojoId, id) | `PUT /v1/dojos/{dojoId}/sessions/{sessionId}` |
| 削除 | `DELETE /sessions?dojoId=xxx&id=yyy` | `DELETE /v1/dojos/{dojoId}/sessions/{sessionId}` |

### Attendance

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 一覧 | `GET /attendance?dojoId=xxx` | `GET /v1/dojos/{dojoId}/attendance` |
| 記録 | `POST /attendance` | `POST /v1/dojos/{dojoId}/attendance` |
| 更新 | `PUT /attendance` | `PUT /v1/dojos/{dojoId}/attendance/{id}` |
| 一括 | `POST /bulkAttendance` | `POST /v1/dojos/{dojoId}/attendance/bulk` |

### Members

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 一覧 | `GET /members?dojoId=xxx` | `GET /v1/dojos/{dojoId}/members` |
| 取得 | `GET /members?dojoId=xxx&memberUid=yyy` | `GET /v1/dojos/{dojoId}/members/{memberUid}` |
| 更新 | `PUT /members` | `PUT /v1/dojos/{dojoId}/members/{memberUid}` |
| 削除 | `DELETE /members?...` | `DELETE /v1/dojos/{dojoId}/members/{memberUid}` |

### Ranks

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 帯更新 | `POST /updateMemberRank` | `POST /v1/dojos/{dojoId}/members/{uid}/rank` |
| ストライプ | `POST /addStripe` | `POST /v1/dojos/{dojoId}/members/{uid}/stripe` |
| 履歴 | `GET /getRankHistory?...` | `GET /v1/dojos/{dojoId}/members/{uid}/rankHistory` |
| 分布 | `GET /getBeltDistribution?...` | `GET /v1/dojos/{dojoId}/beltDistribution` |

### Stats

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 道場統計 | `GET /getDojoStats?dojoId=xxx` | `GET /v1/dojos/{dojoId}/stats` |
| メンバー統計 | `GET /getMemberStats?...` | `GET /v1/dojos/{dojoId}/members/{uid}/stats` |
| 出席統計 | `GET /getAttendanceStats?...` | `GET /v1/dojos/{dojoId}/attendanceStats` |

### Notifications

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 一覧 | `GET /getNotifications` | `GET /v1/notifications` |
| 既読 | `POST /markNotificationRead` | `POST /v1/notifications/markRead` |
| 作成 | `POST /createNotification` | `POST /v1/notifications` |
| 一括送信 | `POST /sendBulkNotification` | `POST /v1/notifications/bulk` |
| 削除 | `DELETE /deleteNotification?...` | `DELETE /v1/notifications/{id}` |

### Profile

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 取得 | `GET /getUserProfile` | `GET /v1/profile` |
| 更新 | `PUT /updateUserProfile` | `PUT /v1/profile` |
| 無効化 | `POST /deactivateUser` | `POST /v1/admin/deactivateUser` |
| 再有効化 | `POST /reactivateUser` | `POST /v1/admin/reactivateUser` |

### Dojos

| 操作 | Cloud Functions | Go Cloud Run |
|-----|-----------------|--------------|
| 検索 | `GET /dojos?q=xxx` | `GET /v1/dojos/search?q=xxx` |
| 作成 | `POST /dojos` | `POST /v1/dojos` |
| 参加申請 | `POST /joinRequests` | `POST /v1/dojos/{dojoId}/joinRequests` |
| 承認 | `POST /approveJoinRequest` | `POST /v1/dojos/{dojoId}/joinRequests/{uid}/approve` |

## ロールバック方法

問題が発生した場合、環境変数を変更するだけで元に戻せます：

```bash
NEXT_PUBLIC_USE_GO_API=false
```

## デバッグ

開発環境では、API呼び出しがコンソールにログ出力されます：

```
[api-client] Configuration: { FUNCTIONS_API_BASE: "...", GO_API_BASE: "...", USE_GO_API: true, API_BASE: "..." }
[api-client] fetch: GET https://dojo-api-xxxxx-an.a.run.app/v1/dojos/abc123/sessions
```

## 注意事項

1. **認証は同じ**: Firebase ID Token を使用するため、認証部分は変更不要
2. **レスポンス形式は互換**: GoバックエンドはCloud Functionsと同じJSON形式を返す
3. **段階的移行が可能**: 環境変数で切り替えられるため、一部の環境だけでテスト可能
