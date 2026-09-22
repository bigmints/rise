FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RISE_DB_PATH=/app/data/rise.db \
    RISE_HOST=0.0.0.0 \
    RISE_PORT=8787

WORKDIR /app

RUN groupadd --system rise && useradd --system --gid rise --home-dir /app rise

COPY --chown=rise:rise server.py /app/server.py
COPY --chown=rise:rise static /app/static
RUN mkdir -p /app/data && chown rise:rise /app/data

USER rise
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8787/api/health', timeout=2)"]

CMD ["python", "server.py"]
