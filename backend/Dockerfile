# ── Build stage ──
FROM golang:1.25 AS builder

WORKDIR /app

# 依存を先にダウンロード(レイヤーキャッシュ用)
COPY go.mod go.sum ./
RUN go mod download

# ソースをコピーしてビルド
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/api

# ── Runtime stage ──
FROM gcr.io/distroless/static-debian12

COPY --from=builder /server /server

EXPOSE 8080
ENTRYPOINT ["/server"]