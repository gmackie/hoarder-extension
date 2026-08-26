# Security

## Permission model

Hoarder requests access to HTTP and HTTPS pages so it can detect direct video
sources, read site cookies needed by authenticated downloads, and contact the
self-hosted endpoints configured by the user. It does not contain telemetry or
send data to a project-operated service.

Cookies are sent only to the active archive target when a manual or automatic
download is submitted. Treat every configured archive target as trusted.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not include credentials, cookies, private URLs, or other secrets in a public
issue.
