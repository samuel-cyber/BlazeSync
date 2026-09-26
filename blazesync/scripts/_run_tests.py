"""Boot the embedded Postgres and run pytest in one process.

pgembed clusters live only as long as their parent process, so the server
must be started here and kept alive while pytest runs in-process.
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

os.environ["DATABASE_URL"] = server.get_uri("blazesync").replace(
    "postgresql://", "postgresql+psycopg://"
)

import pytest

raise SystemExit(pytest.main(sys.argv[1:]))
