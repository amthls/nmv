FROM golang:1.26.8-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /library ./cmd/library

# Nothing but the binary; runs as nobody
FROM scratch
COPY --from=build /library /library
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["/library", "healthcheck"]
ENTRYPOINT ["/library"]
