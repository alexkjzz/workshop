# syntax=docker/dockerfile:1
# One-shot initialisation: local CA, service certificates and secrets.
FROM alpine:3.22
RUN apk add --no-cache openssl mosquitto
COPY init.sh /usr/local/bin/sentinel-init
RUN chmod 0755 /usr/local/bin/sentinel-init
ENTRYPOINT ["/usr/local/bin/sentinel-init"]
