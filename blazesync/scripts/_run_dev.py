"""Run the BlazeSync API against a throwaway embedded Postgres cluster.

pgembed clusters live only as long as their parent process, so this script
owns the cluster and serves uvicorn in-process. Dev/local-E2E helper only —
real deployments point DATABASE_URL at a managed Postgres instead.
"""

import sys

import pgembed
import psycopg

server = pgembed.get_server(".pgserver")
conn = psycopg.connect(server.get_uri("postgres"), autocommit=True, connect_timeout=15)
try:
    conn.execute("CREATE DATABASE blazesync")
except Exception:
    pass  # already exists
conn.close()

import os
import sys

os.environ["DATABASE_URL"] = server.get_uri("blazesync").replace(
    "postgresql://", "postgresql+psycopg://"
)
# Local dev: the Next dev server lives on :3000 (overridable).
os.environ.setdefault("ALLOWED_ORIGINS", os.environ.get("DEV_ORIGIN", "http://localhost:3000"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uvicorn

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="info")
