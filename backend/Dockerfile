# aireOS API image. Also the image for the Cloud Run jobs (forecast-refresh,
# aireos-task), which run scripts/ with a different command.
#
# Build from backend/:  docker build -t aireos-api backend
#
# No credentials go into the image: on Cloud Run every Google client uses the
# service's own service account (see config.optional_key_file).

FROM python:3.15.2-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so code changes don't reinstall them.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY migrations ./migrations

# Run as a non-root user.
RUN useradd --create-home --uid 10001 aireos
USER aireos

# Cloud Run sets PORT (8080). --proxy-headers so request URLs show https
# behind the load balancer.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'
