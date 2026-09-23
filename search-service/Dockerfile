FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /novelsearch .

FROM alpine:3.20
COPY --from=builder /novelsearch /novelsearch
EXPOSE 8091
ENTRYPOINT ["/novelsearch"]
