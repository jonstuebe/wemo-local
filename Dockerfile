# syntax=docker/dockerfile:1

# --- Build the Foldkit web UI ---------------------------------------------
FROM node:24-slim AS web
WORKDIR /web
RUN npm install -g pnpm@12.16.1
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# --- Python server ----------------------------------------------------------
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY README.md ./
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

COPY --from=web /web/dist ./web/dist

ENV PATH="/app/.venv/bin:$PATH" \
    WEMO_WEB_DIST=/app/web/dist \
    WEMO_BIND=0.0.0.0 \
    WEMO_PORT=8765

# Set by CI to the release version; shown by /api/health.
ARG VERSION=dev
ENV WEMO_VERSION=$VERSION

RUN useradd --system --no-create-home wemo
USER wemo

EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"WEMO_PORT\"]}/api/health', timeout=4)"

CMD ["wemo", "serve"]
