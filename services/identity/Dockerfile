FROM golang:1.26.8-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /identity ./cmd/identity

# Nothing but the binary and CA roots (SMTP over TLS); runs as nobody
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /identity /identity
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["/identity", "healthcheck"]
ENTRYPOINT ["/identity"]
