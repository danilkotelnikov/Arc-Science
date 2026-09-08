# Optional full HeroUI build; registry access is required. Not executed in the authoring environment.
FROM node:22.23.2-bookworm-slim AS web
WORKDIR /app
COPY web ./web
COPY src/arc_science/static/console.css ./src/arc_science/static/console.css
WORKDIR /app/web
RUN npm install --ignore-scripts --no-audit --no-fund && npm run build

FROM python:3.13.15-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ARC_DATA_DIR=/data
WORKDIR /app
COPY requirements.lock pyproject.toml README.md ./
COPY src ./src
COPY --from=web /app/web/dist ./src/arc_science/static/web
RUN python -m pip install --no-cache-dir -r requirements.lock && python -m pip install --no-deps --no-build-isolation . \
    && useradd --uid 10001 --create-home arc && mkdir /data && chown arc:arc /data
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=2)"
CMD ["arc-science", "serve", "--host", "0.0.0.0", "--data", "/data"]
